import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {Helmet} from "react-helmet"
import {GameResponse, GET_GAME_ENDPOINT} from "../../shared/ApiJson.js"
import {
	KHLBoxScoreTeam,
	KHLGoal,
	KHLPenalty,
	KHLPlayerRef,
} from "../../shared/KHLJson.js"
import {LEAGUE, STRINGS, URLS} from "../../shared/KHLConfig.js"
import {
	AsyncContent,
	HomeAwayBadge,
	Link,
	LiveBarnBadge,
	NotOnLiveBarn,
	PageShell,
	RinkLink,
	RosterPanels,
	StatsTable,
	StatsTableColumn,
	TeamAvatar,
	TeamLink,
} from "../Components.js"
import {HeadToHead} from "../Games.js"
import {
	formatGameDate,
	formatGameTime,
	formatScore,
	getPlayerHref,
	Route,
	RouteProps,
	useAsync,
	useNow,
} from "../Util.js"

const GamePage = ({params}: RouteProps) => {
	const gameId = params.gameId!
	const state = useAsync(
		() => doRequest(GET_GAME_ENDPOINT, {gameId}),
		[gameId],
	)
	const now = useNow()
	return (
		<PageShell>
			<AsyncContent state={state}>
				{(game) => (
					<div className="Detail">
						<Helmet>
							<title>
								{game.boxScore.away.name} @{" "}
								{game.boxScore.home.name} |{" "}
								{STRINGS.PRODUCT_NAME}
							</title>
						</Helmet>
						<GameHeader game={game} now={now} />
						{game.boxScore.hasSummary ? (
							<div className="Detail-columns">
								<PeriodTotals game={game} />
								<Timeline game={game} />
							</div>
						) : (
							<>
								{getGameState(game, now) !== "upcoming" && (
									<p className="Detail-empty">
										The league hasn't posted a box score for
										this game yet.
									</p>
								)}
							</>
						)}
						<HeadToHead
							left={game.boxScore.away}
							right={game.boxScore.home}
							games={game.headToHead}
							now={now}
						/>
						{/* Until the box score is posted, preview each side's roster */}
						{game.rosters && (
							<RosterPanels
								teams={[
									{
										team: game.boxScore.away,
										roster: game.rosters.away,
									},
									{
										team: game.boxScore.home,
										roster: game.rosters.home,
									},
								]}
							/>
						)}
					</div>
				)}
			</AsyncContent>
		</PageShell>
	)
}

const GameHeader = ({game, now}: {game: GameResponse; now: Date}) => {
	const {boxScore} = game
	return (
		<header className={cx("Detail-header", "BoxScore-header")}>
			<HeaderTeam team={boxScore.away} homeAway="away" />
			<div className="BoxScore-center">
				<div className="BoxScore-score">
					{boxScore.hasSummary &&
					boxScore.away.goals !== null &&
					boxScore.home.goals !== null
						? formatScore(boxScore.away.goals, boxScore.home.goals)
						: "vs"}
				</div>
				<div className="Detail-meta">
					{formatGameDate(boxScore.startsAt, now)} ·{" "}
					{formatGameTime(boxScore.startsAt)}
				</div>
				{boxScore.arena && (
					<div className="Detail-meta">
						<RinkLink arena={boxScore.arena} />
					</div>
				)}
				<div className="BoxScore-links">
					<GameLiveBarnLinks game={game} now={now} />
					<Link
						className="BoxScore-official"
						href={getOfficialBoxScoreUrl(boxScore.gameId)}
						title={`Open the official box score on ${new URL(URLS.KHL).host}`}
					>
						Official box score ↗
					</Link>
				</div>
			</div>
			<HeaderTeam team={boxScore.home} homeAway="home" />
		</header>
	)
}

/** The league's printable scoresheet; it uses the same game id as /game/:id. */
function getOfficialBoxScoreUrl(gameId: string): string {
	return new URL(`/scoresheet/${encodeURIComponent(gameId)}`, URLS.KHL).href
}

type GameState = "upcoming" | "live" | "final"

function getGameState(game: GameResponse, now: Date): GameState {
	const startsAt = Date.parse(game.boxScore.startsAt)
	if (game.boxScore.hasSummary) {
		return "final"
	}
	if (now.getTime() < startsAt) {
		return "upcoming"
	}
	return now.getTime() < startsAt + LEAGUE.GAME_DURATION_MINUTES * 60_000
		? "live"
		: "final"
}

