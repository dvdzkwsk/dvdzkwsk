import {Logger} from "@dvdzkwsk/logger"
import {matchField, matchValue} from "@dvdzkwsk/util/MatchUtil"
import {Database as SQLiteDatabase} from "bun:sqlite"
import {z} from "zod"
import {isGameRecordComplete, toScoresheetOrder} from "./GameRecords.js"
import {SyncPage, SyncPageSchema} from "./SyncPages.js"
import {
	ActivityEvent,
	parseRegistrationKey,
	RegistrationKey,
	SyncPageKind,
	SyncPageKindSchema,
} from "../shared/ApiJson.js"
import {
	KHLBoxScore,
	KHLBoxScoreTeam,
	KHLGame,
	KHLGameStats,
	KHLGameTeamStats,
	KHLGoal,
	KHLHomeAway,
	KHLPenalty,
	KHLPlayer,
	KHLPlayerRef,
	KHLRosterRow,
	KHLSeason,
	KHLSeasonStatsTableSchema,
	KHLStatSectionSchema,
	KHLTeamsPage,
	KHLTeamStats,
} from "../shared/KHLJson.js"
import {getLeagueLocalTime} from "../shared/LeagueTime.js"

const logger = new Logger("LeagueDatabase")

/** Which page named a team; earlier ones outrank later ones */
export const TEAM_SOURCES = [
	"teams-page",
	"schedule",
	"box-score",
	"roster",
	"search",
] as const
export type TeamSource = (typeof TEAM_SOURCES)[number]

export interface TeamRecord {
	teamId: string
	seasonId: string
	name: string
	logoUrl: string | null
	divisionId: string | null
	source: TeamSource
}

/**
 * A game as activity reads it: each team's name and logo from `teams`, its
 * league-local date and time from its start, and whether each lineup is
 * posted
 */
export interface GameRecord {
	gameId: string
	startsAt: string
	localDate: string
	localTime: string
	arenaId: string | null
	away: GameRecordTeam
	home: GameRecordTeam
	hasSummary: boolean
	/** Epoch milliseconds */
	processedAt: number
	/** Epoch milliseconds; null until its summary and lineups are posted */
	completedAt: number | null
}

export interface GameRecordTeam {
	id: string
	name: string
	logoUrl: string | null
	/** The season the game's team links point at */
	seasonId: string
	goals: number | null
	/** False until the league posts who dressed */
	lineupPosted: boolean
}

/** A goal or penalty in a game, with player names from registrations */
export interface GameEventRecord {
	gameId: string
	event: ActivityEvent
}

/** A rostered player's row on a season's team stats page */
export interface RosterStatRow {
	teamId: string
	khlPlayerId: string
	isGoalie: boolean
	number: string | null
	name: string
	stats: Record<string, string>
}

/** A page in the fetch queue */
export interface QueuedPage {
	url: string
	page: SyncPage
	seasonId: string | null
	attempts: number
}

const StringsJson = z.array(z.string())
const StatsJson = z.record(z.string(), z.string())
const StatSectionsJson = z.array(KHLStatSectionSchema)
const SeasonTablesJson = z.array(KHLSeasonStatsTableSchema)

/** The rank of a team source in SQL, for comparing which page wins */
const TEAM_SOURCE_RANK = (column: string) =>
	`CASE ${column} ${TEAM_SOURCES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(" ")} END`

/**
 * The league's data, derived from fetched pages: seasons, divisions, teams,
 * arenas, schedules, rosters, player profiles, and games, plus the queue of
 * pages they come from. Rows refer to each other by id; reads join in the
 * names and rebuild the scraped shapes (KHLJson) the API is built from.
 */
export class LeagueDatabase {
	constructor(private db: SQLiteDatabase) {}

	// --- Seasons, divisions, and teams ---

	/** `isDefault`: the league's default teams page, which shows the current season */
	saveTeamsPage(page: KHLTeamsPage, isDefault: boolean): void {
		this.db.transaction(() => {
			const upsertSeason = this.db.query(
				`INSERT INTO seasons (season_id, name) VALUES ($seasonId, $name)
				ON CONFLICT (season_id) DO UPDATE SET name = excluded.name`,
			)
			for (const season of page.seasons) {
				upsertSeason.run({seasonId: season.id, name: season.name})
			}
			if (isDefault) {
				this.db.query("UPDATE seasons SET is_current = 0").run()
				this.db
					.query(
						"UPDATE seasons SET is_current = 1 WHERE season_id = $seasonId",
					)
					.run({seasonId: page.season.id})
			}
			const upsertDivision = this.db.query(
				`INSERT INTO divisions (division_id, season_id, name)
				VALUES ($divisionId, $seasonId, $name)
				ON CONFLICT (division_id, season_id) DO UPDATE SET name = excluded.name`,
			)
			for (const division of page.divisions) {
				upsertDivision.run({
					divisionId: division.id,
					seasonId: division.seasonId,
					name: division.name,
				})
			}
			this.recordTeams(
				page.teams.map((team) => ({
					teamId: team.id,
					seasonId: team.seasonId,
					name: team.name,
					logoUrl: team.logoUrl,
					divisionId: team.divisionId,
					source: "teams-page",
				})),
			)
		})()
	}

	/** Records teams, unless a page that outranks `source` already named them */
	recordTeams(teams: TeamRecord[]): void {
		const upsert = this.db.query(
			`INSERT INTO teams (team_id, season_id, name, logo_url, division_id, source)
			VALUES ($teamId, $seasonId, $name, $logoUrl, $divisionId, $source)
			ON CONFLICT (team_id, season_id) DO UPDATE SET
				name = excluded.name,
				logo_url = coalesce(excluded.logo_url, teams.logo_url),
				division_id = coalesce(excluded.division_id, teams.division_id),
				source = excluded.source
			WHERE ${TEAM_SOURCE_RANK("excluded.source")} <= ${TEAM_SOURCE_RANK("teams.source")}`,
		)
		this.db.transaction(() => {
			for (const team of teams) {
				upsert.run({...team})
			}
		})()
	}

