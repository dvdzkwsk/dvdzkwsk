import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import * as React from "react"
import {
	LeaguePlayer,
	LIST_PLAYERS_ENDPOINT,
	PlayersResponse,
	PlayersTeam,
} from "../../shared/ApiJson.js"
import {normalizePlayerName} from "../../shared/KHLJson.js"
import {
	AsyncContent,
	Card,
	compareSkaters,
	GOALIE_COLUMNS,
	Link,
	PageShell,
	Picker,
	SearchIcon,
	SeasonFilter,
	SegmentedControl,
	SKATER_COLUMNS,
	StatsTable,
	StatsTableColumn,
	TeamAvatar,
	TeamLink,
	toStatColumns,
	Warnings,
} from "../Components.js"
import {DivisionMenu, sortByDivision} from "../Games.js"
import {
	AppContext,
	getPlayerHref,
	getVisibleDivisions,
	replaceQueryParam,
	Route,
	RouteProps,
	useAsync,
	useDebouncedValue,
	useSeasonFilters,
} from "../Util.js"

type GroupBy = "division" | "team" | "none"

const GROUP_BY_LABELS: Record<GroupBy, string> = {
	division: "Division",
	team: "Team",
	none: "None",
}

type Position = "skaters" | "goalies"

/**
 * Rows shown per table before "Show all": a few thousand rows at once take
 * over a second to render on a phone
 */
const ROW_LIMIT = 25

/** A player row with its team's details, for the tables */
interface PlayerRow {
	player: LeaguePlayer
	team: PlayersTeam
}

/** A table's worth of rows: one division, one team, or everyone */
interface PlayerGroup {
	key: string
	title: React.ReactNode
	rows: PlayerRow[]
}

/**
 * Every player in a season with their stats, filterable by season, division
 * and position. Grouped by division by default, by team, or one table.
 */
const PlayersPage = ({query}: RouteProps) => {
	const {history} = React.useContext(AppContext)
	const [filters, setFilters] = useSeasonFilters(query)
	const group = query.get("group")
	const groupBy: GroupBy =
		group === "team" || group === "none" ? group : "division"
	const position: Position =
		query.get("position") === "goalies" ? "goalies" : "skaters"
	// The name filter is kept in ?q= once typing pauses
	const name = query.get("q") ?? ""
	const [nameInput, setNameInput] = React.useState(name)
	const debouncedName = useDebouncedValue(nameInput.trim(), 200)
	React.useEffect(() => {
		const current = new URLSearchParams(history.location.search).get("q")
		if (debouncedName !== (current ?? "")) {
			replaceQueryParam(history, "q", debouncedName || null)
		}
	}, [history, debouncedName])
	const state = useAsync(
		() =>
			doRequest(LIST_PLAYERS_ENDPOINT, {
				season: filters.season ?? undefined,
			}),
		[filters.season],
	)
	// The latest players that loaded, for the filters' seasons and divisions
	const [toolbarData, setToolbarData] =
		React.useState<PlayersResponse | null>(null)
	React.useEffect(() => {
		if (state.status === "success") {
			setToolbarData(state.data)
		}
	}, [state])

	// The first time, every team's stats page is fetched
	const loadingLabel = "Loading every team's roster…"
	const slowNote =
		"Still working. This is the first time we're loading every team's players, so it will take a little bit longer."
	return (
		<PageShell>
			<div className="HomePage">
				{/* The first load covers the page; after that the filters stay
				    while the players below reload */}
				{toolbarData ? (
					<>
						<div className="FilterToolbar">
							<SegmentedControl
								label="Position"
								options={[
									{value: "skaters", label: "Skaters"},
									{value: "goalies", label: "Goalies"},
								]}
								value={position}
								onChange={(next) =>
									// Skaters is the default, so it needs no param
									replaceQueryParam(
										history,
										"position",
										next === "skaters" ? null : next,
									)
								}
							/>
							<div className="PlayersPage-search">
								<SearchIcon className="PlayersPage-search-icon" />
								<input
									type="search"
									className="PlayersPage-search-input"
									aria-label="Filter players by name"
									placeholder="Filter by name"
									value={nameInput}
									onChange={(e) =>
										setNameInput(e.target.value)
									}
								/>
							</div>
							<span className="FilterToolbar-spacer" />
							<Picker
								groups={[
									{
										label: "Group by",
										items: (
											[
												"division",
												"team",
												"none",
											] as const
										).map((value) => ({
											value,
											label: GROUP_BY_LABELS[value],
										})),
									},
								]}
								value={groupBy}
								onChange={(value) =>
									// Division is the default, so it needs no param
									replaceQueryParam(
										history,
										"group",
										value === "division" ? null : value,
									)
								}
								placeholder="Group by"
								triggerLabel={`Group by: ${GROUP_BY_LABELS[groupBy]}`}
							/>
							<DivisionMenu
								divisions={toolbarData.teams.map(
									(t) => t.divisionName,
								)}
								selected={filters.divisions}
								onChange={(divisions) =>
									setFilters({divisions})
								}
							/>
							<SeasonFilter
								seasons={toolbarData.seasons}
								// The picked season right away, while it loads
								value={filters.season ?? toolbarData.season.id}
								onChange={(season) => setFilters({season})}
							/>
						</div>
						<AsyncContent
							state={state}
							loadingLabel={loadingLabel}
							slowNote={slowNote}
						>
							{(data) => (
								<PlayerGroups
									data={data}
									position={position}
									groupBy={groupBy}
									divisions={filters.divisions}
									name={name}
									onRetry={state.reload}
								/>
							)}
						</AsyncContent>
					</>
				) : (
					<AsyncContent
						state={state}
						loadingLabel={loadingLabel}
						slowNote={slowNote}
					>
						{() => null}
					</AsyncContent>
				)}
			</div>
		</PageShell>
	)
}

