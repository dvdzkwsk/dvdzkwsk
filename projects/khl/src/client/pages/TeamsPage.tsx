import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {matchFn, matchField} from "@dvdzkwsk/util/MatchUtil"
import * as React from "react"
import {
	GET_STANDINGS_ENDPOINT,
	GetStandingsResponse,
} from "../../shared/ApiJson.js"
import {KHLStandingsDivision, KHLStandingsRow} from "../../shared/KHLJson.js"
import {
	AsyncContent,
	Card,
	PageShell,
	Picker,
	SeasonFilter,
	StatsTable,
	StatsTableColumn,
	TeamAvatar,
	TeamLink,
} from "../Components.js"
import {DivisionMenu, sortByDivision} from "../Games.js"
import {
	AppContext,
	getVisibleDivisions,
	replaceQueryParam,
	Route,
	RouteProps,
	useAsync,
	useSeasonFilters,
} from "../Util.js"

type GroupBy = "division" | "none"

const GROUP_BY_LABELS: Record<GroupBy, string> = {
	division: "Division",
	none: "None",
}

/**
 * Every division's standings, filterable by season and division. Grouped by
 * division by default, or one table of every team.
 */
const TeamsPage = ({query}: RouteProps) => {
	const {history} = React.useContext(AppContext)
	const [filters, setFilters] = useSeasonFilters(query)
	const groupBy: GroupBy = query.get("group") === "none" ? "none" : "division"
	const setGroupBy = (next: GroupBy) => {
		// Division is the default, so it needs no param
		replaceQueryParam(
			history,
			"group",
			matchFn(next, {division: () => null, none: (v) => v}),
		)
	}
	const state = useAsync(
		() =>
			doRequest(GET_STANDINGS_ENDPOINT, {
				season: filters.season ?? undefined,
			}),
		[filters.season],
	)
	// The latest standings that loaded, for the filters' seasons and divisions
	const [toolbarData, setToolbarData] =
		React.useState<GetStandingsResponse | null>(null)
	React.useEffect(() => {
		matchField(state, "status", {
			loading: () => {},
			error: () => {},
			success: (s) => setToolbarData(s.data),
		})
	}, [state])

	return (
		<PageShell>
			<div className="HomePage">
				{/* The first load covers the page; after that the filters stay
				    while the standings below reload */}
				{toolbarData ? (
					<>
						<div className="FilterToolbar">
							<span className="FilterToolbar-spacer" />
							<Picker
								groups={[
									{
										label: "Group by",
										items: (
											["division", "none"] as const
										).map((value) => ({
											value,
											label: GROUP_BY_LABELS[value],
										})),
									},
								]}
								value={groupBy}
								onChange={(value) =>
									setGroupBy(value as GroupBy)
								}
								placeholder="Group by"
								triggerLabel={`Group by: ${GROUP_BY_LABELS[groupBy]}`}
							/>
							<DivisionMenu
								divisions={toolbarData.divisions.map(
									(d) => d.name,
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
							loadingLabel="Loading standings…"
						>
							{(standings) => {
								const names = standings.divisions.map(
									(d) => d.name,
								)
								const visible = getVisibleDivisions(
									names,
									filters.divisions,
								)
								return (
									<>
										{standings.divisions.length === 0 && (
											<div className="GameList-empty">
												No standings for{" "}
												{standings.season.name}.
											</div>
										)}
										{matchFn(groupBy, {
											none: () => (
												<AllStandings
													divisions={standings.divisions.filter(
														(d) =>
															visible.has(d.name),
													)}
													seasonId={
														standings.season.id
													}
												/>
											),
											division: () =>
												sortByDivision(
													standings.divisions,
													(d) => d.name,
												)
													.filter((d) =>
														visible.has(d.name),
													)
													.map((division) => (
														<StandingsTable
															key={division.name}
															title={
																division.name
															}
															columns={
																division.columns
															}
															// Listed by rank
															rows={division.rows.map(
																(row, i) => ({
																	rank: i + 1,
																	row,
																}),
															)}
															seasonId={
																standings.season
																	.id
															}
														/>
													)),
										})}
									</>
								)
							}}
						</AsyncContent>
					</>
				) : (
					<AsyncContent
						state={state}
						loadingLabel="Loading standings…"
					>
						{() => null}
					</AsyncContent>
				)}
			</div>
		</PageShell>
	)
}

/** Tooltips for the league's column abbreviations */
const COLUMN_TITLES: Record<string, string> = {
	GP: "Games played",
	W: "Wins",
	L: "Losses",
	T: "Ties",
	OTL: "Overtime losses",
	PTS: "Points",
	"PTS%": "Points percentage",
	GF: "Goals for",
	GFA: "Goals for per game",
	GA: "Goals against",
	GAA: "Goals against per game",
	PIM: "Penalty minutes",
}

interface RankedRow {
	rank: number
	row: KHLStandingsRow
	/** Only when divisions share a table */
	division?: string
}

/**
 * Every team in one table, best first: by points percentage (divisions play
 * different numbers of games), then points.
 */
const AllStandings = ({
	divisions,
	seasonId,
}: {
	divisions: KHLStandingsDivision[]
	seasonId: string
}) => {
	// Every division's columns, in the order they first appear
	const columns = [...new Set(divisions.flatMap((d) => d.columns))]
	const value = (row: KHLStandingsRow, column: string) => {
		const n = parseFloat(row.stats[column] ?? "")
		return Number.isNaN(n) ? -Infinity : n
	}
	const rows = divisions
		.flatMap((d) => d.rows.map((row) => ({row, division: d.name})))
		// Then points, so 4-0 beats 3-0. Stable: full ties keep league order.
		.sort(
			(x, y) =>
				value(y.row, "PTS%") - value(x.row, "PTS%") ||
				value(y.row, "PTS") - value(x.row, "PTS"),
		)
		.map((r, i) => ({...r, rank: i + 1}))
	return (
		<StandingsTable
			title={`All teams · ${rows.length}`}
			columns={columns}
			rows={rows}
			seasonId={seasonId}
			showDivision
		/>
	)
}

const StandingsTable = ({
	title,
	columns: statColumns,
	rows,
	seasonId,
	showDivision,
}: {
	title: string
	/** The league's stat columns, e.g. ["GP", "W", ...] */
	columns: string[]
	rows: RankedRow[]
	seasonId: string
	/** A Division column after the team, when divisions share a table */
	showDivision?: boolean
}) => {
	const columns: StatsTableColumn<RankedRow>[] = [
		{
			header: "Team",
			isLabel: true,
			// The cell leads with the rank; sort by the name
			sortValue: ({row}) => row.teamName.toLowerCase(),
			render: ({rank, row}) => (
				<span className="Standings-team">
					<span className="Standings-rank">{rank}</span>
					<TeamAvatar
						name={row.teamName}
						logoUrl={row.logoUrl}
						size={24}
					/>
					<TeamLink
						className="Standings-team-name"
						team={{id: row.teamId, name: row.teamName}}
						seasonId={seasonId}
					/>
				</span>
			),
		},
		...(showDivision
			? [
					{
						header: "Division",
						isLabel: true,
						className: "Standings-division",
						render: (r: RankedRow) => r.division,
					},
				]
			: []),
		...statColumns.map((column): StatsTableColumn<RankedRow> => ({
			header: column,
			title: COLUMN_TITLES[column],
			render: ({row}) =>
				column === "PTS" ? (
					<strong>{row.stats[column]}</strong>
				) : (
					row.stats[column]
				),
		})),
	]
	return (
		<Card title={title}>
			<div className="Standings-table">
				<StatsTable
					columns={columns}
					rows={rows}
					rowKey={({row}) => row.teamId}
				/>
			</div>
		</Card>
	)
}

export const TeamsRoute = {
	path: "/teams",
	title: "Teams",
	content: TeamsPage,
} as const satisfies Route