	getCurrentSeasonId(): string | null {
		const row = this.db
			.query<{season_id: string}, []>(
				"SELECT season_id FROM seasons WHERE is_current = 1",
			)
			.get()
		return row?.season_id ?? null
	}

	getSeasons(): KHLSeason[] {
		return this.db
			.query<{season_id: string; name: string}, []>(
				`SELECT season_id, name FROM seasons
				ORDER BY CAST(season_id AS INTEGER) DESC`,
			)
			.all()
			.map((row) => ({id: row.season_id, name: row.name}))
	}

	/**
	 * A season's teams page as recorded: the season (the current one if
	 * null), every season, and the season's divisions and teams. Null if
	 * the season isn't recorded.
	 */
	getTeamsPage(seasonId: string | null): KHLTeamsPage | null {
		const id = seasonId ?? this.getCurrentSeasonId()
		const seasons = this.getSeasons()
		const season = seasons.find((s) => s.id === id)
		if (!season) {
			return null
		}
		const divisions = this.db
			.query<{division_id: string; name: string}, {seasonId: string}>(
				`SELECT division_id, name FROM divisions WHERE season_id = $seasonId
				ORDER BY rowid`,
			)
			.all({seasonId: season.id})
			.map((row) => ({
				id: row.division_id,
				name: row.name,
				seasonId: season.id,
			}))
		const teams = this.db
			.query<
				{
					team_id: string
					name: string
					division_id: string
					logo_url: string | null
				},
				{seasonId: string}
			>(
				`SELECT team_id, name, division_id, logo_url FROM teams
				WHERE season_id = $seasonId AND source = 'teams-page'
				ORDER BY rowid`,
			)
			.all({seasonId: season.id})
			.map((row) => ({
				id: row.team_id,
				name: row.name,
				seasonId: season.id,
				divisionId: row.division_id,
				logoUrl: row.logo_url,
			}))
		return {season, seasons, divisions, teams}
	}

	getTeam(teamId: string, seasonId: string): TeamRecord | null {
		return this.db
			.query<TeamRecord, {teamId: string; seasonId: string}>(
				`SELECT team_id AS teamId, season_id AS seasonId, name,
					logo_url AS logoUrl, division_id AS divisionId, source
				FROM teams WHERE team_id = $teamId AND season_id = $seasonId`,
			)
			.get({teamId, seasonId})
	}

	/** Every season the team is listed in, newest first */
	getTeamSeasons(teamId: string): KHLSeason[] {
		return this.db
			.query<{season_id: string; name: string}, {teamId: string}>(
				`SELECT s.season_id, s.name FROM teams t
				JOIN seasons s USING (season_id)
				WHERE t.team_id = $teamId
				ORDER BY CAST(s.season_id AS INTEGER) DESC`,
			)
			.all({teamId})
			.map((row) => ({id: row.season_id, name: row.name}))
	}

	// --- Schedules ---

	/** Replaces a team's schedule as its schedule page lists it */
	saveSchedule(teamId: string, seasonId: string, games: KHLGame[]): void {
		this.db.transaction(() => {
			this.db
				.query(
					`DELETE FROM schedule_games
					WHERE team_id = $teamId AND season_id = $seasonId`,
				)
				.run({teamId, seasonId})
			const insert = this.db.query(
				`INSERT INTO schedule_games VALUES ($teamId, $seasonId, $seq,
					$gameId, $startsAt, $homeAway, $opponentId, $arenaId, $result,
					$score, $isFinal)`,
			)
			games.forEach((game, seq) => {
				if (game.arena) {
					this.recordArena(game.arena.id, game.arena.name)
				}
				insert.run({
					teamId,
					seasonId,
					seq,
					gameId: game.id,
					startsAt: game.startsAt,
					homeAway: game.homeAway,
					opponentId: game.opponent.id,
					arenaId: game.arena?.id ?? null,
					result: game.result,
					score: game.score,
					isFinal: game.isFinal ? 1 : 0,
				})
			})
			this.recordTeams(
				games.map((game) => ({
					teamId: game.opponent.id,
					seasonId: game.seasonId,
					name: game.opponent.name,
					logoUrl: null,
					divisionId: null,
					source: "schedule",
				})),
			)
		})()
	}

	/** A team's schedule as its schedule page listed it, in its order */
	getSchedule(teamId: string, seasonId: string): KHLGame[] {
		return this.db
			.query<
				{
					game_id: string | null
					starts_at: string
					home_away: KHLHomeAway
					opponent_id: string
					opponent_name: string | null
					team_name: string | null
					arena_id: string | null
					arena_name: string | null
					result: string | null
					score: string | null
					is_final: number
				},
				{teamId: string; seasonId: string}
			>(
				`SELECT g.*, o.name AS opponent_name, t.name AS team_name,
					a.name AS arena_name
				FROM schedule_games g
				LEFT JOIN teams t
					ON t.team_id = g.team_id AND t.season_id = g.season_id
				LEFT JOIN teams o
					ON o.team_id = g.opponent_id AND o.season_id = g.season_id
				LEFT JOIN arenas a ON a.arena_id = g.arena_id
				WHERE g.team_id = $teamId AND g.season_id = $seasonId
				ORDER BY g.seq`,
			)
			.all({teamId, seasonId})
			.map((row): KHLGame => ({
				id: row.game_id,
				seasonId,
				team: {id: teamId, name: row.team_name ?? teamId},
				opponent: {
					id: row.opponent_id,
					name: row.opponent_name ?? row.opponent_id,
				},
				homeAway: row.home_away,
				...getLeagueLocalTime(row.starts_at),
				startsAt: row.starts_at,
				arena: row.arena_id
					? {id: row.arena_id, name: row.arena_name ?? row.arena_id}
					: null,
				result: row.result,
				score: row.score,
				isFinal: row.is_final === 1,
			}))
	}