const PlayerGroups = ({
	data,
	position,
	groupBy,
	divisions,
	name,
	onRetry,
}: {
	data: PlayersResponse
	position: Position
	groupBy: GroupBy
	/** Division names; empty means every division */
	divisions: string[]
	/** Only players whose name contains this; empty for everyone */
	name: string
	onRetry: () => void
}) => {
	const label = position === "goalies" ? "goalies" : "skaters"
	// A new array each render, so it's compared by value
	const divisionsKey = divisions.join(",")
	const groups = React.useMemo(() => {
		const teams = new Map(data.teams.map((t) => [t.team.id, t]))
		const visible = getVisibleDivisions(
			data.teams.map((t) => t.divisionName),
			divisionsKey.split(",").filter(Boolean),
		)
		const needle = normalizePlayerName(name)
		const players = position === "goalies" ? data.goalies : data.skaters
		const rows = players
			.filter((p) => normalizePlayerName(p.name).includes(needle))
			.map((player) => ({player, team: teams.get(player.teamId)!}))
			.filter((row) => visible.has(row.team.divisionName))
			.sort((a, b) =>
				position === "goalies"
					? compareGoalies(a.player, b.player)
					: compareSkaters(a.player, b.player),
			)
		return groupPlayers(rows, groupBy, label)
	}, [data, position, groupBy, label, divisionsKey, name])
	return (
		<>
			{data.unavailableTeams.length > 0 && (
				<Warnings
					summary={`${
						data.unavailableTeams.length === 1
							? "A team"
							: `${data.unavailableTeams.length} teams`
					} couldn't be loaded, so some players are missing`}
					detail={`The league's site returned an error for ${
						data.unavailableTeams.length === 1
							? "this team's stats, so its"
							: "these teams' stats, so their"
					} players aren't listed.`}
					items={data.unavailableTeams.map((team) => ({
						key: team.id,
						label: (
							<TeamLink team={team} seasonId={team.seasonId} />
						),
					}))}
					onRetry={onRetry}
				/>
			)}
			{groups.length === 0 && (
				<div className="GameList-empty">
					{name
						? `No ${label} match “${name}”.`
						: `No ${label} have played in ${data.season.name} yet.`}
				</div>
			)}
			{groups.map((group) => (
				<Card
					key={group.key}
					className="PlayersPage-group"
					title={
						<span className="PlayersPage-title">{group.title}</span>
					}
				>
					<PlayersTable
						rows={group.rows}
						columns={
							position === "goalies"
								? GOALIE_COLUMNS
								: SKATER_COLUMNS
						}
						showTeam={groupBy !== "team"}
						showDivision={groupBy === "none"}
					/>
				</Card>
			))}
		</>
	)
}

