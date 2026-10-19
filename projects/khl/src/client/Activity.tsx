import {matchField, matchValue} from "@dvdzkwsk/util/MatchUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import * as React from "react"
import {
	AsyncContent,
	Card,
	Hint,
	Link,
	LiveBarnBadge,
	PlayerName,
	TeamLink,
} from "./Components.js"
import {toEventReplayLinks} from "./Games.js"
import {
	AsyncState,
	formatGameDate,
	formatShortGameDate,
	getGameHref,
	GOAL_TYPES,
} from "./Util.js"
import {
	ActivityEvent,
	ActivityGame,
	ActivityResponse,
} from "../shared/ApiJson.js"
import {LIMITS} from "../shared/KHLConfig.js"
import {KHLGoal} from "../shared/KHLJson.js"

/** Whose feed it is: a player's leaves their own name off their events */
type ActivitySubject = "player" | "team"

const EVENT_LABELS: Record<ActivityEvent["kind"], string> = {
	goal: "Goal",
	assist: "Assist",
	penalty: "Penalty",
}

/**
 * A player's or team's latest goals, assists, and penalties, newest first, as
 * one stream: each event names its game on a second line. Loaded apart from
 * the page, since it reads a box score per game.
 */
export const ActivityFeed = ({
	state,
	subject,
	now,
}: {
	state: AsyncState<ActivityResponse>
	subject: ActivitySubject
	now: Date
}) => {
	return (
		<Card
			title="Recent activity"
			className="Activity"
			panelClassName="Activity-panel"
			loading={matchValue(state.status, {
				loading: true,
				error: false,
				success: false,
			})}
			slowNote="Still working. This is taking longer than usual."
		>
			{/* Scrolls once it's taller than the past games beside it */}
			<div className="Activity-scroll">
				<AsyncContent
					state={state}
					size="inline"
					errorTitle="Couldn't load recent activity"
				>
					{(activity) => (
						<>
							{activity.pendingGames > 0 && (
								<ActivityPending
									count={activity.pendingGames}
								/>
							)}
							{activity.games.length > 0 ? (
								<ol className="Activity-events">
									{activity.games.flatMap((game) =>
										game.events.map((event, i) => (
											<ActivityEventItem
												key={`${game.gameId}:${i}`}
												game={game}
												event={event}
												subject={subject}
												playerIds={activity.playerIds}
												now={now}
											/>
										)),
									)}
								</ol>
							) : (
								activity.pendingGames === 0 && (
									<ActivityEmpty subject={subject} />
								)
							)}
						</>
					)}
				</AsyncContent>
			</div>
		</Card>
	)
}

/**
 * The feed's share of a broader activity response: its latest
 * LIMITS.ACTIVITY_EVENTS events, leaving out games without one
 */
export function toActivityFeed(activity: ActivityResponse): ActivityResponse {
	let remaining = LIMITS.ACTIVITY_EVENTS
	const games = activity.games.flatMap((game) => {
		const events = game.events.slice(0, remaining)
		remaining -= events.length
		return events.length > 0 ? [{...game, events}] : []
	})
	return {...activity, games}
}

/** How often to look again while some games are still loading */
const PENDING_REFRESH_MS = 10_000
/** Looks again for at most 5 minutes */
const MAX_PENDING_REFRESHES = 30

/**
 * While some of the activity's games are still being loaded from the KHL site
 * (`pendingGames`), looks again every PENDING_REFRESH_MS behind what's shown,
 * so they appear as they're loaded. Pass the full response's state, not the
 * feed's share of it.
 */
export function useActivityRefresh(state: AsyncState<ActivityResponse>) {
	const data = matchField(state, "status", {
		loading: () => null,
		error: () => null,
		success: (s) => s.data,
	})
	const {refresh} = state
	const refreshes = React.useRef(0)
	React.useEffect(() => {
		if (!data) {
			// A new load (another player, or a retry) starts the count over
			refreshes.current = 0
			return
		}
		if (
			data.pendingGames === 0 ||
			refreshes.current >= MAX_PENDING_REFRESHES
		) {
			return
		}
		const timer = setTimeout(() => {
			refreshes.current++
			refresh()
		}, PENDING_REFRESH_MS)
		return () => clearTimeout(timer)
	}, [data, refresh])
}

/** Above the feed while some of its games are still loading */
const ActivityPending = ({count}: {count: number}) => {
	return (
		<p className="Activity-pending">
			Loading {count} more {count === 1 ? "game" : "games"} from the KHL
			site. {count === 1 ? "It'll" : "They'll"} show up here in a minute
			or two.
		</p>
	)
}

/** How far back the feed looks, e.g. 6 */
const LOOKBACK_MONTHS = Math.round(LIMITS.ACTIVITY_MAX_LOOKBACK_DAYS / 30.4)