	recordArena(arenaId: string, name: string): void {
		this.db
			.query(
				`INSERT INTO arenas (arena_id, name) VALUES ($arenaId, $name)
				ON CONFLICT (arena_id) DO UPDATE SET name = excluded.name`,
			)
			.run({arenaId, name})
	}

	// --- Rosters ---

	/** Replaces a team's stats page: its columns and its players' rows */
	saveTeamStats(stats: KHLTeamStats): void {
		const {teamId, seasonId} = stats
		this.db.transaction(() => {
			this.db
				.query(
					`INSERT INTO team_seasons VALUES ($teamId, $seasonId,
						$skaterColumns, $goalieColumns)
					ON CONFLICT (team_id, season_id) DO UPDATE SET
						skater_columns = excluded.skater_columns,
						goalie_columns = excluded.goalie_columns`,
				)
				.run({
					teamId,
					seasonId,
					skaterColumns: JSON.stringify(stats.skaterColumns),
					goalieColumns: JSON.stringify(stats.goalieColumns),
				})
			this.db
				.query(
					`DELETE FROM roster_stats
					WHERE team_id = $teamId AND season_id = $seasonId`,
				)
				.run({teamId, seasonId})
			const insert = this.db.query(
				`INSERT INTO roster_stats VALUES ($teamId, $seasonId, $isGoalie,
					$seq, $khlPlayerId, $number, $stats)`,
			)
			const insertRows = (rows: KHLRosterRow[], isGoalie: boolean) => {
				rows.forEach((row, seq) => {
					insert.run({
						teamId,
						seasonId,
						isGoalie: isGoalie ? 1 : 0,
						seq,
						khlPlayerId: row.playerId,
						number: row.number,
						stats: JSON.stringify(row.stats),
					})
				})
			}
			insertRows(stats.skaters, false)
			insertRows(stats.goalies, true)
		})()
	}

	/** A team's stats page as recorded; null if it isn't */
	getTeamStats(teamId: string, seasonId: string): KHLTeamStats | null {
		const columns = this.db
			.query<
				{skater_columns: string; goalie_columns: string},
				{teamId: string; seasonId: string}
			>(
				`SELECT skater_columns, goalie_columns FROM team_seasons
				WHERE team_id = $teamId AND season_id = $seasonId`,
			)
			.get({teamId, seasonId})
		if (!columns) {
			return null
		}
		const rows = this.getRosterRows(teamId, seasonId)
		const toRosterRow = (row: RosterStatRow): KHLRosterRow => ({
			playerId: row.khlPlayerId,
			number: row.number,
			name: row.name,
			stats: row.stats,
		})
		return {
			teamId,
			seasonId,
			seasons: this.getTeamSeasons(teamId),
			skaterColumns: parseJson(StringsJson, columns.skater_columns),
			skaters: rows.filter((r) => !r.isGoalie).map(toRosterRow),
			goalieColumns: parseJson(StringsJson, columns.goalie_columns),
			goalies: rows.filter((r) => r.isGoalie).map(toRosterRow),
		}
	}

	/** Every team's roster rows that season, by team; only teams recorded */
	getSeasonRosters(seasonId: string): Map<string, RosterStatRow[]> {
		const rosters = new Map<string, RosterStatRow[]>()
		for (const row of this.getRosterRows(null, seasonId)) {
			rosters.set(row.teamId, [...(rosters.get(row.teamId) ?? []), row])
		}
		const recorded = this.db
			.query<{team_id: string}, {seasonId: string}>(
				"SELECT team_id FROM team_seasons WHERE season_id = $seasonId",
			)
			.all({seasonId})
		for (const {team_id} of recorded) {
			rosters.set(team_id, rosters.get(team_id) ?? [])
		}
		return rosters
	}

	private getRosterRows(
		teamId: string | null,
		seasonId: string,
	): RosterStatRow[] {
		return this.db
			.query<
				{
					team_id: string
					khl_player_id: string
					is_goalie: number
					number: string | null
					stats: string
					name: string | null
				},
				{teamId: string | null; seasonId: string}
			>(
				`SELECT s.team_id, s.khl_player_id, s.is_goalie, s.number, s.stats,
					r.name
				FROM roster_stats s
				LEFT JOIN registrations r
					ON r.khl_player_id = s.khl_player_id AND r.team_id = s.team_id
				WHERE s.season_id = $seasonId
					AND ($teamId IS NULL OR s.team_id = $teamId)
				ORDER BY s.team_id, s.is_goalie, s.seq`,
			)
			.all({teamId, seasonId})
			.map((row) => ({
				teamId: row.team_id,
				khlPlayerId: row.khl_player_id,
				isGoalie: row.is_goalie === 1,
				number: row.number,
				name: row.name ?? row.khl_player_id,
				stats: parseJson(StatsJson, row.stats),
			}))
	}

	// --- Player profiles ---

	savePlayerProfile(player: KHLPlayer): void {
		this.db
			.query(
				`INSERT INTO player_profiles VALUES ($khlPlayerId, $teamId,
					$seasonId, $number, $position, $teamLine, $statSections,
					$seasonTables)
				ON CONFLICT (khl_player_id, team_id, season_id) DO UPDATE SET
					number = excluded.number,
					position = excluded.position,
					team_line = excluded.team_line,
					stat_sections = excluded.stat_sections,
					season_tables = excluded.season_tables`,
			)
			.run({
				khlPlayerId: player.playerId,
				teamId: player.teamId,
				seasonId: player.seasonId,
				number: player.number,
				position: player.position,
				teamLine: player.teamLine,
				statSections: JSON.stringify(player.statSections),
				seasonTables: JSON.stringify(player.seasonTables),
			})
	}

