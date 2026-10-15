import * as React from "react"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {Helmet} from "react-helmet"
import {
	GET_MATCHUP_ENDPOINT,
	LIST_TEAM_SEASONS_ENDPOINT,
	LIST_TEAMS_ENDPOINT,
	MatchupResponse,
	MatchupTeam,
	RosterPlayer,
	TeamsResponse,
} from "../../shared/ApiJson.js"
import {KHLSeason, KHLTeam} from "../../shared/KHLJson.js"
import {LIMITS, STRINGS} from "../../shared/KHLConfig.js"
import {
	AsyncContent,
	ErrorState,
	Link,
	PageShell,
	Picker,
	RosterPanels,
	RosterTables,
	TeamAvatar,
	TeamLink,
} from "../Components.js"
import {GameCards, HeadToHead} from "../Games.js"
import {
	AppContext,
	AsyncState,
	formatGameDate,
	formatScore,
	getGameHref,
	getPlayerHref,
	Route,
	RouteProps,
	useAsync,
	useNow,
} from "../Util.js"

/** Any two teams' seasons compared, like the league's game previews. */
const MatchupPage = ({query}: RouteProps) => {
	const {history} = React.useContext(AppContext)
	const params: MatchupParams = {
		a: query.get("a"),
		aSeason: query.get("aSeason"),
		b: query.get("b"),
		bSeason: query.get("bSeason"),
	}
	const {a, aSeason, b, bSeason} = params
	const teamsA = useTeams(aSeason)
	const teamsB = useTeams(bSeason)
	const teamA = findTeam(teamsA, a)
	const teamB = findTeam(teamsB, b)
	const seasonsA = useTeamSeasons(teamA)
	const seasonsB = useTeamSeasons(teamB)
	const isSamePick =
		teamA &&
		teamB &&
		teamA.id === teamB.id &&
		teamA.seasonId === teamB.seasonId
	const ready = teamA && teamB && !isSamePick
	const matchup = useAsync(
		() =>
			ready
				? doRequest(GET_MATCHUP_ENDPOINT, {
						a: teamA.id,
						b: teamB.id,
						aSeason: teamA.seasonId,
						bSeason: teamB.seasonId,
					})
				: Promise.resolve(null),
		[ready, teamA?.id, teamA?.seasonId, teamB?.id, teamB?.seasonId],
	)
	const now = useNow()
	const data = matchup.status === "success" ? matchup.data : null

	const setParams = (next: MatchupParams) => {
		const search = new URLSearchParams()
		for (const [key, value] of Object.entries(next)) {
			if (value) {
				search.set(key, value)
			}
		}
		const queryString = search.toString()
		// Picking teams isn't worth a back-button stop each
		history.replace(`/matchup${queryString ? `?${queryString}` : ""}`)
	}

	return (
		<PageShell>
			<div className="Detail">
				<Helmet>
					<title>
						{teamA && teamB
							? `${teamA.name} vs ${teamB.name}`
							: "Matchup"}{" "}
						| {STRINGS.PRODUCT_NAME}
					</title>
				</Helmet>
				<header className={cx("Detail-header", "Matchup-header")}>
					<MatchupSide
						teams={teamsA}
						team={teamA}
						teamSeasons={seasonsA}
						other={teamB}
						stats={data?.a ?? null}
						onTeamChange={(id) => setParams({...params, a: id})}
						// Team ids carry over between seasons, so keep the pick
						onSeasonChange={(id) =>
							setParams({...params, aSeason: id})
						}
					/>
					<div className="Matchup-center">
						<span className="Matchup-vs">vs</span>
						<button
							type="button"
							className="FilterPill"
							disabled={!a && !b && !aSeason && !bSeason}
							onClick={() =>
								setParams({
									a: b,
									aSeason: bSeason,
									b: a,
									bSeason: aSeason,
								})
							}
							title="Swap sides"
						>
							⇄ Swap
						</button>
					</div>
					<MatchupSide
						teams={teamsB}
						team={teamB}
						teamSeasons={seasonsB}
						other={teamA}
						stats={data?.b ?? null}
						onTeamChange={(id) => setParams({...params, b: id})}
						onSeasonChange={(id) =>
							setParams({...params, bSeason: id})
						}
					/>
				</header>
				{ready ? (
					<MatchupContent state={matchup} now={now} />
				) : (
					<p className="Detail-empty">
						Pick a team and season on each side to compare their
						records, head-to-head history, and leaders. Pick the
						same team twice to compare two of its seasons.
					</p>
				)}
			</div>
		</PageShell>
	)
}

