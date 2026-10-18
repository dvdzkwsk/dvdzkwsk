import {matchField} from "@dvdzkwsk/util/MatchUtil"
import {
	GameLineupRecord,
	GameRecord,
	ScoresheetEvent,
	TeamRecord,
} from "./Database.js"
import {
	KHLBoxScore,
	KHLBoxScoreTeam,
	compareGameEvents,
	KHLGameStats,
	KHLGameTeamStats,
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
export const GAME_SETTLE_LIMIT_MS = 2 * DAY_MS

/** A game as a team's schedule page lists it */
export interface ScheduleGame {
	/** Null for a game the league never linked */
	gameId: string | null
	startsAt: string
	isFinal: boolean
}

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
 * When to look at a game's pages again, given when they were last looked at
 * (fetched, or processed): 10 minutes later while its summary or a lineup
 * isn't posted, for up to 2 days after it started. Null once there's no
 * reason to.
 */
export function getGameRecheckAt(game: {
	startsAt: string
	isComplete: boolean
	lastLookedAt: number
}): number | null {
	const recheckAt = game.lastLookedAt + GAME_RECHECK_MS
	const isSettling =
		recheckAt - Date.parse(game.startsAt) < GAME_SETTLE_LIMIT_MS
	return !game.isComplete && isSettling ? recheckAt : null
}

/**
 * A finished game as rows for the games tables: the box score's scores, its
 * two teams (kept only where no teams page lists them), its goals and
 * penalties in scoresheet order, and who dressed from the game's stats page (null if it couldn't
 * be read, which leaves both lineups unposted).
 */
export function toGameRecords(
	boxScore: KHLBoxScore,
	stats: KHLGameStats | null,
): {
	game: GameRecord
	teams: TeamRecord[]
	/** In scoresheet order */
	events: ScoresheetEvent[]
	lineups: GameLineupRecord[]
} {
	const gameId = boxScore.gameId
	const toTeam = (team: KHLBoxScoreTeam, side: KHLGameTeamStats | null) => ({
		id: team.id,
		seasonId: team.seasonId,
		goals: team.goals,
		lineupPosted: !!side && getLineupIds(side).length > 0,
	})
	const game: GameRecord = {
		gameId,
		startsAt: boxScore.startsAt,
		arenaId: boxScore.arena?.id ?? null,
		away: toTeam(boxScore.away, stats?.away ?? null),
		home: toTeam(boxScore.home, stats?.home ?? null),
		hasSummary: boxScore.hasSummary,
		processedAt: Date.now(),
	}
	const teams = [boxScore.away, boxScore.home].map((team): TeamRecord => ({
		teamId: team.id,
		seasonId: team.seasonId,
		name: team.name,
		logoUrl: team.logoUrl,
		divisionId: null,
	}))
	const lineups: GameLineupRecord[] = stats
		? [
				...getLineupIds(stats.away).map(
					(khlPlayerId): GameLineupRecord => ({
						gameId,
						teamId: boxScore.away.id,
						khlPlayerId,
					}),
				),
				...getLineupIds(stats.home).map(
					(khlPlayerId): GameLineupRecord => ({
						gameId,
						teamId: boxScore.home.id,
						khlPlayerId,
					}),
				),
			]
		: []
	return {
		game,
		teams,
		events: toScoresheetOrder(boxScore),
		lineups,
	}
}

function getLineupIds(team: KHLGameTeamStats): string[] {
	return [...team.skaters, ...team.goalies].map((row) => row.playerId)
}

/**
 * The box score's goals and penalties as one list, by period and clock. The
 * box score lists each in game order, and a goal comes before a penalty at
 * the same moment.
 */
function toScoresheetOrder(boxScore: KHLBoxScore): ScoresheetEvent[] {
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
