import * as React from "react"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {
	ActivityEvent,
	ActivityGame,
	ActivityResponse,
} from "../shared/ApiJson.js"
import {
	AsyncContent,
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
	getGameHref,
	GOAL_TYPES,
} from "./Util.js"

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
		<section className={cx("Detail-panel", "Activity")}>
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				Recent activity
			</h2>
			{/* Scrolls once it's taller than the past games beside it */}
			<div className="Activity-scroll">
				<AsyncContent
					state={state}
					size="inline"
					loadingLabel="Loading recent activity…"
					slowNote="Still working. Recent activity reads each game's scoresheet, so the first load can take a little extra time."
					errorTitle="Couldn't load recent activity"
				>
					{(activity) =>
						activity.games.length === 0 ? (
							<p className="Detail-empty">
								{subject === "player"
									? "No goals, assists, or penalties in recent games."
									: "No goals or penalties yet."}
							</p>
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
		</section>
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
			<span className="Activity-kind">{EVENT_LABELS[event.kind]}</span>
			<div className="Activity-body">
				<div className="Activity-summary">
					<ActivityEventBody
						event={event}
						subject={subject}
						playerIds={playerIds}
					/>
				</div>
				{/* The date first, so long team names are what get cut off */}
				<div className="Activity-game">
					<Link href={getGameHref(game.gameId)}>
						{formatGameDate(game.startsAt, now)}
					</Link>
					{" · "}
					{/* A player may have been on any of their teams */}
					{subject === "player" && (
						<>
							<TeamLink team={team} seasonId={team.seasonId} />{" "}
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