	/** A registration's player page as of a season; null if not recorded */
	getPlayerProfile(key: RegistrationKey, seasonId: string): KHLPlayer | null {
		const {khlPlayerId, teamId} = parseRegistrationKey(key)
		const row = this.db
			.query<
				{
					number: string | null
					position: string | null
					team_line: string | null
					stat_sections: string
					season_tables: string
					name: string | null
				},
				{khlPlayerId: string; teamId: string; seasonId: string}
			>(
				`SELECT p.*, r.name FROM player_profiles p
				LEFT JOIN registrations r
					ON r.khl_player_id = p.khl_player_id AND r.team_id = p.team_id
				WHERE p.khl_player_id = $khlPlayerId AND p.team_id = $teamId
					AND p.season_id = $seasonId`,
			)
			.get({khlPlayerId, teamId, seasonId})
		if (!row) {
			return null
		}
		return {
			playerId: khlPlayerId,
			teamId,
			seasonId,
			name: row.name ?? khlPlayerId,
			number: row.number,
			position: row.position,
			teamLine: row.team_line,
			statSections: parseJson(StatSectionsJson, row.stat_sections),
			seasonTables: parseJson(SeasonTablesJson, row.season_tables),
		}
	}

	// --- Games ---

	/**
	 * Replaces a game from its box score and stats page (null if that
	 * couldn't be read, leaving both lineups unposted). A complete game is
	 * never replaced by an incomplete one, which would be an older copy of
	 * its pages. Returns whether it was saved, and whether it's complete
	 * now having been saved incomplete before.
	 */
	saveGame(
		boxScore: KHLBoxScore,
		stats: KHLGameStats | null,
		now: number,
	): {saved: boolean; completedSinceLastSave: boolean} {
		const gameId = boxScore.gameId
		const isComplete = isGameRecordComplete({
			hasSummary: boxScore.hasSummary,
			away: {lineupPosted: hasLineup(stats?.away)},
			home: {lineupPosted: hasLineup(stats?.home)},
		})
		const existing = this.db
			.query<{completed_at: number | null}, {gameId: string}>(
				"SELECT completed_at FROM games WHERE game_id = $gameId",
			)
			.get({gameId})
		if (existing?.completed_at && !isComplete) {
			return {saved: false, completedSinceLastSave: false}
		}
		const completedAt = isComplete ? (existing?.completed_at ?? now) : null
		this.db.transaction(() => {
			if (boxScore.arena) {
				this.recordArena(boxScore.arena.id, boxScore.arena.name)
			}
			this.recordTeams(
				[boxScore.away, boxScore.home].map((team) => ({
					teamId: team.id,
					seasonId: team.seasonId,
					name: team.name,
					logoUrl: team.logoUrl,
					divisionId: null,
					source: "box-score",
				})),
			)
			// Cascades to its teams, periods, events, and lineups
			this.db
				.query("DELETE FROM games WHERE game_id = $gameId")
				.run({gameId})
			this.db
				.query(
					`INSERT INTO games VALUES ($gameId, $startsAt, $arenaId, $periods,
						$hasSummary, $processedAt, $completedAt)`,
				)
				.run({
					gameId,
					startsAt: boxScore.startsAt,
					arenaId: boxScore.arena?.id ?? null,
					periods: JSON.stringify(boxScore.periods),
					hasSummary: boxScore.hasSummary ? 1 : 0,
					processedAt: now,
					completedAt,
				})
			const insertTeam = this.db.query(
				`INSERT INTO game_teams VALUES ($gameId, $side, $teamId, $seasonId,
					$goals, $shots, $skaterColumns, $goalieColumns)`,
			)
			const insertPeriod = this.db.query(
				`INSERT INTO game_periods VALUES ($gameId, $side, $period, $goals,
					$shots)`,
			)
			const insertLineup = this.db.query(
				`INSERT OR IGNORE INTO game_lineups VALUES ($gameId, $teamId,
					$isGoalie, $seq, $khlPlayerId, $number, $stats)`,
			)
			for (const side of ["away", "home"] as const) {
				const team = boxScore[side]
				const lineup = stats?.[side] ?? null
				insertTeam.run({
					gameId,
					side,
					teamId: team.id,
					seasonId: team.seasonId,
					goals: team.goals,
					shots: team.shots,
					skaterColumns: lineup
						? JSON.stringify(lineup.skaterColumns)
						: null,
					goalieColumns: lineup
						? JSON.stringify(lineup.goalieColumns)
						: null,
				})
				const periods = Math.max(
					team.goalsByPeriod.length,
					team.shotsByPeriod.length,
				)
				for (let period = 0; period < periods; period++) {
					insertPeriod.run({
						gameId,
						side,
						period,
						goals: team.goalsByPeriod[period] ?? null,
						shots: team.shotsByPeriod[period] ?? null,
					})
				}
				for (const [isGoalie, rows] of [
					[0, lineup?.skaters ?? []],
					[1, lineup?.goalies ?? []],
				] as const) {
					rows.forEach((row, seq) => {
						insertLineup.run({
							gameId,
							teamId: team.id,
							isGoalie,
							seq,
							khlPlayerId: row.playerId,
							number: row.number,
							stats: JSON.stringify(row.stats),
						})
					})
				}
			}
			const insertEvent = this.db.query(
				`INSERT INTO game_events VALUES ($gameId, $seq, $kind, $teamId,
					$period, $time, $goalType, $scorerSeasonGoals, $infraction,
					$duration)`,
			)
			const insertPlayer = this.db.query(
				`INSERT INTO game_event_players VALUES ($gameId, $seq, $role,
					$position, $khlPlayerId)`,
			)
			toScoresheetOrder(boxScore).forEach((event, seq) => {
				const {row, players} = toEventRow(event)
				insertEvent.run({gameId, seq, ...row})
				for (const player of players) {
					insertPlayer.run({gameId, seq, ...player})
				}
			})
		})()
		return {
			saved: true,
			completedSinceLastSave:
				isComplete && !!existing && !existing.completed_at,
		}
	}