interface MatchupParams {
	a: string | null
	aSeason: string | null
	b: string | null
	bSeason: string | null
}

/** A season's teams, for one side's pickers. Null means the current season. */
function useTeams(seasonId: string | null): AsyncState<TeamsResponse> {
	return useAsync(
		() => doRequest(LIST_TEAMS_ENDPOINT, {season: seasonId ?? undefined}),
		[seasonId],
	)
}

/**
 * The seasons `team` played, so its season picker only offers those. Null
 * without a team, or until they've loaded.
 */
function useTeamSeasons(team: KHLTeam | null): KHLSeason[] | null {
	const state = useAsync(
		() =>
			team
				? doRequest(LIST_TEAM_SEASONS_ENDPOINT, {
						teamId: team.id,
						season: team.seasonId,
					}).then((r) => r.seasons)
				: Promise.resolve(null),
		// A team's seasons are the same from any of them
		[team?.id],
	)
	return state.status === "success" ? state.data : null
}

function findTeam(
	teams: AsyncState<TeamsResponse>,
	teamId: string | null,
): KHLTeam | null {
	if (teams.status !== "success" || !teamId) {
		return null
	}
	return (
		teams.data.divisions
			.flatMap((d) => d.teams)
			.find((t) => t.id === teamId) ?? null
	)
}

const MatchupContent = ({
	state,
	now,
}: {
	state: AsyncState<MatchupResponse | null>
	now: Date
}) => {
	return (
		<AsyncContent state={state} errorTitle="Couldn't load this matchup">
			{(matchup) => {
				if (!matchup) {
					return null
				}
				// Name each side's season when they differ
				const showSeasons = matchup.a.season.id !== matchup.b.season.id
				return (
					<>
						{matchup.upcoming.length > 0 && (
							<section>
								<h2
									className={cx(
										"SectionLabel",
										"Detail-section-title",
									)}
								>
									Next meeting
								</h2>
								<GameCards
									games={matchup.upcoming}
									seasonId={matchup.currentSeason.id}
									now={now}
									limit={1}
								/>
							</section>
						)}
						<Comparison matchup={matchup} />
						{matchup.a.team.id !== matchup.b.team.id && (
							<HeadToHead
								left={matchup.a.team}
								right={matchup.b.team}
								games={matchup.headToHead}
								now={now}
							/>
						)}
						<TopScorers matchup={matchup} />
						<RosterPanels
							teams={[matchup.a, matchup.b].map((side) => ({
								team: side.team,
								roster: side.roster,
								note: showSeasons
									? side.season.name
									: undefined,
								title: side.season.name,
							}))}
						/>
					</>
				)
			}}
		</AsyncContent>
	)
}

/** How many skaters each side of "Top scorers" lists */
const TOP_SCORERS = 3

/** One side's season and team pickers, logo and record. */
const MatchupSide = ({
	teams,
	team,
	teamSeasons,
	other,
	stats,
	onTeamChange,
	onSeasonChange,
}: {
	teams: AsyncState<TeamsResponse>
	team: KHLTeam | null
	/** The seasons `team` played; null while loading or without a team */
	teamSeasons: KHLSeason[] | null
	/** The other side's pick, which can't be picked here too */
	other: KHLTeam | null
	stats: MatchupTeam | null
	onTeamChange: (teamId: string) => void
	onSeasonChange: (seasonId: string | null) => void
}) => {
	if (teams.status === "error") {
		return (
			<div className="Matchup-side">
				<ErrorState
					title="Couldn't load this season's teams"
					error={teams.error}
					onRetry={teams.reload}
					size="inline"
				/>
			</div>
		)
	}
	const data = teams.status === "success" ? teams.data : null
	return (
		<div className="Matchup-side">
			<TeamAvatar
				name={team?.name ?? "?"}
				logoUrl={team?.logoUrl ?? null}
				size={64}
			/>
			<TeamPicker
				teams={data}
				value={team}
				disabledId={
					other && other.seasonId === data?.season.id
						? other.id
						: null
				}
				onChange={onTeamChange}
			/>
			<SeasonPicker
				teams={data}
				// Before a team is picked, any season can be browsed for teams;
				// after, only the team's own seasons
				seasons={
					team ? (teamSeasons ?? (data ? [data.season] : null)) : null
				}
				onChange={(seasonId) =>
					// The current season is the default, so leave it out of the URL
					onSeasonChange(
						seasonId === data?.seasons[0]?.id ? null : seasonId,
					)
				}
			/>
			{stats && (
				<div className="Detail-meta">
					<span>{stats.divisionName}</span>
					<span>
						{stats.wins}-{stats.losses}-{stats.ties}
						<span className="Detail-meta-hint"> W-L-T</span>
					</span>
				</div>
			)}
		</div>
	)
}

