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
	TeamAvatar,
	TeamLink,
} from "./Components.js"
import {toEventReplayLinks} from "./Games.js"
import {
	AsyncState,
	formatGameDate,
	formatScore,
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
 * A player's or team's latest goals, assists, and penalties, newest first and
 * grouped by game. Loaded apart from the page, since it reads a box score per
 * game.
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
		<section className="Detail-panel">
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				Recent activity
			</h2>
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
						<ol className="Activity-games">
							{activity.games.map((game) => (
								<ActivityGameItem
									key={game.gameId}
									game={game}
									subject={subject}
									playerIds={activity.playerIds}
									now={now}
								/>
							))}
						</ol>
					)
				}
			</AsyncContent>
		</section>
	)
}

const ActivityGameItem = ({
	game,
	subject,
	playerIds,
	now,
}: {
	game: ActivityGame
	subject: ActivitySubject
	playerIds: Record<string, string>
	now: Date
}) => {
	const {team, opponent} = game
	return (
		<li className="Activity-game">
			<div className="Activity-game-header">
				<TeamAvatar
					name={opponent.name}
					logoUrl={opponent.logoUrl}
					size={24}
				/>
				<span className="Activity-matchup">
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
				</span>
				<span className="Activity-date">
					{formatGameDate(game.startsAt, now)}
				</span>
				<Link
					className="Activity-score"
					href={getGameHref(game.gameId)}
				>
					{team.goals !== null && opponent.goals !== null
						? formatScore(team.goals, opponent.goals)
						: "Game"}
				</Link>
			</div>
			<ul className="Activity-events">
				{game.events.map((event, i) => (
					<ActivityEventItem
						key={i}
						game={game}
						event={event}
						subject={subject}
						playerIds={playerIds}
					/>
				))}
			</ul>
		</li>
	)
}

const ActivityEventItem = ({
	game,
	event,
	subject,
	playerIds,
}: {
	game: ActivityGame
	event: ActivityEvent
	subject: ActivitySubject
	playerIds: Record<string, string>
}) => {
	const at = event.kind === "penalty" ? event.penalty : event.goal
	return (
		<li className={cx("Activity-event", `Activity-event--${event.kind}`)}>
			<span className="Activity-kind">{EVENT_LABELS[event.kind]}</span>
			<div className="Activity-body">
				<ActivityEventBody
					event={event}
					subject={subject}
					playerIds={playerIds}
				/>
			</div>
			<span className="Activity-time">
				{at.period} {at.time}
			</span>
			{toEventReplayLinks(game, game.livebarn, at).map((replay) => (
				<LiveBarnBadge
					key={replay.surfaceId}
					compact
					href={replay.href}
					title={replay.title}
				/>
			))}
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
			<span className="Activity-detail">
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
