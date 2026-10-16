import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {matchFn, matchObj, matchValue} from "@dvdzkwsk/util/MatchUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import * as React from "react"
import {
	GameResponse,
	SeasonSummary,
	GET_GAME_ENDPOINT,
} from "../../shared/ApiJson.js"
import {STRINGS, URLS} from "../../shared/KHLConfig.js"
import {
	compareGameEvents,
	getPeriodOrder,
	KHLBoxScoreTeam,
	KHLGoal,
	KHLPenalty,
} from "../../shared/KHLJson.js"
import {getGameEndsAt} from "../../shared/LeagueTime.js"
import {Comparison} from "../Compare.js"
import {
	AsyncContent,
	Card,
	Hint,
	Link,
	LIVEBARN_TITLES,
	LiveBarnBadge,
	Notice,
	NotOnLiveBarn,
	PageShell,
	PageTitle,
	PlayerName,
	RinkLink,
	RosterPanels,
	SegmentedControl,
	StatsTable,
	StatsTableColumn,
	TeamAvatar,
	TeamLink,
} from "../Components.js"
import {
	GameTableRow,
	HeadToHeadGames,
	TeamForm,
	toEventReplayLinks,
} from "../Games.js"
import {
	AppContext,
	formatGameDate,
	formatGameTime,
	formatPeriodName,
	formatScore,
	getScoresheetUrl,
	GOAL_TYPES,
	Route,
	RouteProps,
	useAsync,
	useNow,
} from "../Util.js"

const GamePage = ({params, query}: RouteProps) => {
	const gameId = params.gameId!
	const state = useAsync(
		() => doRequest(GET_GAME_ENDPOINT, {gameId}),
		[gameId],
	)
	const now = useNow()
	return (
		<PageShell>
			<AsyncContent state={state} loadingLabel="Loading game details…">
				{(game) => (
					<div className="Detail">
						<PageTitle>
							{`${game.boxScore.away.name} @ ${game.boxScore.home.name}`}
						</PageTitle>
						<div className="Detail-toolbar">
							<GameViewToggle
								game={game}
								view={getGameView(game, query)}
							/>
						</div>
						<GameHeader
							game={game}
							view={getGameView(game, query)}
							now={now}
						/>
						{matchFn(getGameView(game, query), {
							result: () => <ResultView game={game} />,
							preview: () => (
								<PreviewView game={game} now={now} />
							),
						})}
					</div>
				)}
			</AsyncContent>
		</PageShell>
	)
}

/** Before a game, a preview; once it's final, the result */
type GameView = "preview" | "result"

/**
 * The view picked in the URL, else the one that fits the game. A result can
 * only be shown once the game has a final score.
 */
function getGameView(game: GameResponse, query: URLSearchParams): GameView {
	const isFinal = game.score !== null
	const picked = query.get("view")
	if (picked === "preview") {
		return "preview"
	}
	if (picked === "result" && isFinal) {
		return "result"
	}
	return isFinal ? "result" : "preview"
}

const GameViewToggle = ({game, view}: {game: GameResponse; view: GameView}) => {
	const {history} = React.useContext(AppContext)
	const defaultView = game.score ? "result" : "preview"
	return (
		<SegmentedControl<GameView>
			label="View"
			options={[
				{value: "preview", label: STRINGS.GAME_PREVIEW},
				{
					value: "result",
					label: STRINGS.GAME_RESULT,
					disabled: !game.score,
					hint: game.score
						? undefined
						: "The league posts the result after the game",
				},
			]}
			value={view}
			onChange={(next) => {
				// The default view needs no query string; switching views
				// isn't worth a back-button stop
				history.replace({
					pathname: history.location.pathname,
					search: next === defaultView ? "" : `?view=${next}`,
				})
			}}
		/>
	)
}