	/** A game's box score as recorded; null if it isn't */
	getBoxScore(gameId: string): KHLBoxScore | null {
		const game = this.getGameRow(gameId)
		if (!game) {
			return null
		}
		const teams = this.getGameTeamRows(gameId)
		const periods = this.db
			.query<
				{side: KHLHomeAway; goals: number | null; shots: number | null},
				{gameId: string}
			>(
				`SELECT side, goals, shots FROM game_periods
				WHERE game_id = $gameId ORDER BY side, period`,
			)
			.all({gameId})
		const toTeam = (side: KHLHomeAway): KHLBoxScoreTeam => {
			const team = teams.find((t) => t.side === side)!
			const own = periods.filter((p) => p.side === side)
			return {
				id: team.team_id,
				name: team.name ?? team.team_id,
				logoUrl: team.logo_url,
				seasonId: team.season_id,
				goalsByPeriod: own.flatMap((p) =>
					p.goals === null ? [] : [p.goals],
				),
				goals: team.goals,
				shotsByPeriod: own.flatMap((p) =>
					p.shots === null ? [] : [p.shots],
				),
				shots: team.shots,
			}
		}
		const events = this.getGameEvents([gameId], {kind: "all"})
		return {
			gameId,
			...getLeagueLocalTime(game.starts_at),
			startsAt: game.starts_at,
			arena: game.arena_id
				? {id: game.arena_id, name: game.arena_name ?? game.arena_id}
				: null,
			away: toTeam("away"),
			home: toTeam("home"),
			hasSummary: game.has_summary === 1,
			periods: parseJson(StringsJson, game.periods),
			goals: events.flatMap(({event}) =>
				matchField(event, "kind", {
					goal: (e) => [e.goal],
					assist: (): KHLGoal[] => [],
					penalty: (): KHLGoal[] => [],
				}),
			),
			penalties: events.flatMap(({event}) =>
				matchField(event, "kind", {
					goal: (): KHLPenalty[] => [],
					assist: (): KHLPenalty[] => [],
					penalty: (e) => [e.penalty],
				}),
			),
		}
	}

	/** A game's stats page as recorded; null if it couldn't be read */
	getGameStats(gameId: string): KHLGameStats | null {
		const teams = this.getGameTeamRows(gameId)
		if (
			teams.length === 0 ||
			teams.some((t) => t.skater_columns === null)
		) {
			return null
		}
		const lineups = this.db
			.query<
				{
					team_id: string
					is_goalie: number
					khl_player_id: string
					number: string | null
					stats: string
					name: string | null
				},
				{gameId: string}
			>(
				`SELECT l.team_id, l.is_goalie, l.khl_player_id, l.number, l.stats,
					r.name
				FROM game_lineups l
				LEFT JOIN registrations r
					ON r.khl_player_id = l.khl_player_id AND r.team_id = l.team_id
				WHERE l.game_id = $gameId
				ORDER BY l.team_id, l.is_goalie, l.seq`,
			)
			.all({gameId})
		const toSide = (side: KHLHomeAway): KHLGameTeamStats => {
			const team = teams.find((t) => t.side === side)!
			const rows = lineups.filter((l) => l.team_id === team.team_id)
			const toRow = (row: (typeof rows)[number]): KHLRosterRow => ({
				playerId: row.khl_player_id,
				number: row.number,
				name: row.name ?? row.khl_player_id,
				stats: parseJson(StatsJson, row.stats),
			})
			return {
				skaterColumns: parseJson(StringsJson, team.skater_columns!),
				skaters: rows.filter((r) => r.is_goalie === 0).map(toRow),
				goalieColumns: parseJson(StringsJson, team.goalie_columns!),
				goalies: rows.filter((r) => r.is_goalie === 1).map(toRow),
			}
		}
		return {gameId, away: toSide("away"), home: toSide("home")}
	}

	/** Games as activity reads them, by id; games not recorded are left out */
	getGames(gameIds: string[]): Map<string, GameRecord> {
		const games = new Map<string, GameRecord>()
		for (const gameId of gameIds) {
			const game = this.getGameRow(gameId)
			if (!game) {
				continue
			}
			const teams = this.getGameTeamRows(gameId)
			const toTeam = (side: KHLHomeAway): GameRecordTeam => {
				const team = teams.find((t) => t.side === side)!
				return {
					id: team.team_id,
					name: team.name ?? team.team_id,
					logoUrl: team.logo_url,
					seasonId: team.season_id,
					goals: team.goals,
					lineupPosted: team.lineup_rows > 0,
				}
			}
			games.set(gameId, {
				gameId,
				startsAt: game.starts_at,
				...getLeagueLocalTime(game.starts_at),
				arenaId: game.arena_id,
				away: toTeam("away"),
				home: toTeam("home"),
				hasSummary: game.has_summary === 1,
				processedAt: game.processed_at,
				completedAt: game.completed_at,
			})
		}
		return games
	}

	private getGameRow(gameId: string) {
		return this.db
			.query<
				{
					starts_at: string
					arena_id: string | null
					arena_name: string | null
					periods: string
					has_summary: number
					processed_at: number
					completed_at: number | null
				},
				{gameId: string}
			>(
				`SELECT g.*, a.name AS arena_name FROM games g
				LEFT JOIN arenas a ON a.arena_id = g.arena_id
				WHERE g.game_id = $gameId`,
			)
			.get({gameId})
	}

