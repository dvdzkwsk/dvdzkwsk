import * as React from "react"
import {Tabs} from "@base-ui/react/tabs"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {Helmet} from "react-helmet"
import {
	GET_PLAYER_ENDPOINT,
	PlayerRegistration,
	PlayerResponse,
} from "../../shared/ApiJson.js"
import {KHLSeasonStatsRow} from "../../shared/KHLJson.js"
import {STRINGS} from "../../shared/KHLConfig.js"
import {
	AsyncContent,
	PageShell,
	Picker,
	PickerItem,
	StatsTable,
	StatsTableColumn,
	TeamAvatar,
	TeamLink,
} from "../Components.js"
import {GameCards, PastGames} from "../Games.js"
import {AppContext, Route, RouteProps, useAsync, useNow} from "../Util.js"

/** Keeps upcoming games to one row of cards */
const MAX_UPCOMING_GAMES = 3

const PlayerPage = ({params, query}: RouteProps) => {
	const {history} = React.useContext(AppContext)
	const playerId = params.playerId!
	const state = useAsync(
		() => doRequest(GET_PLAYER_ENDPOINT, {playerId}),
		[playerId],
	)
	const now = useNow()

	// ?team=<KHL player id> narrows the page to one of the player's teams. It's
	// pushed onto history so the back button returns to the previous view.
	const selectedTeam = query.get("team")
	const selectTeam = (khlPlayerId: string | null) => {
		const search = khlPlayerId
			? `?${new URLSearchParams({team: khlPlayerId})}`
			: ""
		if (search !== history.location.search) {
			history.push({pathname: history.location.pathname, search})
		}
	}

	return (
		<PageShell>
			<AsyncContent state={state}>
				{(player) => {
					const selected =
						player.registrations.find(
							(r) => r.khlPlayerId === selectedTeam,
						) ?? null
					const games = selected
						? player.games.filter(({game}) => {
								return (
									game.team.id === selected.teamId &&
									selected.seasonIds.includes(game.seasonId)
								)
							})
						: player.games
					const upcoming = (
						selected
							? player.upcoming.filter(({game}) => {
									return [
										game.homeTeam.id,
										game.awayTeam.id,
									].includes(selected.teamId)
								})
							: player.upcoming
					).slice(0, MAX_UPCOMING_GAMES)
					return (
						<div className="Detail">
							<Helmet>
								<title>
									{player.name} | {STRINGS.PRODUCT_NAME}
								</title>
							</Helmet>
							<PlayerHeader
								player={player}
								selected={selected}
								onSelectTeam={selectTeam}
							/>
							<section>
								<h2
									className={cx(
										"SectionLabel",
										"Detail-section-title",
									)}
								>
									Upcoming games
								</h2>
								<GameCards
									games={upcoming}
									seasonId={player.currentSeason.id}
									now={now}
								/>
							</section>
							<PastGames
								// Reset the list's scroll position when switching teams
								key={selected?.khlPlayerId ?? "all"}
								games={games}
								now={now}
								showTeam={
									!selected && player.registrations.length > 1
								}
							/>
							<PlayerStats player={player} selected={selected} />
						</div>
					)
				}}
			</AsyncContent>
		</PageShell>
	)
}

// KHL keeps rosters of folded teams in an "Inactive Teams" division
function isCurrentRegistration(player: PlayerResponse, r: PlayerRegistration) {
	return (
		r.seasonIds.includes(player.currentSeason.id) &&
		!r.profile?.teamLine?.endsWith("Inactive Teams")
	)
}

/** Stat card labels from the KHL player page, and our column headers. */
const STAT_COLUMNS: [label: string, header: string][] = [
	["Games Played", "GP"],
	["Goals", "G"],
	["Assists", "A"],
	["Points", "PTS"],
	["Average Points Per Game", "P/GP"],
	["Powerplay Goals", "PPG"],
	["Shorthanded Goals", "SHG"],
	["Penalty Minutes", "PIM"],
]

/** A registration's stat from its season section (index 0) or a titled one. */
function getStat(
	registration: PlayerRegistration,
	label: string,
	section: number | string,
): string {
	const sections = registration.profile?.statSections ?? []
	const match =
		typeof section === "string"
			? sections.find((s) => s.title === section)
			: sections[section]
	return match?.stats.find((s) => s.label === label)?.value ?? ""
}