/** Scoring by period, the timeline, and who played with their stats. */
const ResultView = ({game}: {game: GameResponse}) => {
	// The scoreboard can have the final score before the scoresheet is
	// posted: say what's missing, and show who's on each team meanwhile
	if (!game.boxScore.hasSummary) {
		return (
			<>
				<Notice title={STRINGS.SCORESHEET_NOT_POSTED}>
					Scoring by period, goals, penalties, and who played will
					show here once it's up.
				</Notice>
				{game.rosters && (
					<RosterPanels
						kind="pending-game"
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
			</>
		)
	}
	return (
		<>
			<div className={cx("Detail-columns", "Detail-columns--even")}>
				<PeriodTotals game={game} />
				<Timeline game={game} />
			</div>
			{game.lineups ? (
				<RosterPanels
					kind="game"
					teams={[
						{team: game.boxScore.away, roster: game.lineups.away},
						{team: game.boxScore.home, roster: game.lineups.home},
					]}
				/>
			) : (
				<p className="Detail-empty">
					Couldn't load the lineups from the league's site.
				</p>
			)}
		</>
	)
}

/** The teams' seasons, their history against each other, and rosters. */
const PreviewView = ({game, now}: {game: GameResponse; now: Date}) => {
	return (
		<>
			{/* How the teams compare this season, then their previous meetings */}
			{game.form.away && game.form.home && (
				<Comparison
					a={game.form.away}
					b={game.form.home}
					previewStats={game.previewStats}
				/>
			)}
			<HeadToHeadGames
				left={game.boxScore.away}
				right={game.boxScore.home}
				games={game.headToHead}
				now={now}
			/>
			{game.rosters && (
				<RosterPanels
					teams={[
						{team: game.boxScore.away, roster: game.rosters.away},
						{team: game.boxScore.home, roster: game.rosters.home},
					]}
				/>
			)}
		</>
	)
}

/** The teams, and the score in the result view; a preview shows the start time */
const GameHeader = ({
	game,
	view,
	now,
}: {
	game: GameResponse
	view: GameView
	now: Date
}) => {
	const {boxScore} = game
	const notFinal = (
		<>
			{matchValue(getGameState(game, now), {
				upcoming: null,
				live: (
					<span
						className={cx(
							"BoxScore-status",
							"BoxScore-status--live",
						)}
					>
						Live
					</span>
				),
				final: null,
			})}
			{/* Away @ home, until there's a score */}
			<span className="BoxScore-at">@</span>
			<div className="BoxScore-time">
				{formatGameTime(boxScore.startsAt)}
			</div>
			<div className="BoxScore-when">
				{formatGameDate(boxScore.startsAt, now)}
			</div>
		</>
	)
	const center = matchFn(view, {
		result: () =>
			game.score ? (
				<>
					<span className="BoxScore-status">Final</span>
					<div className="BoxScore-score">
						{formatScore(game.score.away, game.score.home)}
					</div>
					<div className="BoxScore-when">
						{formatGameDate(boxScore.startsAt, now)} ·{" "}
						{formatGameTime(boxScore.startsAt)}
					</div>
				</>
			) : (
				notFinal
			),
		preview: () => notFinal,
	})
	return (
		<header className={cx("Detail-header", "BoxScore-header")}>
			<HeaderTeam
				team={boxScore.away}
				homeAway="away"
				form={game.form.away}
			/>
			<div className="BoxScore-center">
				{center}
				{boxScore.arena && (
					<div className="BoxScore-when">
						<RinkLink arena={boxScore.arena} />
					</div>
				)}
				<div className="BoxScore-links">
					<GameLiveBarnLinks game={game} now={now} />
					{game.score ? (
						<Hint
							label={`Open the official scoresheet on ${new URL(URLS.KHL).host}`}
						>
							<Link
								className="BoxScore-official"
								href={getScoresheetUrl(boxScore.gameId)}
							>
								{STRINGS.KHL_SCORESHEET} ↗
							</Link>
						</Hint>
					) : (
						// Shown but disabled until there's something to open
						<Hint label="The league posts the scoresheet after the game is played.">
							<span
								className={cx(
									"BoxScore-official",
									"BoxScore-official--disabled",
								)}
								role="link"
								aria-disabled
								tabIndex={0}
							>
								{STRINGS.KHL_SCORESHEET} ↗
							</span>
						</Hint>
					)}
				</div>
			</div>
			<HeaderTeam
				team={boxScore.home}
				homeAway="home"
				form={game.form.home}
			/>
		</header>
	)
}

type GameState = "upcoming" | "live" | "final"

function getGameState(game: GameResponse, now: Date): GameState {
	const startsAt = Date.parse(game.boxScore.startsAt)
	if (game.score) {
		return "final"
	}
	if (now.getTime() < startsAt) {
		return "upcoming"
	}
	return now < getGameEndsAt(game.boxScore) ? "live" : "final"
}

/** The rink's feed before and during the game, then the game's replay. */
const GameLiveBarnLinks = ({game, now}: {game: GameResponse; now: Date}) => {
	const {livebarn} = game
	if (livebarn.length === 0) {
		return <NotOnLiveBarn />
	}
	const state = getGameState(game, now)
	const title = matchValue(state, {
		upcoming: LIVEBARN_TITLES.open,
		live: LIVEBARN_TITLES.live,
		final: LIVEBARN_TITLES.replay,
	})
	const live = matchValue(state, {upcoming: false, live: true, final: false})
	return (
		<>
			{livebarn.map((link) => (
				<LiveBarnBadge
					key={link.surfaceId}
					href={matchValue(state, {
						upcoming: link.liveUrl,
						live: link.liveUrl,
						final: link.vodUrl,
					})}
					surfaceName={
						livebarn.length > 1 ? link.surfaceName : undefined
					}
					title={title(link.surfaceName)}
					live={live}
				/>
			))}
		</>
	)
}

const HeaderTeam = ({
	team,
	homeAway,
	form,
}: {
	team: KHLBoxScoreTeam
	homeAway: "home" | "away"
	form: SeasonSummary | null
}) => {
	return (
		<div className={cx("BoxScore-team", `BoxScore-team--${homeAway}`)}>
			{/* "■ Away": the swatch matches the head-to-head colors */}
			<span className="BoxScore-eyebrow">
				<span className="Compare-key" aria-hidden />
				{matchValue(homeAway, {away: "Away", home: "Home"})}
			</span>
			<TeamAvatar name={team.name} logoUrl={team.logoUrl} size={88} />
			<div className="BoxScore-team-name">
				<TeamLink team={team} seasonId={team.seasonId} />
			</div>
			{form && <TeamForm form={form} />}
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
		<Card title="Goals">
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
		</Card>
	)
}

type TimelineEvent =
	| {
			kind: "goal"
			goal: KHLGoal
			/** The running score after this goal */
			awayGoals: number
			homeGoals: number
	  }
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
				awayGoals: tally[away.id]!,
				homeGoals: tally[home.id]!,
			}
		}),
		...penalties.map((penalty): TimelineEvent => ({
			kind: "penalty",
			penalty,
		})),
	]
	// Goals and penalties are each listed in order already; the sort is stable
	const periods = [...new Set(events.map(getEventPeriod))].sort(
		(a, b) => getPeriodOrder(a) - getPeriodOrder(b),
	)
	const byPeriod = periods.map((period) => ({
		period,
		events: events
			.filter((e) => getEventPeriod(e) === period)
			.sort((a, b) => compareGameEvents(getEventAt(a), getEventAt(b))),
	}))

	return (
		<Card title="Scoring and penalties">
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
							{events.map((event, i) => {
								const teamId = matchObj(event, "kind", {
									goal: (e) => e.goal.teamId,
									penalty: (e) => e.penalty.teamId,
								})
								return (
									<TimelineItem
										key={i}
										event={event}
										team={teams.get(teamId)}
										side={
											teamId === home.id ? "home" : "away"
										}
										playerIds={game.playerIds}
										replays={toEventReplayLinks(
											game.boxScore,
											game.livebarn,
											getEventAt(event),
										)}
									/>
								)
							})}
						</ol>
					</div>
				))
			)}
		</Card>
	)
}

