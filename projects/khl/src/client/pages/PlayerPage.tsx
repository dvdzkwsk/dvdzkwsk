import {Tabs} from "@base-ui/react/tabs"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import * as React from "react"
import {
	GET_PLAYER_ACTIVITY_ENDPOINT,
	GET_PLAYER_ENDPOINT,
	GET_PLAYER_RECENT_PENALTIES_ENDPOINT,
	PlayerRegistration,
	PlayerResponse,
} from "../../shared/ApiJson.js"
import {KHLSeasonStatsRow} from "../../shared/KHLJson.js"
import {ActivityFeed} from "../Activity.js"
import {BadgeHint, BadgeIcon, getBadges} from "../Badges.js"
import {
	AsyncContent,
	Hint,
	Link,
	PageShell,
	PageTitle,
	Picker,
	PickerItem,
	StatsTable,
	StatsTableColumn,
	TeamAvatar,
	TeamLink,
	Warnings,
} from "../Components.js"
import {
	GameCards,
	HeroLastResults,
	HeroStatGroup,
	PastGames,
	SkippedGames,
} from "../Games.js"
import {
	AppContext,
	getBadgesHref,
	Route,
	RouteProps,
	useAsync,
	useNow,
} from "../Util.js"

/** Keeps upcoming games to one row of cards */
const MAX_UPCOMING_GAMES = 3
const MAX_PAST_GAMES = 20

