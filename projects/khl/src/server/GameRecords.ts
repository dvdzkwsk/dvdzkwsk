import {matchField} from "@dvdzkwsk/util/MatchUtil"
import {
	compareGameEvents,
	KHLBoxScore,
	KHLGoal,
	KHLPenalty,
} from "../shared/KHLJson.js"
import {DAY_MS, getGameEndsAt, MINUTE_MS} from "../shared/LeagueTime.js"

/**
 * How long after a game's scheduled end its pages are expected to be final:
 * the league usually posts the summary and lineups within this
 */
const GAME_SETTLE_MS = 30 * MINUTE_MS
/** How often to look again at a game whose summary or lineups aren't posted */
const GAME_RECHECK_MS = 10 * MINUTE_MS
/** After this long since it started, a game's pages are what they'll be */
const GAME_SETTLE_LIMIT_MS = 2 * DAY_MS

/** When a game's pages should be final: a while after its scheduled end */
export function getSettleAt(game: {startsAt: string}): number {
	return getGameEndsAt(game).getTime() + GAME_SETTLE_MS
}

/** Its summary and both lineups are posted */
export function isGameRecordComplete(game: {
	hasSummary: boolean
	away: {lineupPosted: boolean}
	home: {lineupPosted: boolean}
}): boolean {
	return game.hasSummary && game.away.lineupPosted && game.home.lineupPosted
}

/**
 * When to look at a game's pages again, given when they were last looked at:
 * when it settles if it hasn't, then every 10 minutes while its summary or a
 * lineup isn't posted, for up to 2 days after it started. Null once there's
 * no reason to.
 */
export function getGameRecheckAt(game: {
	startsAt: string
	isComplete: boolean
	lastLookedAt: number
}): number | null {
	if (game.isComplete) {
		return null
	}
	const recheckAt = Math.max(
		game.lastLookedAt + GAME_RECHECK_MS,
		getSettleAt(game),
	)
	const isSettling =
		recheckAt - Date.parse(game.startsAt) < GAME_SETTLE_LIMIT_MS
	return isSettling ? recheckAt : null
}

/** A goal or penalty as the box score lists it */
export type ScoresheetEvent =
	{kind: "goal"; goal: KHLGoal} | {kind: "penalty"; penalty: KHLPenalty}

/**
 * The box score's goals and penalties as one list, by period and clock. The
 * box score lists each in game order, and a goal comes before a penalty at
 * the same moment.
 */
export function toScoresheetOrder(boxScore: KHLBoxScore): ScoresheetEvent[] {
	const events: ScoresheetEvent[] = [
		...boxScore.goals.map((goal) => ({kind: "goal" as const, goal})),
		...boxScore.penalties.map((penalty) => ({
			kind: "penalty" as const,
			penalty,
		})),
	]
	const getAt = (event: ScoresheetEvent) =>
		matchField(event, "kind", {
			goal: (e) => e.goal,
			penalty: (e) => e.penalty,
		})
	// Stable, so each kind keeps the box score's order
	return events.sort((a, b) => compareGameEvents(getAt(a), getAt(b)))
}