const SeasonPicker = ({
	teams,
	seasons,
	onChange,
}: {
	/** Null while loading */
	teams: TeamsResponse | null
	/** The seasons to offer; null for every league season */
	seasons: KHLSeason[] | null
	onChange: (seasonId: string) => void
}) => {
	return (
		<Picker
			groups={[
				{
					label: "",
					items: (seasons ?? teams?.seasons ?? []).map((s) => ({
						value: s.id,
						label: s.name,
					})),
				},
			]}
			value={teams?.season.id ?? null}
			onChange={onChange}
			placeholder="Loading seasons…"
			disabled={!teams}
			className={cx("Matchup-picker", "Matchup-season")}
			title={teams?.season.name}
		/>
	)
}

const TeamPicker = ({
	teams,
	value,
	disabledId,
	onChange,
}: {
	/** Null while loading */
	teams: TeamsResponse | null
	value: KHLTeam | null
	disabledId: string | null
	onChange: (teamId: string) => void
}) => {
	return (
		<Picker
			groups={(teams?.divisions ?? []).map((division) => ({
				label: division.name,
				items: division.teams.map((t) => ({
					value: t.id,
					label: t.name,
					icon: (
						<TeamAvatar
							name={t.name}
							logoUrl={t.logoUrl}
							size={22}
						/>
					),
					disabled: t.id === disabledId,
				})),
			}))}
			value={value?.id ?? null}
			onChange={onChange}
			placeholder={teams ? "Choose a team" : "Loading teams…"}
			disabled={!teams}
			className="Matchup-picker"
		/>
	)
}

/** Which side a stat favors: more is better, less is better, or neither. */
type Better = "higher" | "lower" | null

type Side = "a" | "b"

interface ComparisonStat {
	label: string
	get: (team: MatchupTeam) => number
	format: (value: number) => string
	better: Better
	/** Draw bars; only for counts and rates, which can't be negative */
	bar: boolean
}

const perGame = (total: (t: MatchupTeam) => number) => (t: MatchupTeam) =>
	t.gamesPlayed > 0 ? total(t) / t.gamesPlayed : 0

const RECORD_STATS: ComparisonStat[] = [
	{
		label: "Wins",
		get: (t) => t.wins,
		format: String,
		better: "higher",
		bar: true,
	},
	{
		label: "Losses",
		get: (t) => t.losses,
		format: String,
		better: "lower",
		bar: true,
	},
	{
		label: "Ties",
		get: (t) => t.ties,
		format: String,
		better: null,
		bar: true,
	},
]

const GOAL_STATS: ComparisonStat[] = [
	{
		label: "For / game",
		get: perGame((t) => t.goalsFor),
		format: (v) => v.toFixed(2),
		better: "higher",
		bar: true,
	},
	{
		label: "Against / game",
		get: perGame((t) => t.goalsAgainst),
		format: (v) => v.toFixed(2),
		better: "lower",
		bar: true,
	},
	{
		label: "Differential",
		get: (t) => t.goalsFor - t.goalsAgainst,
		format: (v) => (v > 0 ? `+${v}` : String(v)),
		better: "higher",
		bar: false,
	},
]

/**
 * The two teams' seasons side by side: each row's label in the middle, each
 * team's value beside it, and bars in the team's color growing outward.
 */
const Comparison = ({matchup}: {matchup: MatchupResponse}) => {
	const {a, b} = matchup
	const sameSeason = a.season.id === b.season.id
	return (
		<section className={cx("Detail-panel", "Compare")}>
			<header className="Compare-head">
				<CompareTeam side="a" team={a} />
				<h2 className={cx("SectionLabel", "Compare-title")}>
					{sameSeason
						? a.season.id === matchup.currentSeason.id
							? "Season so far"
							: a.season.name
						: "Seasons"}
				</h2>
				<CompareTeam side="b" team={b} />
			</header>
			<CompareGroup label="Form">
				<CompareRow
					label="Last 10"
					a={<ResultChips results={a.recent} />}
					b={<ResultChips results={b.recent} />}
				/>
				{a.team.id !== b.team.id && <HeadToHeadRow matchup={matchup} />}
				<CompareRow
					label="Streak"
					a={<StreakChip team={a} />}
					b={<StreakChip team={b} />}
				/>
			</CompareGroup>
			<CompareGroup label="Record">
				{RECORD_STATS.map((stat) => (
					<StatRow key={stat.label} stat={stat} a={a} b={b} />
				))}
			</CompareGroup>
			<CompareGroup label="Goals">
				{GOAL_STATS.map((stat) => (
					<StatRow key={stat.label} stat={stat} a={a} b={b} />
				))}
			</CompareGroup>
		</section>
	)
}