const PlayerPage = ({params, query}: RouteProps) => {
	const {history} = React.useContext(AppContext)
	const playerId = params.playerId!
	const state = useAsync(
		() => doRequest(GET_PLAYER_ENDPOINT, {playerId}),
		[playerId],
	)
	// Separate from the player, since it reads a box score per recent game
	const activity = useAsync(
		() => doRequest(GET_PLAYER_ACTIVITY_ENDPOINT, {playerId}),
		[playerId],
	)
	// The games the player sat out, from each recent game's lineup. Until
	// they load, the lists that leave them out wait; if they fail, every
	// team game shows.
	const skippedState = useAsync(() => {
		return doRequest(GET_PLAYER_ACTIVITY_ENDPOINT, {
			playerId,
			kinds: ["skipped"],
		})
	}, [playerId])
	const skipped: SkippedGames =
		skippedState.status === "loading"
			? "loading"
			: new Set(
					skippedState.status === "success"
						? skippedState.data.games.map((g) => g.gameId)
						: [],
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
			<AsyncContent
				state={state}
				loadingLabel="Loading player details…"
				slowNote="Still working. This is the first time we're loading this player's details, so it will take a little bit longer."
			>
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
							<PageTitle>{player.name}</PageTitle>
							{player.registrations.length > 1 && (
								<div className="Detail-toolbar">
									<PlayerTeamPicker
										player={player}
										selected={selected}
										onSelectTeam={selectTeam}
									/>
								</div>
							)}
							<PlayerHeader player={player} skipped={skipped} />
							{player.unavailableSchedules.length > 0 && (
								<Warnings
									summary={`${
										player.unavailableSchedules.length === 1
											? "A schedule"
											: `${player.unavailableSchedules.length} schedules`
									} couldn't be loaded, so some past games are missing`}
									detail={`The league's site returned an error for ${
										player.unavailableSchedules.length === 1
											? "this schedule, so its"
											: "these schedules, so their"
									} games aren't in Recent games. Season and career totals come from the player's stats and aren't affected.`}
									items={player.unavailableSchedules.map(
										(schedule) => ({
											key: `${schedule.teamId}:${schedule.seasonId}`,
											label: (
												<TeamLink
													team={{
														id: schedule.teamId,
														name: schedule.teamName,
													}}
													seasonId={schedule.seasonId}
												/>
											),
											meta:
												schedule.seasonName ??
												`Season ${schedule.seasonId}`,
										}),
									)}
									onRetry={state.reload}
								/>
							)}
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
							<div className="Detail-columns">
								<PastGames
									// Reset the list's scroll position when switching teams
									key={selected?.khlPlayerId ?? "all"}
									games={games}
									now={now}
									getTeamLogoUrl={(teamId) =>
										player.registrations.find(
											(r) => r.teamId === teamId,
										)?.teamLogoUrl ?? null
									}
									limit={MAX_PAST_GAMES}
									skipped={skipped}
								/>
								<ActivityFeed
									state={activity}
									subject="player"
									now={now}
								/>
							</div>
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

/** Which of the player's teams to show: all of them, or one */
const PlayerTeamPicker = ({
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
	return (
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
	)
}

const PlayerHeader = ({
	player,
	skipped,
}: {
	player: PlayerResponse
	skipped: SkippedGames
}) => {
	const current = player.registrations.filter((r) => {
		return isCurrentRegistration(player, r)
	})
	const position = player.registrations.find((r) => r.profile?.position)
		?.profile?.position
	const totals = (
		registrations: PlayerRegistration[],
		section: number | string,
	) => {
		const gp = sumStat(registrations, "Games Played", section)
		const g = sumStat(registrations, "Goals", section)
		const a = sumStat(registrations, "Assists", section)
		const pim = sumStat(registrations, "Penalty Minutes", section)
		return {GP: gp, G: g, A: a, PTS: g + a, PIM: pim}
	}

	return (
		<header className="Detail-header Detail-header--player">
			<div className="PlayerHero">
				<div className="PlayerHero-identity">
					<div className="PlayerHero-heading">
						<h1 className="PlayerHero-name">{player.name}</h1>
						{position && (
							<span className="PlayerHero-position">
								{position}
							</span>
						)}
					</div>
					<div className="PlayerHero-bio">
						{current.map((r) => {
							// "#43 · Division 7A": numbers differ between teams
							const detail = [
								r.profile?.number && `#${r.profile.number}`,
								getDivision(r),
							]
								.filter(Boolean)
								.join(" · ")
							return (
								<span
									key={r.khlPlayerId}
									className="PlayerHero-team"
								>
									<TeamAvatar
										name={r.teamName}
										logoUrl={r.teamLogoUrl}
										size={32}
									/>
									<span className="PlayerHero-team-text">
										<TeamLink
											team={{
												id: r.teamId,
												name: r.teamName,
											}}
											seasonId={player.currentSeason.id}
										/>
										{detail && (
											<span className="PlayerHero-division">
												{detail}
											</span>
										)}
									</span>
								</span>
							)
						})}
					</div>
				</div>
				<div className="PlayerHero-stats">
					{current.length > 0 && (
						<HeroStatGroup
							label="This season"
							stats={totals(current, 0)}
						/>
					)}
					<HeroStatGroup
						label="Career"
						stats={totals(player.registrations, "Career Stats")}
					/>
					<HeroLastResults games={player.games} skipped={skipped} />

					<PlayerBadges player={player} />
				</div>
			</div>
		</header>
	)
}

/**
 * Recent penalties load separately, since they read a page per game; until
 * they arrive (or if they fail), the Angel and Devil badges are left out.
 */
const PlayerBadges = ({player}: {player: PlayerResponse}) => {
	const recent = useAsync(() => {
		return doRequest(GET_PLAYER_RECENT_PENALTIES_ENDPOINT, {
			playerId: player.playerId,
		})
	}, [player.playerId])
	const badges = getBadges({
		name: player.name,
		gamesPlayed: sumStat(
			player.registrations,
			"Games Played",
			"Career Stats",
		),
		recentPenalties: recent.status === "success" ? recent.data : null,
	})
	if (badges.length === 0) {
		return null
	}
	return (
		<section className="PlayerHero-group" aria-label="Badges">
			<h2 className="PlayerHero-group-label">
				<Link href={getBadgesHref()} className="PlayerBadges-link">
					Badges
				</Link>
			</h2>
			<ul className="PlayerBadges">
				{badges.map(({badge, count}) => (
					<Hint
						key={badge.id}
						label={<BadgeHint badge={badge} count={count} />}
					>
						<li
							className="PlayerBadges-badge"
							tabIndex={0}
							aria-label={`${badge.label}${count > 1 ? ` ×${count}` : ""}: ${badge.description}`}
						>
							<BadgeIcon badge={badge} count={count} />
						</li>
					</Hint>
				))}
			</ul>
		</section>
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
	/** "Regular Season", "Playoffs", or "Tournaments" */
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
								// Season ids count up, so newest first
								sortValue: (row) => Number(row.seasonId),
								sortAscendingFirst: false,
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
					<span className="StatsTable-team">
						<TeamAvatar
							name={row.registration.teamName}
							logoUrl={row.registration.teamLogoUrl}
							size={24}
						/>
						<TeamLink
							team={{
								id: row.registration.teamId,
								name: row.registration.teamName,
							}}
							seasonId={row.registration.seasonIds.at(-1)!}
						/>
					</span>
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