	private getGameTeamRows(gameId: string) {
		return this.db
			.query<
				{
					side: KHLHomeAway
					team_id: string
					season_id: string
					goals: number | null
					shots: number | null
					skater_columns: string | null
					goalie_columns: string | null
					name: string | null
					logo_url: string | null
					lineup_rows: number
				},
				{gameId: string}
			>(
				`SELECT gt.*, t.name, t.logo_url,
					(SELECT count(*) FROM game_lineups l
						WHERE l.game_id = gt.game_id AND l.team_id = gt.team_id)
						AS lineup_rows
				FROM game_teams gt
				LEFT JOIN teams t
					ON t.team_id = gt.team_id AND t.season_id = gt.season_id
				WHERE gt.game_id = $gameId`,
			)
			.all({gameId})
	}

	/**
	 * Goals, assists, and penalties in `gameIds`: those any of the players
	 * were in (a goal they scored or assisted, or their penalty), the team's
	 * goals and penalties, or all of them. In scoresheet order within each
	 * game.
	 */
	getGameEvents(
		gameIds: string[],
		by:
			| {kind: "players"; khlPlayerIds: string[]}
			| {kind: "team"; teamId: string}
			| {kind: "all"},
	): GameEventRecord[] {
		const games = toPlaceholders(gameIds)
		const [where, params] = matchField(by, "kind", {
			players: (b): [string, string[]] => [
				`EXISTS (SELECT 1 FROM game_event_players p
					WHERE p.game_id = e.game_id AND p.seq = e.seq
					AND p.khl_player_id IN (${toPlaceholders(b.khlPlayerIds)}))`,
				b.khlPlayerIds,
			],
			team: (b): [string, string[]] => ["e.team_id = ?", [b.teamId]],
			all: (): [string, string[]] => ["1", []],
		})
		const eventRows = this.db
			.query<EventRow, string[]>(
				`SELECT e.* FROM game_events e
				WHERE e.game_id IN (${games}) AND ${where}
				ORDER BY e.game_id, e.seq`,
			)
			.all(...gameIds, ...params)
		const playerRows = this.db
			.query<
				{
					game_id: string
					seq: number
					role: EventRole
					khl_player_id: string
					name: string | null
				},
				string[]
			>(
				`SELECT p.game_id, p.seq, p.role, p.khl_player_id, r.name
				FROM game_event_players p
				JOIN game_events e USING (game_id, seq)
				LEFT JOIN registrations r
					ON r.khl_player_id = p.khl_player_id AND r.team_id = e.team_id
				WHERE p.game_id IN (${games})
				ORDER BY p.game_id, p.seq, p.position`,
			)
			.all(...gameIds)
		const playersByEvent = new Map<string, typeof playerRows>()
		for (const row of playerRows) {
			const key = `${row.game_id}:${row.seq}`
			playersByEvent.set(key, [...(playersByEvent.get(key) ?? []), row])
		}

		return eventRows.map((row): GameEventRecord => {
			const players =
				playersByEvent.get(`${row.game_id}:${row.seq}`) ?? []
			const refs = (role: EventRole): KHLPlayerRef[] =>
				players
					.filter((p) => p.role === role)
					.map((p) => ({
						id: p.khl_player_id,
						// Recorded when the game was processed; the id is a last resort
						name: p.name ?? p.khl_player_id,
					}))
			const event = matchValue(row.kind, {
				goal: (): ActivityEvent => {
					const goal: KHLGoal = {
						period: row.period,
						time: row.time,
						teamId: row.team_id,
						scorer: refs("scorer")[0]!,
						scorerSeasonGoals: row.scorer_season_goals,
						assists: refs("assist"),
						type: row.goal_type,
					}
					// For a player, a goal they only assisted is an assist
					const kind = matchField(by, "kind", {
						players: (b) =>
							b.khlPlayerIds.includes(goal.scorer.id)
								? ("goal" as const)
								: ("assist" as const),
						team: () => "goal" as const,
						all: () => "goal" as const,
					})
					return {kind, goal}
				},
				penalty: (): ActivityEvent => ({
					kind: "penalty",
					penalty: {
						period: row.period,
						time: row.time,
						teamId: row.team_id,
						player: refs("penalized")[0] ?? null,
						infraction: row.infraction!,
						duration: row.duration!,
					},
				}),
			})()
			return {gameId: row.game_id, event}
		})
	}

	/** The games in `gameIds` any of the players dressed for */
	getDressedGameIds(gameIds: string[], khlPlayerIds: string[]): Set<string> {
		const rows = this.db
			.query<{game_id: string}, string[]>(
				`SELECT DISTINCT game_id FROM game_lineups
				WHERE game_id IN (${toPlaceholders(gameIds)})
					AND khl_player_id IN (${toPlaceholders(khlPlayerIds)})`,
			)
			.all(...gameIds, ...khlPlayerIds)
		return new Set(rows.map((row) => row.game_id))
	}

	/** Who dressed for a game, as registrations */
	getLineupKeys(gameId: string): {teamId: string; khlPlayerId: string}[] {
		return this.db
			.query<{team_id: string; khl_player_id: string}, {gameId: string}>(
				`SELECT DISTINCT team_id, khl_player_id FROM game_lineups
				WHERE game_id = $gameId`,
			)
			.all({gameId})
			.map((row) => ({
				teamId: row.team_id,
				khlPlayerId: row.khl_player_id,
			}))
	}

	// --- The fetch queue ---

	/**
	 * Adds a page to the queue, leaving one already queued alone, unless
	 * `ifSyncedBefore` is given: then a queued page last synced before then
	 * (or never) is brought forward to `nextAt`, since it's out of date.
	 */
	enqueue(
		url: string,
		page: SyncPage,
		{
			seasonId,
			priority,
			nextAt,
		}: {seasonId: string | null; priority: number; nextAt: number},
		ifSyncedBefore?: number,
	): void {
		const onConflict =
			ifSyncedBefore === undefined
				? "DO NOTHING"
				: `DO UPDATE SET next_at = min(next_at, excluded.next_at)
					WHERE fetch_queue.synced_at IS NULL
						OR fetch_queue.synced_at < $ifSyncedBefore`
		this.db
			.query(
				`INSERT INTO fetch_queue (url, page, season_id, priority, next_at)
				VALUES ($url, $page, $seasonId, $priority, $nextAt)
				ON CONFLICT (url) ${onConflict}`,
			)
			.run({
				url,
				page: JSON.stringify(page),
				seasonId,
				priority,
				nextAt,
				...(ifSyncedBefore === undefined ? {} : {ifSyncedBefore}),
			})
	}