function sumStat(
	registrations: PlayerRegistration[],
	label: string,
	section: number | string,
): number {
	return registrations.reduce((total, r) => {
		return total + (Number(getStat(r, label, section)) || 0)
	}, 0)
}

const PlayerHeader = ({
	player,
	selected,
	onSelectTeam,
}: {
	player: PlayerResponse
	selected: PlayerRegistration | null
	onSelectTeam: (khlPlayerId: string | null) => void
}) => {
	const current = player.registrations.filter((r) => {
		return isCurrentRegistration(player, r)
	})
	const past = player.registrations.filter((r) => !current.includes(r))
	const numbers = [
		...new Set(current.flatMap((r) => r.profile?.number ?? [])),
	]
	const position = player.registrations.find((r) => r.profile?.position)
		?.profile?.position
	const totals = (
		registrations: PlayerRegistration[],
		section: number | string,
	) => {
		const gp = sumStat(registrations, "Games Played", section)
		const g = sumStat(registrations, "Goals", section)
		const a = sumStat(registrations, "Assists", section)
		return `${gp} GP · ${g} G · ${a} A · ${g + a} PTS`
	}

	return (
		<header className="Detail-header Detail-header--player">
			<div className="Detail-heading">
				<h1 className="Detail-name">{player.name}</h1>
				<div className="Detail-meta">
					{[numbers.map((n) => `#${n}`).join(" / "), position]
						.filter(Boolean)
						.map((text) => (
							<span key={text}>{text}</span>
						))}
				</div>
				<div className="Detail-totals">
					{current.length > 0 && (
						<span>
							<span className="Detail-meta-hint">
								This season{" "}
							</span>
							{totals(current, 0)}
						</span>
					)}
					<span>
						<span className="Detail-meta-hint">Career </span>
						{totals(player.registrations, "Career Stats")}
					</span>
				</div>
			</div>

			{player.registrations.length > 1 && (
				<Picker
					groups={[
						{
							label: "",
							items: [{value: ALL_TEAMS, label: "All teams"}],
						},
						{label: "Current", items: current.map(toTeamItem)},
						{label: "Past", items: past.map(toTeamItem)},
					].filter((group) => group.items.length > 0)}
					value={selected?.khlPlayerId ?? ALL_TEAMS}
					onChange={(value) =>
						onSelectTeam(value === ALL_TEAMS ? null : value)
					}
					placeholder="Team"
					className="Detail-select"
				/>
			)}

			{player.unavailableSchedules.length > 0 && (
				<p className="Detail-note">
					The KHL site couldn't load{" "}
					{player.unavailableSchedules.length === 1
						? "one schedule"
						: `${player.unavailableSchedules.length} schedules`}
					, so those games are missing:{" "}
					{player.unavailableSchedules
						.map(
							(s) =>
								`${s.teamName} (${s.seasonName ?? `season ${s.seasonId}`})`,
						)
						.join(", ")}
					.
				</p>
			)}
		</header>
	)
}

const ALL_TEAMS = "all"

/** "Division 5B", from the profile's "Stingers - Division 5B" line. */
function getDivision(registration: PlayerRegistration): string {
	return registration.profile?.teamLine?.split(" - ").at(-1) ?? ""
}

function toTeamItem(r: PlayerRegistration): PickerItem {
	const seasons = `${r.seasonIds.length} ${r.seasonIds.length === 1 ? "season" : "seasons"}`
	return {
		value: r.khlPlayerId,
		label: r.teamName,
		icon: (
			<TeamAvatar name={r.teamName} logoUrl={r.teamLogoUrl} size={20} />
		),
		hint: getDivision(r) || seasons,
	}
}

/** Season table columns, keyed by the KHL's headers. */
const HISTORY_COLUMNS = ["GP", "G", "A", "PTS", "PIM"]

interface HistoryRow extends KHLSeasonStatsRow {
	/** "Regular Season", "Playoffs" or "Tournaments" */
	type: string
}