const TimelineItem = ({
	event,
	team,
	side,
	playerIds,
	replays,
}: {
	event: TimelineEvent
	team: KHLBoxScoreTeam | undefined
	/** Whose goal or penalty: colors it with that team's accent */
	side: "away" | "home"
	playerIds: Record<string, string>
	replays: GameTableRow["livebarn"]
}) => {
	const avatar = team && (
		<TeamAvatar name={team.name} logoUrl={team.logoUrl} size={28} />
	)
	const replayLinks = replays.map((replay) => (
		<LiveBarnBadge
			key={replay.surfaceId}
			compact
			href={replay.href}
			title={replay.title}
			estimated={replay.estimated}
		/>
	))
	return matchObj(event, "kind", {
		penalty: ({penalty}) => (
			<li
				className={cx(
					"Timeline-item",
					"Timeline-item--penalty",
					`Timeline-item--${side}`,
				)}
			>
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
				{replayLinks}
			</li>
		),
		goal: ({goal, awayGoals, homeGoals}) => (
			<li
				className={cx(
					"Timeline-item",
					"Timeline-item--goal",
					`Timeline-item--${side}`,
				)}
			>
				<span className="Timeline-time">{goal.time}</span>
				{avatar}
				<div className="Timeline-body">
					<div className="Timeline-scorer">
						<PlayerName
							player={goal.scorer}
							playerIds={playerIds}
						/>
						{goal.scorerSeasonGoals !== null && (
							<span className="Timeline-detail">
								{" "}
								({goal.scorerSeasonGoals})
							</span>
						)}
						{goal.type && (
							<Hint label={GOAL_TYPES[goal.type]}>
								<span className="Timeline-type">
									{goal.type}
								</span>
							</Hint>
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
				{/* The scoring team's number changed: it takes the team's color */}
				<span
					className={cx("Timeline-tag", "Timeline-score")}
					aria-label={`${awayGoals}–${homeGoals}`}
				>
					<span
						className={cx(
							matchValue(side, {
								away: "Timeline-score-changed",
								home: false,
							}),
						)}
					>
						{awayGoals}
					</span>
					<span className="Timeline-score-dash">–</span>
					<span
						className={cx(
							matchValue(side, {
								away: false,
								home: "Timeline-score-changed",
							}),
						)}
					>
						{homeGoals}
					</span>
				</span>
				{replayLinks}
			</li>
		),
	})
}

/** When a timeline event happened on the scoresheet */
function getEventAt(event: TimelineEvent): {period: string; time: string} {
	return matchObj(event, "kind", {
		goal: (e) => e.goal,
		penalty: (e) => e.penalty,
	})
}

function getEventPeriod(event: TimelineEvent): string {
	return getEventAt(event).period
}

export const GameRoute = {
	path: "/games/:gameId",
	title: "Game",
	content: GamePage,
} as const satisfies Route