/** The rink's feed before and during the game, then the game's replay. */
const GameLiveBarnLinks = ({game, now}: {game: GameResponse; now: Date}) => {
	const {livebarn} = game
	if (livebarn.length === 0) {
		return <NotOnLiveBarn />
	}
	const state = getGameState(game, now)
	return (
		<>
			{livebarn.map((link) => (
				<LiveBarnBadge
					key={link.surfaceId}
					href={state === "final" ? link.vodUrl : link.liveUrl}
					surfaceName={
						livebarn.length > 1 ? link.surfaceName : undefined
					}
					title={
						state === "final"
							? `Watch the replay on LiveBarn (${link.surfaceName})`
							: state === "live"
								? `Watch live on LiveBarn (${link.surfaceName})`
								: `Open ${link.surfaceName} on LiveBarn`
					}
				/>
			))}
		</>
	)
}

const HeaderTeam = ({
	team,
	homeAway,
}: {
	team: KHLBoxScoreTeam
	homeAway: "home" | "away"
}) => {
	return (
		<div className={cx("BoxScore-team", `BoxScore-team--${homeAway}`)}>
			<TeamAvatar name={team.name} logoUrl={team.logoUrl} size={64} />
			<div className="BoxScore-team-name">
				<TeamLink team={team} seasonId={team.seasonId} />
			</div>
			<HomeAwayBadge homeAway={homeAway} />
		</div>
	)
}

/** Goals and shots per period, one row per team. */
const PeriodTotals = ({game}: {game: GameResponse}) => {
	const {away, home, periods} = game.boxScore
	const columns = (
		stat: "goals" | "shots",
	): StatsTableColumn<KHLBoxScoreTeam>[] => [
		{
			header: "Team",
			isLabel: true,
			render: (team) => <TeamLink team={team} seasonId={team.seasonId} />,
		},
		...periods.map((period, i) => ({
			header: period,
			render: (team: KHLBoxScoreTeam) => team[`${stat}ByPeriod`][i] ?? "",
		})),
		{
			header: "T",
			render: (team) => <strong>{team[stat] ?? ""}</strong>,
		},
	]
	return (
		<section className="Detail-panel">
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>Goals</h2>
			<StatsTable
				rows={[away, home]}
				rowKey={(team) => team.id}
				columns={columns("goals")}
			/>
			<h3 className={cx("SectionLabel", "Detail-subtitle")}>Shots</h3>
			<StatsTable
				rows={[away, home]}
				rowKey={(team) => team.id}
				columns={columns("shots")}
			/>
		</section>
	)
}

type TimelineEvent =
	| {kind: "goal"; goal: KHLGoal; score: string}
	| {kind: "penalty"; penalty: KHLPenalty}

/** Goals and penalties period by period, in the order they happened. */
const Timeline = ({game}: {game: GameResponse}) => {
	const {away, home, goals, penalties} = game.boxScore
	const teams = new Map([away, home].map((t) => [t.id, t]))

	// Running score after each goal, away first
	const tally = {[away.id]: 0, [home.id]: 0}
	const events: TimelineEvent[] = [
		...goals.map((goal): TimelineEvent => {
			tally[goal.teamId] = (tally[goal.teamId] ?? 0) + 1
			return {
				kind: "goal",
				goal,
				score: formatScore(tally[away.id]!, tally[home.id]!),
			}
		}),
		...penalties.map((penalty): TimelineEvent => ({
			kind: "penalty",
			penalty,
		})),
	]
	// The clock counts down, so more time remaining means earlier. Goals and
	// penalties are each listed in order already; the sort is stable.
	const periods = [...new Set(events.map(getEventPeriod))].sort(
		(a, b) => getPeriodOrder(a) - getPeriodOrder(b),
	)
	const byPeriod = periods.map((period) => ({
		period,
		events: events
			.filter((e) => getEventPeriod(e) === period)
			.sort(
				(a, b) =>
					parseClock(getEventTime(b)) - parseClock(getEventTime(a)),
			),
	}))

	return (
		<section className="Detail-panel">
			<h2 className={cx("SectionLabel", "Timeline-title")}>
				Scoring and penalties
			</h2>
			{byPeriod.length === 0 ? (
				<p className="Detail-empty">No goals or penalties.</p>
			) : (
				byPeriod.map(({period, events}) => (
					<div key={period} className="Timeline-period">
						<h3
							className={cx(
								"SectionLabel",
								"Timeline-period-title",
							)}
						>
							{formatPeriodName(period)}
						</h3>
						<ol className="Timeline-list">
							{events.map((event, i) => (
								<TimelineItem
									key={i}
									event={event}
									team={teams.get(
										event.kind === "goal"
											? event.goal.teamId
											: event.penalty.teamId,
									)}
									playerIds={game.playerIds}
								/>
							))}
						</ol>
					</div>
				))
			)}
		</section>
	)
}