/** A team's name, logo and color key, at its side of the comparison. */
const CompareTeam = ({side, team}: {side: Side; team: MatchupTeam}) => {
	return (
		<div className={cx("Compare-team", `Compare-team--${side}`)}>
			<TeamAvatar
				name={team.team.name}
				logoUrl={team.team.logoUrl}
				size={36}
			/>
			<div className="Compare-team-text">
				<div className="Compare-team-name">
					<span className="Compare-key" aria-hidden />
					<TeamLink team={team.team} seasonId={team.team.seasonId} />
				</div>
				<div className="Compare-team-meta" title={team.season.name}>
					{team.season.name} · {team.gamesPlayed} GP
				</div>
			</div>
		</div>
	)
}

const CompareGroup = ({
	label,
	children,
}: {
	label: string
	children: React.ReactNode
}) => {
	return (
		<div className="Compare-group" role="group" aria-label={label}>
			<h3 className="Compare-group-label">{label}</h3>
			{children}
		</div>
	)
}

/** One row: team A's cell, the label, team B's cell. */
const CompareRow = ({
	label,
	a,
	b,
	title,
}: {
	label: string
	a: React.ReactNode
	b: React.ReactNode
	/** Both values, on hover */
	title?: string
}) => {
	return (
		<div className="Compare-row" title={title}>
			<div className={cx("Compare-cell", "Compare-cell--a")}>{a}</div>
			<div className="Compare-label">{label}</div>
			<div className={cx("Compare-cell", "Compare-cell--b")}>{b}</div>
		</div>
	)
}

const StatRow = ({
	stat,
	a,
	b,
}: {
	stat: ComparisonStat
	a: MatchupTeam
	b: MatchupTeam
}) => {
	const valueA = stat.get(a)
	const valueB = stat.get(b)
	const leader: Side | null =
		stat.better === null || valueA === valueB
			? null
			: valueA > valueB === (stat.better === "higher")
				? "a"
				: "b"
	// Both bars share a scale, so the larger value fills its side
	const max = Math.max(valueA, valueB)
	const cell = (side: Side, value: number) => (
		<>
			<span
				className={cx(
					"Compare-value",
					leader === side && "Compare-value--leader",
				)}
			>
				{stat.format(value)}
			</span>
			{stat.bar && (
				<span className="Compare-track" aria-hidden>
					{max > 0 && value > 0 && (
						<span
							className={cx(
								"Compare-fill",
								leader !== null &&
									leader !== side &&
									"Compare-fill--trailing",
							)}
							style={{width: `${(value / max) * 100}%`}}
						/>
					)}
				</span>
			)}
		</>
	)
	return (
		<CompareRow
			label={stat.label}
			title={`${a.team.name} ${stat.format(valueA)} · ${b.team.name} ${stat.format(valueB)}`}
			a={cell("a", valueA)}
			b={cell("b", valueB)}
		/>
	)
}

interface ChipResult {
	key: string
	result: string
	/** Opens the game, when the league linked it */
	gameId?: string | null
	/** e.g. the score, on hover */
	title?: string
}

/** W/L/T chips, oldest first. */
const ResultChips = ({results}: {results: (string | ChipResult)[]}) => {
	if (results.length === 0) {
		return <span className="Compare-empty">No games yet</span>
	}
	return (
		<span className="Compare-chips">
			{results.map((r, i) => {
				const chip =
					typeof r === "string" ? {key: String(i), result: r} : r
				const className = cx(
					"GameFeed-result",
					`GameFeed-result--${chip.result}`,
					"Compare-chip",
				)
				return chip.gameId ? (
					<Link
						key={chip.key}
						href={getGameHref(chip.gameId)}
						className={className}
						title={chip.title}
					>
						{chip.result}
					</Link>
				) : (
					<span
						key={chip.key}
						className={className}
						title={chip.title}
					>
						{chip.result}
					</span>
				)
			})}
		</span>
	)
}

