import {Tabs} from "@base-ui/react/tabs"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {matchFn, matchField, matchValue} from "@dvdzkwsk/util/MatchUtil"
import * as React from "react"
import {
	ActivityOptions,
	ActivityResponse,
	GET_PLAYER_ACTIVITY_ENDPOINT,
	GET_PLAYER_ENDPOINT,
	toRegistrationKey,
	PlayerRegistration,
	PlayerResponse,
} from "../../shared/ApiJson.js"
import {LIMITS} from "../../shared/KHLConfig.js"
import {KHLSeasonStatsRow} from "../../shared/KHLJson.js"
import {
	AchievementHint,
	AchievementIcon,
	getAchievements,
	RecentPenalties,
	toRecentPenalties,
} from "../Achievements.js"
import {ActivityFeed, toActivityFeed, useActivityRefresh} from "../Activity.js"
import {
	AsyncContent,
	Card,
	InfoPopover,
	Link,
	Notice,
	PageShell,
	PageTitle,
	Picker,
	PickerItem,
	Section,
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
import {PlayerIntegrityReport} from "../Integrity.js"
import {
	AppContext,
	AsyncState,
	getAchievementsHref,
	Route,
	RouteProps,
	useAsync,
	useNow,
} from "../Util.js"

/** Keeps upcoming games to one row of cards */
const MAX_UPCOMING_GAMES = 3
const MAX_PAST_GAMES = 20

/**
 * Everything the page shows from recent scoresheets, in one request since it
 * reads a page or two per game: the activity feed, the games the player sat
 * out, and the achievements' penalty trend, which counts every game they dressed for
 * in its window
 */
const PLAYER_PAGE_ACTIVITY: ActivityOptions = {
	kinds: ["goal", "assist", "penalty", "played", "skipped"],
	days: LIMITS.ACHIEVEMENT_TREND_LOOKBACK_DAYS,
	limit: LIMITS.ACTIVITY_MAX_EVENTS,
}

const PlayerPage = (props: RouteProps) => {
	// ?integrity swaps the profile for a report comparing it with the KHL
	if (props.query.has("integrity")) {
		return (
			<PageShell>
				<PlayerIntegrityReport
					key={props.params.playerId}
					playerId={props.params.playerId!}
				/>
			</PageShell>
		)
	}
	return <PlayerProfile {...props} />
}

const PlayerProfile = ({params, query}: RouteProps) => {
	const {history} = React.useContext(AppContext)
	const playerId = params.playerId!
	const state = useAsync(
		() => doRequest(GET_PLAYER_ENDPOINT, {playerId}),
		[playerId],
	)
	// Separate from the player, since it reads a box score per recent game
	const activity = useAsync(() => {
		return doRequest(GET_PLAYER_ACTIVITY_ENDPOINT, {
			playerId,
			...PLAYER_PAGE_ACTIVITY,
		})
	}, [playerId])
	useActivityRefresh(activity)
	const feed: AsyncState<ActivityResponse> = matchField(activity, "status", {
		loading: (s) => s,
		error: (s) => s,
		success: (s) => ({...s, data: toActivityFeed(s.data)}),
	})
	// The games the player sat out, from each recent game's lineup. Until
	// they load, the lists that leave them out wait; if they fail, every
	// team game shows.
	const skipped: SkippedGames = matchField(activity, "status", {
		loading: () => "loading" as const,
		error: () => new Set<string>(),
		success: (s) =>
			new Set(
				s.data.games
					.filter((g) =>
						matchValue(g.attendance, {
							played: false,
							skipped: true,
						}),
					)
					.map((g) => g.gameId),
			),
	})
	// Games still being loaded from the KHL site, left out of the activity
	const pendingGames = matchField(activity, "status", {
		loading: () => 0,
		error: () => 0,
		success: (s) => s.data.pendingGames,
	})
	// Until they load (or if they fail), the Angel and Devil achievements are
	// left out, and while some games are pending, since the trend would be
	// missing them
	const recentPenalties = matchField(activity, "status", {
		loading: () => null,
		error: () => null,
		success: (s) =>
			s.data.pendingGames > 0 ? null : toRecentPenalties(s.data),
	})
	const now = useNow()

	// ?team=<registration key> narrows the page to one of the player's teams.
	// It's pushed onto history so the back button returns to the previous view.
	const selectedTeam = query.get("team")
	const selectTeam = (registrationKey: string | null) => {
		const search = registrationKey
			? `?${new URLSearchParams({team: registrationKey})}`
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
							(r) => toRegistrationKey(r) === selectedTeam,
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
							<PlayerHeader
								player={player}
								skipped={skipped}
								recentPenalties={recentPenalties}
							/>
							{pendingGames > 0 && (
								<Notice
									loading
									title={`Still loading ${pendingGames} ${
										pendingGames === 1 ? "game" : "games"
									} from the KHL site`}
								>
									Recent activity, skipped games, and the
									Angel and Devil achievements will fill in as{" "}
									{pendingGames === 1
										? "it loads"
										: "they load"}
									, usually within a minute or two.
								</Notice>
							)}
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
							<Section title="Upcoming games">
								<GameCards
									games={upcoming}
									seasonId={player.currentSeason.id}
									now={now}
								/>
							</Section>
							<div className="Detail-columns">
								<PastGames
									// Reset the list's scroll position when switching teams
									key={
										selected
											? toRegistrationKey(selected)
											: "all"
									}
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
									state={feed}
									subject="player"
									now={now}
									pendingNote={false}
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

/**
 * Stat card labels from the KHL player page, our column headers, and the
 * matching season table column (where "PPG" is points per game, so P/GP is
 * computed instead).
 */
const STAT_COLUMNS: [label: string, header: string, tableColumn: string][] = [
	["Games Played", "GP", "GP"],
	["Goals", "G", "G"],
	["Assists", "A", "A"],
	["Points", "PTS", "PTS"],
	["Average Points Per Game", "P/GP", ""],
	["Powerplay Goals", "PPG", "PP"],
	["Shorthanded Goals", "SHG", "SH"],
	["Penalty Minutes", "PIM", "PIM"],
]

/**
 * The profile's season card is per team, but its career card and season
 * tables cover the whole KHL player id, which can span several teams. Career
 * stats are summed from the season table rows for the registration's team,
 * so a shared id isn't counted once per team.
 */
type StatScope = "season" | "career"

function getStat(
	registration: PlayerRegistration,
	label: string,
	scope: StatScope,
): string {
	return matchFn(scope, {
		season: () => {
			const section = registration.profile?.statSections[0]
			return section?.stats.find((s) => s.label === label)?.value ?? ""
		},
		career: () => {
			const rows = getTeamHistory(registration)
			const sum = (column: string) => {
				return rows.reduce((total, row) => {
					return total + (Number(row.stats[column]) || 0)
				}, 0)
			}
			if (label === "Average Points Per Game") {
				const gamesPlayed = sum("GP")
				return gamesPlayed
					? (sum("PTS") / gamesPlayed).toFixed(2)
					: "0.00"
			}
			const column = STAT_COLUMNS.find(([l]) => l === label)?.[2]
			return column ? String(sum(column)) : ""
		},
	})
}

function sumStat(
	registrations: PlayerRegistration[],
	label: string,
	scope: StatScope,
): number {
	return registrations.reduce((total, r) => {
		return total + (Number(getStat(r, label, scope)) || 0)
	}, 0)
}

/** The registration's season table rows for its own team */
function getTeamHistory(registration: PlayerRegistration): HistoryRow[] {
	return (registration.profile?.seasonTables ?? []).flatMap((table) => {
		return table.rows
			.filter((row) => row.teamId === registration.teamId)
			.map((row) => ({...row, type: table.title}))
	})
}

/** Which of the player's teams to show: all of them, or one */
const PlayerTeamPicker = ({
	player,
	selected,
	onSelectTeam,
}: {
	player: PlayerResponse
	selected: PlayerRegistration | null
	onSelectTeam: (registrationKey: string | null) => void
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
			value={selected ? toRegistrationKey(selected) : ALL_TEAMS}
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
	recentPenalties,
}: {
	player: PlayerResponse
	skipped: SkippedGames
	recentPenalties: RecentPenalties | null
}) => {
	const current = player.registrations.filter((r) => {
		return isCurrentRegistration(player, r)
	})
	const position = player.registrations.find((r) => r.profile?.position)
		?.profile?.position
	const totals = (registrations: PlayerRegistration[], scope: StatScope) => {
		const gp = sumStat(registrations, "Games Played", scope)
		const g = sumStat(registrations, "Goals", scope)
		const a = sumStat(registrations, "Assists", scope)
		const pim = sumStat(registrations, "Penalty Minutes", scope)
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
									key={toRegistrationKey(r)}
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
							stats={totals(current, "season")}
						/>
					)}
					<HeroStatGroup
						label="Career"
						stats={totals(player.registrations, "career")}
					/>
					<HeroLastResults games={player.games} skipped={skipped} />

					<PlayerAchievements
						player={player}
						recentPenalties={recentPenalties}
					/>
				</div>
			</div>
		</header>
	)
}

/** Null `recentPenalties` (still loading, or failed) leaves out the trend achievements */
const PlayerAchievements = ({
	player,
	recentPenalties,
}: {
	player: PlayerResponse
	recentPenalties: RecentPenalties | null
}) => {
	const achievements = getAchievements({
		name: player.name,
		gamesPlayed: sumStat(player.registrations, "Games Played", "career"),
		recentPenalties,
	})
	if (achievements.length === 0) {
		return null
	}
	return (
		<section className="PlayerHero-group" aria-label="Achievements">
			<h2 className="PlayerHero-group-label">
				<Link
					href={getAchievementsHref()}
					className="PlayerAchievements-link"
				>
					Achievements
				</Link>
			</h2>
			<ul className="PlayerAchievements">
				{/* A popover rather than a Hint, so a tap explains the icon on
				    phones, where there's no hover */}
				{achievements.map(({achievement, count}) => (
					<li key={achievement.id}>
						<InfoPopover
							trigger={
								<button
									type="button"
									className="PlayerAchievements-achievement"
									aria-label={`${achievement.label}${count > 1 ? ` ×${count}` : ""}: ${achievement.description}`}
								>
									<AchievementIcon
										achievement={achievement}
										count={count}
									/>
								</button>
							}
						>
							<AchievementHint
								achievement={achievement}
								count={count}
							/>
						</InfoPopover>
					</li>
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
		value: toRegistrationKey(r),
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

	// Merge every registration's seasons into one history, newest first
	const history: HistoryRow[] = registrations
		.flatMap(getTeamHistory)
		.sort((a, b) => Number(b.seasonId) - Number(a.seasonId))

	return (
		<Card>
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
						<StatsByTeam registrations={current} scope="season" />
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
						scope="career"
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
		</Card>
	)
}

type StatsRow =
	{kind: "registration"; registration: PlayerRegistration} | {kind: "total"}

const StatsByTeam = ({
	registrations,
	scope,
	showTotal,
}: {
	registrations: PlayerRegistration[]
	scope: StatScope
	showTotal?: boolean
}) => {
	const getTotal = (label: string) => {
		if (label === "Average Points Per Game") {
			const gamesPlayed = sumStat(registrations, "Games Played", scope)
			const points = sumStat(registrations, "Points", scope)
			return gamesPlayed ? (points / gamesPlayed).toFixed(2) : "0.00"
		}
		return String(sumStat(registrations, label, scope))
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
				matchField(row, "kind", {
					total: () => "Total",
					registration: ({registration}) => (
						<span className="StatsTable-team">
							<TeamAvatar
								name={registration.teamName}
								logoUrl={registration.teamLogoUrl}
								size={24}
							/>
							<TeamLink
								team={{
									id: registration.teamId,
									name: registration.teamName,
								}}
								seasonId={registration.seasonIds.at(-1)!}
							/>
						</span>
					),
				}),
		},
		{
			header: "Division",
			isLabel: true,
			render: (row) =>
				matchField(row, "kind", {
					total: () => "",
					registration: (r) => getDivision(r.registration),
				}),
		},
		...STAT_COLUMNS.map(([label, header]) => ({
			header,
			render: (row: StatsRow) =>
				matchField(row, "kind", {
					total: () => getTotal(label),
					registration: (r) => getStat(r.registration, label, scope),
				}),
		})),
	]
	return (
		<StatsTable
			rows={rows}
			rowKey={(row) =>
				matchField(row, "kind", {
					total: () => "total",
					registration: (r) => toRegistrationKey(r.registration),
				})
			}
			rowClassName={(row) =>
				matchField(row, "kind", {
					total: () => "StatsTable-total",
					registration: () => undefined,
				})
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