	/**
	 * Puts a page a visitor is waiting on ahead of the rest of the queue,
	 * due now, until it's synced or fails (see markSynced and markFailed)
	 */
	request(
		url: string,
		page: SyncPage,
		{seasonId, priority}: {seasonId: string | null; priority: number},
		now: number,
	): void {
		this.db
			.query(
				`INSERT INTO fetch_queue
					(url, page, season_id, priority, next_at, requested)
				VALUES ($url, $page, $seasonId, $priority, $now, 1)
				ON CONFLICT (url) DO UPDATE SET requested = 1,
					next_at = min(next_at, excluded.next_at)`,
			)
			.run({url, page: JSON.stringify(page), seasonId, priority, now})
	}

	/** The most urgent page that's due, requested ones first; null if none is */
	takeDue(now: number): QueuedPage | null {
		return this.toQueuedPage(
			this.db
				.query<QueueRow, {now: number}>(
					`SELECT url, page, season_id, attempts FROM fetch_queue
					WHERE next_at <= $now
					ORDER BY requested DESC, priority, next_at, rowid LIMIT 1`,
				)
				.get({now}),
		)
	}

	/**
	 * A synced page whose rows an older version of the processing built.
	 * One whose last sync failed waits until it's due instead, so a page
	 * that won't process doesn't come back here at once.
	 */
	takeOutdated(version: number): QueuedPage | null {
		return this.toQueuedPage(
			this.db
				.query<QueueRow, {version: number}>(
					`SELECT url, page, season_id, attempts FROM fetch_queue
					WHERE processed_version < $version AND last_error IS NULL
					LIMIT 1`,
				)
				.get({version}),
		)
	}

	/** When the next page is due; null if nothing is queued */
	getNextDueAt(): number | null {
		const row = this.db
			.query<{next_at: number | null}, []>(
				"SELECT min(next_at) AS next_at FROM fetch_queue",
			)
			.get()
		return row?.next_at ?? null
	}

	/** When the page was last synced and is next due; null if not queued */
	getQueueInfo(
		url: string,
	): {syncedAt: number | null; nextAt: number} | null {
		const row = this.db
			.query<{synced_at: number | null; next_at: number}, {url: string}>(
				"SELECT synced_at, next_at FROM fetch_queue WHERE url = $url",
			)
			.get({url})
		return row ? {syncedAt: row.synced_at, nextAt: row.next_at} : null
	}

	/**
	 * Whether the page has been synced; if not, whether its last try failed
	 * and it's waiting to be retried
	 */
	getSyncState(url: string, now: number): "synced" | "waiting" | "unsynced" {
		const row = this.db
			.query<
				{
					processed_version: number | null
					last_error: string | null
					next_at: number
				},
				{url: string}
			>(
				`SELECT processed_version, last_error, next_at FROM fetch_queue
				WHERE url = $url`,
			)
			.get({url})
		if (row?.processed_version != null) {
			return "synced"
		}
		return row?.last_error && row.next_at > now ? "waiting" : "unsynced"
	}

	/** Whether the page has been synced (fetched or read, and processed) */
	isSynced(url: string): boolean {
		return !!this.db
			.query<{found: number}, {url: string}>(
				`SELECT 1 AS found FROM fetch_queue
				WHERE url = $url AND processed_version IS NOT NULL`,
			)
			.get({url})
	}

	markSynced(
		url: string,
		{nextAt, version, now}: {nextAt: number; version: number; now: number},
	): void {
		this.db
			.query(
				`UPDATE fetch_queue SET next_at = $nextAt, attempts = 0,
					last_error = NULL, synced_at = $now, processed_version = $version,
					requested = 0
				WHERE url = $url`,
			)
			.run({url, nextAt, version, now})
	}

	markFailed(
		url: string,
		{nextAt, error}: {nextAt: number; error: string},
	): void {
		this.db
			.query(
				`UPDATE fetch_queue SET next_at = $nextAt, attempts = attempts + 1,
					last_error = $error, requested = 0
				WHERE url = $url`,
			)
			.run({url, nextAt, error})
	}

	/**
	 * Re-ranks queued pages by how many seasons before the current one they
	 * are. Teams pages are queued without a season, so they keep theirs.
	 */
	setCurrentSeason(currentSeasonId: string): void {
		this.db
			.query(
				`UPDATE fetch_queue SET priority = max(0,
					CAST($current AS INTEGER) - CAST(season_id AS INTEGER))
				WHERE season_id IS NOT NULL`,
			)
			.run({current: currentSeasonId})
	}

	/** Pages whose last sync failed, for a season */
	getFailedUrls(seasonId: string): Set<string> {
		return new Set(
			this.db
				.query<{url: string}, {seasonId: string}>(
					`SELECT url FROM fetch_queue
					WHERE season_id = $seasonId AND last_error IS NOT NULL`,
				)
				.all({seasonId})
				.map((row) => row.url),
		)
	}

