import {GameLineupRecord, GameRecord, TeamRecord} from "./Database.js"
import {
	KHLBoxScore,
	KHLBoxScoreTeam,
	KHLGameStats,
	KHLGameTeamStats,
	KHLGoal,
	KHLPenalty,
} from "../shared/KHLJson.js"
import {DAY_MS, MINUTE_MS} from "../shared/LeagueTime.js"

/**
 * How long after a game's scheduled end its pages are expected to be final:
 * the league usually posts the summary and lineups within this
 */
export const GAME_SETTLE_MS = 30 * MINUTE_MS
/** How often to look again at a game whose summary or lineups aren't posted */
export const GAME_RECHECK_MS = 10 * MINUTE_MS
/** After this long since it started, a game's pages are what they'll be */
export const GAME_SETTLE_LIMIT_MS = 2 * DAY_MS

/**
 * A finished game as rows for the games tables: the box score's scores, its
 * two teams (kept only where no teams page lists them), its goals and
 * penalties, and who dressed from the game's stats page (null if it couldn't
 * be read, which leaves both lineups unposted).
 */
export function toGameRecords(
	boxScore: KHLBoxScore,
	stats: KHLGameStats | null,
): {
	game: GameRecord
	teams: TeamRecord[]
	events: {goals: KHLGoal[]; penalties: KHLPenalty[]}
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
		localDate: boxScore.localDate,
		localTime: boxScore.localTime,
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
						side: "away",
						khlPlayerId,
					}),
				),
				...getLineupIds(stats.home).map(
					(khlPlayerId): GameLineupRecord => ({
						gameId,
						side: "home",
						khlPlayerId,
					}),
				),
			]
		: []
	return {
		game,
		teams,
		events: {goals: boxScore.goals, penalties: boxScore.penalties},
		lineups,
	}
}

function getLineupIds(team: KHLGameTeamStats): string[] {
	return [...team.skaters, ...team.goalies].map((row) => row.playerId)
}