const StreakChip = ({team}: {team: MatchupTeam}) => {
	if (!team.streak) {
		return <span className="Compare-empty">–</span>
	}
	const {result, count} = team.streak
	const word = {W: "win", L: "loss", T: "tie"}[result] ?? result
	return (
		<span
			className={cx(
				"GameFeed-result",
				`GameFeed-result--${result}`,
				"Compare-streak",
			)}
			title={`${count} ${count === 1 ? word : word === "loss" ? "losses" : `${word}s`} in a row`}
		>
			{result}
			{count}
		</span>
	)
}

/**
 * Each side's latest meetings with the other team in its own season, or a
 * note that they didn't meet.
 */
const HeadToHeadRow = ({matchup}: {matchup: MatchupResponse}) => {
	const {a, b, currentSeason} = matchup
	const meetings = (
		team: MatchupTeam,
		opponent: MatchupTeam,
	): ChipResult[] => {
		return (
			matchup.headToHead
				// Newest first; unscored games have no result to show
				.filter((g) => g.seasonId === team.season.id && g.goals)
				.slice(0, LIMITS.MATCHUP_HEAD_TO_HEAD_GAMES)
				.reverse()
				.map((game) => {
					const own = game.goals![team.team.id]!
					const other = game.goals![opponent.team.id]!
					return {
						key: game.gameId ?? game.startsAt,
						gameId: game.gameId,
						result: own > other ? "W" : own < other ? "L" : "T",
						title: `${formatScore(own, other)} on ${formatGameDate(game.startsAt, new Date())}`,
					}
				})
		)
	}
	const meetingsA = meetings(a, b)
	const meetingsB = meetings(b, a)
	if (
		meetingsA.length === 0 &&
		meetingsB.length === 0 &&
		a.season.id === b.season.id
	) {
		const when =
			a.season.id === currentSeason.id
				? "this season"
				: `in ${a.season.name}`
		return (
			<div className={cx("Compare-row", "Compare-row--note")}>
				<div className="Compare-label">Head-to-head</div>
				<p className="Compare-note">
					They haven't played each other {when}.
				</p>
			</div>
		)
	}
	const cell = (results: ChipResult[], team: MatchupTeam) =>
		results.length === 0 ? (
			<span className="Compare-empty">None in {team.season.name}</span>
		) : (
			<ResultChips results={results} />
		)
	return (
		<CompareRow
			label="Head-to-head"
			a={cell(meetingsA, a)}
			b={cell(meetingsB, b)}
		/>
	)
}

/** Each team's top point scorers, side by side. */
const TopScorers = ({matchup}: {matchup: MatchupResponse}) => {
	const points = (p: RosterPlayer) => Number(p.stats["PTS"]) || 0
	const goals = (p: RosterPlayer) => Number(p.stats["G"]) || 0
	const top = (team: MatchupTeam) =>
		team.roster.skaters
			.filter((p) => points(p) > 0)
			.sort(
				(x, y) =>
					points(y) - points(x) ||
					goals(y) - goals(x) ||
					x.name.localeCompare(y.name),
			)
			.slice(0, TOP_SCORERS)
	return (
		<section className={cx("Detail-panel", "Compare")}>
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				Top scorers
			</h2>
			<div className="TopScorers">
				{(["a", "b"] as const).map((side) => {
					const team = matchup[side]
					const players = top(team)
					return (
						<div
							key={side}
							className={cx(
								"TopScorers-team",
								`Compare-team--${side}`,
							)}
						>
							<div className="Compare-team-name">
								<span className="Compare-key" aria-hidden />
								{team.team.name}
							</div>
							{players.length === 0 ? (
								<p className="Compare-empty">No points yet.</p>
							) : (
								<ol className="TopScorers-list">
									{players.map((p, i) => (
										<li
											key={p.khlPlayerId}
											className="TopScorers-row"
										>
											<span className="TopScorers-rank">
												{i + 1}
											</span>
											<span className="TopScorers-player">
												<Link
													className="TopScorers-name"
													href={getPlayerHref(
														p.playerId,
													)}
												>
													{p.name}
												</Link>
												<span className="TopScorers-line">
													{p.number &&
														`#${p.number} · `}
													{p.stats["G"] ?? 0} G ·{" "}
													{p.stats["A"] ?? 0} A ·{" "}
													{p.stats["GP"] ?? 0} GP
												</span>
											</span>
											<span className="TopScorers-points">
												{points(p)}
												<span className="TopScorers-unit">
													{" "}
													PTS
												</span>
											</span>
										</li>
									))}
								</ol>
							)}
						</div>
					)
				})}
			</div>
		</section>
	)
}

export const MatchupRoute = {
	path: "/matchup",
	title: "Matchup",
	content: MatchupPage,
} as const satisfies Route