	/**
	 * How far the sync has got, by kind of page: queued, synced at least
	 * once, failing (the last sync failed), and due now, overall and for
	 * the current season. A teams page's season is the one it lists; the
	 * league's default one, a second copy of the current season's, has none.
	 */
	getQueueSummary(now: number): QueueSummary {
		const kinds = this.db
			.query<
				{
					kind: string
					total: number
					synced: number
					failing: number
					due: number
					current_total: number
					current_synced: number
					current_failing: number
				},
				{now: number}
			>(
				`WITH queue AS (
					SELECT *, json_extract(page, '$.kind') AS kind,
						coalesce(season_id, json_extract(page, '$.seasonId'))
							= current.id AS is_current
					FROM fetch_queue
					LEFT JOIN (
						SELECT season_id AS id FROM seasons WHERE is_current = 1
					) current
				)
				SELECT kind, count(*) AS total,
					count(processed_version) AS synced,
					count(last_error) AS failing,
					coalesce(sum(next_at <= $now), 0) AS due,
					coalesce(sum(is_current IS 1), 0) AS current_total,
					coalesce(sum(is_current IS 1 AND processed_version IS NOT NULL), 0)
						AS current_synced,
					coalesce(sum(is_current IS 1 AND last_error IS NOT NULL), 0)
						AS current_failing
				FROM queue GROUP BY kind`,
			)
			.all({now})
			.map((row) => ({
				kind: parseStored(SyncPageKindSchema, row.kind),
				total: row.total,
				synced: row.synced,
				failing: row.failing,
				due: row.due,
				current: {
					total: row.current_total,
					synced: row.current_synced,
					failing: row.current_failing,
				},
			}))
		const times = this.db
			.query<
				{last_synced_at: number | null; next_due_at: number | null},
				{now: number}
			>(
				`SELECT max(synced_at) AS last_synced_at,
					min(CASE WHEN next_at > $now THEN next_at END) AS next_due_at
				FROM fetch_queue`,
			)
			.get({now})
		return {
			kinds,
			lastSyncedAt: times?.last_synced_at ?? null,
			nextDueAt: times?.next_due_at ?? null,
		}
	}

	/** Pages whose last sync failed, the most urgent first */
	getFailingPages(limit: number): FailingPage[] {
		return this.db
			.query<
				QueueRow & {last_error: string; next_at: number},
				{limit: number}
			>(
				`SELECT url, page, season_id, attempts, last_error, next_at
				FROM fetch_queue WHERE last_error IS NOT NULL
				ORDER BY priority, next_at, rowid LIMIT $limit`,
			)
			.all({limit})
			.map((row) => ({
				...this.toQueuedPage(row)!,
				error: row.last_error,
				nextAt: row.next_at,
			}))
	}

	private toQueuedPage(row: QueueRow | null): QueuedPage | null {
		if (!row) {
			return null
		}
		return {
			url: row.url,
			page: parseJson(SyncPageSchema, row.page),
			seasonId: row.season_id,
			attempts: row.attempts,
		}
	}
}

export interface QueueSummary {
	kinds: {
		kind: SyncPageKind
		total: number
		synced: number
		failing: number
		due: number
		current: {total: number; synced: number; failing: number}
	}[]
	/** When a page last synced; null if none has */
	lastSyncedAt: number | null
	/** The soonest a page that isn't due yet is; null if none is queued */
	nextDueAt: number | null
}

export interface FailingPage extends QueuedPage {
	error: string
	nextAt: number
}

interface QueueRow {
	url: string
	page: string
	season_id: string | null
	attempts: number
}

type EventRole = "scorer" | "assist" | "penalized"

interface EventRow {
	game_id: string
	seq: number
	kind: "goal" | "penalty"
	team_id: string
	period: string
	time: string
	goal_type: string | null
	scorer_season_goals: number | null
	infraction: string | null
	duration: string | null
}

function hasLineup(team: KHLGameTeamStats | undefined): boolean {
	return !!team && team.skaters.length + team.goalies.length > 0
}

/** An event's game_events columns and its game_event_players rows */
function toEventRow(
	event:
		{kind: "goal"; goal: KHLGoal} | {kind: "penalty"; penalty: KHLPenalty},
): {
	row: {
		kind: "goal" | "penalty"
		teamId: string
		period: string
		time: string
		goalType: string | null
		scorerSeasonGoals: number | null
		infraction: string | null
		duration: string | null
	}
	players: {role: EventRole; position: number; khlPlayerId: string}[]
} {
	return matchField(event, "kind", {
		goal: ({goal}) => ({
			row: {
				kind: "goal" as const,
				teamId: goal.teamId,
				period: goal.period,
				time: goal.time,
				goalType: goal.type,
				scorerSeasonGoals: goal.scorerSeasonGoals,
				infraction: null,
				duration: null,
			},
			players: [
				{
					role: "scorer" as const,
					position: 0,
					khlPlayerId: goal.scorer.id,
				},
				...goal.assists.map((assist, position) => ({
					role: "assist" as const,
					position,
					khlPlayerId: assist.id,
				})),
			],
		}),
		penalty: ({penalty}) => ({
			row: {
				kind: "penalty" as const,
				teamId: penalty.teamId,
				period: penalty.period,
				time: penalty.time,
				goalType: null,
				scorerSeasonGoals: null,
				infraction: penalty.infraction,
				duration: penalty.duration,
			},
			players: penalty.player
				? [
						{
							role: "penalized" as const,
							position: 0,
							khlPlayerId: penalty.player.id,
						},
					]
				: [],
		}),
	})
}

/** "?, ?, ?" for an IN list; "NULL" for an empty one, which matches nothing */
export function toPlaceholders(values: unknown[]): string {
	return values.length > 0 ? values.map(() => "?").join(", ") : "NULL"
}

/** A JSON column, checked against what it should hold */
function parseJson<T>(schema: z.ZodType<T>, text: string): T {
	return parseStored(schema, JSON.parse(text))
}

/** A stored value, checked against what it should be */
function parseStored<T>(schema: z.ZodType<T>, value: unknown): T {
	const result = schema.safeParse(value)
	if (!result.success) {
		throw logger.newError("parseStored", "stored value doesn't match", {
			issues: z.prettifyError(result.error),
		})
	}
	return result.data
}