/** `rows` (already sorted) split into tables, each keeping that order */
function groupPlayers(
	rows: PlayerRow[],
	groupBy: GroupBy,
	label: string,
): PlayerGroup[] {
	if (groupBy === "none") {
		return rows.length > 0
			? [{key: "all", title: `All ${label} · ${rows.length}`, rows}]
			: []
	}
	const byKey = new Map<string, PlayerRow[]>()
	const keyOf = (row: PlayerRow) =>
		groupBy === "team" ? row.team.team.id : row.team.divisionName
	for (const row of rows) {
		byKey.set(keyOf(row), [...(byKey.get(keyOf(row)) ?? []), row])
	}
	const groups = [...byKey.values()]
	if (groupBy === "division") {
		return sortByDivision(groups, (g) => g[0]!.team.divisionName).map(
			(g) => ({
				key: g[0]!.team.divisionName,
				title: `${g[0]!.team.divisionName} · ${g.length}`,
				rows: g,
			}),
		)
	}
	// Teams by division, then by name within it
	return sortByDivision(
		groups.sort((a, b) =>
			a[0]!.team.team.name.localeCompare(b[0]!.team.team.name),
		),
		(g) => g[0]!.team.divisionName,
	).map((g) => {
		const {team, divisionName} = g[0]!.team
		return {
			key: team.id,
			title: (
				<>
					<TeamAvatar
						name={team.name}
						logoUrl={team.logoUrl}
						size={24}
					/>
					<TeamLink
						className="PlayersPage-team-name"
						team={team}
						seasonId={team.seasonId}
					/>
					<span>
						{divisionName} · {g.length}
					</span>
				</>
			),
			rows: g,
		}
	})
}

/** Goalies by wins, then the fewest goals against per game */
function compareGoalies(a: LeaguePlayer, b: LeaguePlayer): number {
	const stat = (p: LeaguePlayer, column: string, missing: number) => {
		const n = parseFloat(p.stats[column] ?? "")
		return Number.isNaN(n) ? missing : n
	}
	return (
		stat(b, "W", 0) - stat(a, "W", 0) ||
		stat(a, "GAA", Infinity) - stat(b, "GAA", Infinity) ||
		a.name.localeCompare(b.name)
	)
}

const PlayersTable = ({
	rows,
	columns: statColumns,
	showTeam,
	showDivision,
}: {
	rows: PlayerRow[]
	/** The league's stat columns, e.g. ["GP", "G", ...] */
	columns: string[]
	/** A Team column, unless the table is one team's */
	showTeam: boolean
	/** A Division column, when divisions share a table */
	showDivision: boolean
}) => {
	const columns: StatsTableColumn<PlayerRow>[] = [
		{
			header: "Player",
			isLabel: true,
			sortValue: ({player}) => player.name.toLowerCase(),
			render: ({player}) => (
				<Link
					className="InlineLink"
					href={getPlayerHref(player.playerId)}
				>
					{player.name}
				</Link>
			),
		},
		...(showTeam
			? [
					{
						header: "Team",
						isLabel: true,
						sortValue: ({team}: PlayerRow) =>
							team.team.name.toLowerCase(),
						render: ({team: {team}}: PlayerRow) => (
							<span className="StatsTable-team">
								{/* TODO: render a plain <img> here instead of TeamAvatar.
								    Each base-ui Avatar tracks its own image-loading
								    state, which adds up over "Show all" on a few
								    thousand rows (~14 DOM nodes per row). */}
								<TeamAvatar
									name={team.name}
									logoUrl={team.logoUrl}
									size={20}
								/>
								<TeamLink
									team={team}
									seasonId={team.seasonId}
								/>
							</span>
						),
					},
				]
			: []),
		...(showDivision
			? [
					{
						header: "Division",
						isLabel: true,
						className: "PlayersPage-division",
						// A capped table can only sort by values, not cell text
						sortValue: ({team}: PlayerRow) => team.divisionName,
						render: ({team}: PlayerRow) => team.divisionName,
					},
				]
			: []),
		...toStatColumns<PlayerRow>(statColumns, ({player}) => player.stats),
	]
	return (
		<div className="PlayersPage-table">
			<StatsTable
				columns={columns}
				rows={rows}
				rowKey={({player}) => player.khlPlayerId}
				rowLimit={ROW_LIMIT}
			/>
		</div>
	)
}

export const PlayersRoute = {
	path: "/players",
	title: "Players",
	content: PlayersPage,
} as const satisfies Route