/** Centered in the card, which is as tall as the past games beside it */
const ActivityEmpty = ({subject}: {subject: ActivitySubject}) => {
	return (
		<div className="Activity-empty">
			<PuckIcon />
			<p className="Activity-empty-title">
				Nothing on the scoresheet lately
			</p>
			<p className="Activity-empty-text">
				{matchValue(subject, {
					player: "Goals, assists, and penalties",
					team: "The team's goals and penalties",
				})}{" "}
				from the last {LOOKBACK_MONTHS} months of games will show up
				here.
			</p>
		</div>
	)
}

const PuckIcon = () => {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			aria-hidden
		>
			<ellipse cx="12" cy="9" rx="8" ry="3.5" />
			<path d="M4 9v5c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5V9" />
		</svg>
	)
}

const ActivityEventItem = ({
	game,
	event,
	subject,
	playerIds,
	now,
}: {
	game: ActivityGame
	event: ActivityEvent
	subject: ActivitySubject
	playerIds: Record<string, string>
	now: Date
}) => {
	const {team, opponent} = game
	const at = matchField(event, "kind", {
		goal: (e) => e.goal,
		assist: (e) => e.goal,
		penalty: (e) => e.penalty,
	})
	return (
		<li className={cx("Activity-event", `Activity-event--${event.kind}`)}>
			<div className="Activity-when">
				<span className="Activity-kind">
					{EVENT_LABELS[event.kind]}
				</span>
				<Hint label={formatGameDate(game.startsAt, now)}>
					<Link
						className="Activity-date"
						href={getGameHref(game.gameId)}
					>
						{formatShortGameDate(game.startsAt, now)}
					</Link>
				</Hint>
			</div>
			<div className="Activity-body">
				<div className="Activity-summary">
					<ActivityEventBody
						event={event}
						subject={subject}
						playerIds={playerIds}
					/>
				</div>
				<div className="Activity-game">
					{/* A player may have been on any of their teams */}
					{matchValue(subject, {
						player: (
							<>
								<TeamLink
									team={team}
									seasonId={team.seasonId}
								/>{" "}
							</>
						),
						team: null,
					})}
					{matchValue(game.homeAway, {home: "vs", away: "@"})}{" "}
					<TeamLink team={opponent} seasonId={opponent.seasonId} />
				</div>
			</div>
			<span className="Activity-time">
				{at.period} {at.time}
			</span>
			<div className="Activity-replays">
				{toEventReplayLinks(game, game.livebarn, at).map((replay) => (
					<LiveBarnBadge
						key={replay.surfaceId}
						compact
						href={replay.href}
						title={replay.title}
						estimated={replay.estimated}
					/>
				))}
			</div>
		</li>
	)
}

const ActivityEventBody = ({
	event,
	subject,
	playerIds,
}: {
	event: ActivityEvent
	subject: ActivitySubject
	playerIds: Record<string, string>
}) => {
	return matchField(event, "kind", {
		penalty: ({penalty}) => (
			<>
				{matchValue(subject, {
					team: (
						<>
							{penalty.player ? (
								<PlayerName
									player={penalty.player}
									playerIds={playerIds}
								/>
							) : (
								"Bench"
							)}{" "}
							·{" "}
						</>
					),
					player: null,
				})}
				{penalty.infraction}
				<span className="Activity-detail"> · {penalty.duration}</span>
			</>
		),
		assist: ({goal}) => (
			<>
				On <PlayerName player={goal.scorer} playerIds={playerIds} />
				's goal
				{renderGoalType(goal)}
			</>
		),
		goal: ({goal}) => (
			<>
				{matchValue(subject, {
					team: (
						<>
							<span className="Activity-scorer">
								<PlayerName
									player={goal.scorer}
									playerIds={playerIds}
								/>
							</span>{" "}
							·{" "}
						</>
					),
					player: null,
				})}
				<span
					className={cx(
						matchValue(subject, {
							team: "Activity-detail",
							player: null,
						}),
					)}
				>
					{goal.assists.length === 0
						? "Unassisted"
						: goal.assists.map((assist, i) => (
								<React.Fragment key={assist.id}>
									{i > 0
										? ", "
										: matchValue(subject, {
												player: "Assisted by ",
												team: null,
											})}
									<PlayerName
										player={assist}
										playerIds={playerIds}
									/>
								</React.Fragment>
							))}
				</span>
				{renderGoalType(goal)}
			</>
		),
	})
}

function renderGoalType(goal: KHLGoal) {
	return (
		goal.type && (
			<Hint label={GOAL_TYPES[goal.type]}>
				<span className="Activity-type">{goal.type}</span>
			</Hint>
		)
	)
}
