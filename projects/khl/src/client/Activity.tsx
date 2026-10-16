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
			loading={state.status === "loading"}
			slowNote="Still working. This is the first time we're loading these scoresheets, so it will take a little bit longer."
		>
			{/* Scrolls once it's taller than the past games beside it */}
			<div className="Activity-scroll">
				<AsyncContent
					state={state}
					size="inline"
					errorTitle="Couldn't load recent activity"
				>
					{(activity) =>
						activity.games.length === 0 ? (
							<ActivityEmpty subject={subject} />
						) : (
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
						)
					}
				</AsyncContent>
			</div>
		</Card>
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
				{subject === "player"
					? "Goals, assists, and penalties"
					: "The team's goals and penalties"}{" "}
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
	const at = event.kind === "penalty" ? event.penalty : event.goal
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
					{subject === "player" && (
						<>
							<TeamLink
								team={team}
								seasonId={team.seasonId}
							/>{" "}
						</>
					)}
					{game.homeAway === "home" ? "vs" : "@"}{" "}
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
	if (event.kind === "penalty") {
		const {penalty} = event
		return (
			<>
				{subject === "team" && (
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
				)}
				{penalty.infraction}
				<span className="Activity-detail"> · {penalty.duration}</span>
			</>
		)
	}
	const {goal} = event
	const type = goal.type && (
		<Hint label={GOAL_TYPES[goal.type]}>
			<span className="Activity-type">{goal.type}</span>
		</Hint>
	)
	if (event.kind === "assist") {
		return (
			<>
				On <PlayerName player={goal.scorer} playerIds={playerIds} />
				's goal
				{type}
			</>
		)
	}
	return (
		<>
			{subject === "team" && (
				<>
					<span className="Activity-scorer">
						<PlayerName
							player={goal.scorer}
							playerIds={playerIds}
						/>
					</span>{" "}
					·{" "}
				</>
			)}
			<span className={cx(subject === "team" && "Activity-detail")}>
				{goal.assists.length === 0
					? "Unassisted"
					: goal.assists.map((assist, i) => (
							<React.Fragment key={assist.id}>
								{i > 0
									? ", "
									: subject === "player" && "Assisted by "}
								<PlayerName
									player={assist}
									playerIds={playerIds}
								/>
							</React.Fragment>
						))}
			</span>
			{type}
		</>
	)
}