/** Career / this season / history tabs; they follow the team filter. */
const PlayerStats = ({
	player,
	selected,
}: {
	player: PlayerResponse
	selected: PlayerRegistration | null
}) => {
	const registrations = selected ? [selected] : player.registrations
	const current = registrations.filter((r) =>
		isCurrentRegistration(player, r),
	)

	// KHL tracks stats per registration; merge every registration's season
	// tables into one history, newest first.
	const history: HistoryRow[] = registrations
		.flatMap((r) => {
			return (r.profile?.seasonTables ?? []).flatMap((table) => {
				return table.rows.map((row) => ({...row, type: table.title}))
			})
		})
		.sort((a, b) => Number(b.seasonId) - Number(a.seasonId))

	return (
		<section className="Detail-panel">
			<Tabs.Root defaultValue="career">
				<Tabs.List className="Tabs-list">
					<Tabs.Tab className="Tabs-tab" value="career">
						Career
					</Tabs.Tab>
					<Tabs.Tab className="Tabs-tab" value="season">
						This season
					</Tabs.Tab>
					<Tabs.Tab className="Tabs-tab" value="history">
						By season
					</Tabs.Tab>
					<Tabs.Indicator className="Tabs-indicator" />
				</Tabs.List>
				<Tabs.Panel value="season">
					{current.length > 0 ? (
						<StatsByTeam registrations={current} section={0} />
					) : (
						<p className="Detail-empty">
							{selected
								? `Not on ${selected.teamName} in ${player.currentSeason.name}.`
								: `Not on a team in ${player.currentSeason.name}.`}
						</p>
					)}
				</Tabs.Panel>
				<Tabs.Panel value="career">
					<StatsByTeam
						registrations={registrations}
						section="Career Stats"
						showTotal
					/>
				</Tabs.Panel>
				<Tabs.Panel value="history">
					<StatsTable<HistoryRow>
						rows={history}
						rowKey={(row) =>
							`${row.type}:${row.seasonId}:${row.teamId}`
						}
						columns={[
							{
								header: "Season",
								isLabel: true,
								render: (row) => row.seasonName,
							},
							{
								header: "Team",
								isLabel: true,
								render: (row) => (
									<TeamLink
										team={{
											id: row.teamId,
											name: row.teamName,
										}}
										seasonId={row.seasonId}
									/>
								),
							},
							{
								header: "Division",
								isLabel: true,
								render: (row) => row.stats.Division ?? "",
							},
							...HISTORY_COLUMNS.map((column) => ({
								header: column,
								render: (row: HistoryRow) =>
									row.stats[column] ?? "",
							})),
						]}
					/>
				</Tabs.Panel>
			</Tabs.Root>
		</section>
	)
}

type StatsRow =
	{kind: "registration"; registration: PlayerRegistration} | {kind: "total"}

const StatsByTeam = ({
	registrations,
	section,
	showTotal,
}: {
	registrations: PlayerRegistration[]
	/** The profile's season section (0) or a titled one, e.g. "Career Stats" */
	section: number | string
	showTotal?: boolean
}) => {
	const getTotal = (label: string) => {
		if (label === "Average Points Per Game") {
			const gamesPlayed = sumStat(registrations, "Games Played", section)
			const points = sumStat(registrations, "Points", section)
			return gamesPlayed ? (points / gamesPlayed).toFixed(2) : "0.00"
		}
		return String(sumStat(registrations, label, section))
	}
	const rows: StatsRow[] = registrations.map((registration) => ({
		kind: "registration",
		registration,
	}))
	if (showTotal && registrations.length > 1) {
		rows.push({kind: "total"})
	}
	const columns: StatsTableColumn<StatsRow>[] = [
		{
			header: "Team",
			isLabel: true,
			render: (row) =>
				row.kind === "total" ? (
					"Total"
				) : (
					<TeamLink
						team={{
							id: row.registration.teamId,
							name: row.registration.teamName,
						}}
						seasonId={row.registration.seasonIds.at(-1)!}
					/>
				),
		},
		{
			header: "Division",
			isLabel: true,
			render: (row) =>
				row.kind === "total" ? "" : getDivision(row.registration),
		},
		...STAT_COLUMNS.map(([label, header]) => ({
			header,
			render: (row: StatsRow) =>
				row.kind === "total"
					? getTotal(label)
					: getStat(row.registration, label, section),
		})),
	]
	return (
		<StatsTable
			rows={rows}
			rowKey={(row) =>
				row.kind === "total" ? "total" : row.registration.khlPlayerId
			}
			rowClassName={(row) =>
				row.kind === "total" ? "StatsTable-total" : undefined
			}
			columns={columns}
		/>
	)
}

export const PlayerRoute = {
	path: "/players/:playerId",
	title: "Player",
	content: PlayerPage,
} as const satisfies Route