const TimelineItem = ({
	event,
	team,
	playerIds,
}: {
	event: TimelineEvent
	team: KHLBoxScoreTeam | undefined
	playerIds: Record<string, string>
}) => {
	const avatar = team && (
		<TeamAvatar name={team.name} logoUrl={team.logoUrl} size={28} />
	)
	if (event.kind === "penalty") {
		const {penalty} = event
		return (
			<li className={cx("Timeline-item", "Timeline-item--penalty")}>
				<span className="Timeline-time">{penalty.time}</span>
				{avatar}
				<div className="Timeline-body">
					<div>
						{penalty.player ? (
							<PlayerName
								player={penalty.player}
								playerIds={playerIds}
							/>
						) : (
							team?.name
						)}{" "}
						<span className="Timeline-detail">
							· {penalty.infraction}
						</span>
					</div>
				</div>
				<span className="Timeline-tag">{penalty.duration}</span>
			</li>
		)
	}
	const {goal, score} = event
	return (
		<li className={cx("Timeline-item", "Timeline-item--goal")}>
			<span className="Timeline-time">{goal.time}</span>
			{avatar}
			<div className="Timeline-body">
				<div className="Timeline-scorer">
					<PlayerName player={goal.scorer} playerIds={playerIds} />
					{goal.scorerSeasonGoals !== null && (
						<span className="Timeline-detail">
							{" "}
							({goal.scorerSeasonGoals})
						</span>
					)}
					{goal.type && (
						<span
							className="Timeline-type"
							title={GOAL_TYPES[goal.type]}
						>
							{goal.type}
						</span>
					)}
				</div>
				<div className="Timeline-detail">
					{goal.assists.length === 0
						? "Unassisted"
						: goal.assists.map((assist, i) => (
								<span key={assist.id}>
									{i > 0 && ", "}
									<PlayerName
										player={assist}
										playerIds={playerIds}
									/>
								</span>
							))}
				</div>
			</div>
			<span className={cx("Timeline-tag", "Timeline-score")}>
				{score}
			</span>
		</li>
	)
}

const GOAL_TYPES: Record<string, string> = {
	PPG: "Power-play goal",
	SHG: "Short-handed goal",
	ENG: "Empty-net goal",
}

const PlayerName = ({
	player,
	playerIds,
}: {
	player: KHLPlayerRef
	playerIds: Record<string, string>
}) => {
	const playerId = playerIds[player.id]
	return playerId ? (
		<Link className="InlineLink" href={getPlayerHref(playerId)}>
			{player.name}
		</Link>
	) : (
		<>{player.name}</>
	)
}

function getEventPeriod(event: TimelineEvent): string {
	return event.kind === "goal" ? event.goal.period : event.penalty.period
}

function getEventTime(event: TimelineEvent): string {
	return event.kind === "goal" ? event.goal.time : event.penalty.time
}

/** "1st" -> 1, ...; overtime and shootouts ("OT", "SO") come after */
function getPeriodOrder(period: string): number {
	const number = parseInt(period, 10)
	return Number.isNaN(number) ? 100 + (period === "SO" ? 1 : 0) : number
}

/** "16:16" -> seconds */
function parseClock(time: string): number {
	const [minutes, seconds] = time.split(":").map(Number)
	return (minutes ?? 0) * 60 + (seconds ?? 0)
}

/** "1st" -> "1st period"; "OT" and "SO" stay as they are */
function formatPeriodName(period: string): string {
	return /^\d/.test(period) ? `${period} period` : period
}

export const GameRoute = {
	path: "/games/:gameId",
	title: "Game",
	content: GamePage,
} as const satisfies Route
