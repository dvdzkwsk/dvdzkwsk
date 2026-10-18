import * as fs from "fs"
import * as path from "path"
import {Logger} from "@dvdzkwsk/logger"
import {matchField, matchValue} from "@dvdzkwsk/util/MatchUtil"
import {Database as SQLiteDatabase} from "bun:sqlite"
import {isGameRecordComplete, ScheduleGame} from "./GameRecords.js"
import {
	ActivityEvent,
	parseRegistrationKey,
	RegistrationKey,
	StatusCheck,
	StatusDay,
	StatusLevel,
	toRegistrationKey,
} from "../shared/ApiJson.js"
import {
	KHLGoal,
	KHLPenalty,
	KHLPlayerRef,
	KHLPlayerSearchResult,
	normalizePlayerName,
} from "../shared/KHLJson.js"
import {getLeagueLocalTime} from "../shared/LeagueTime.js"

const logger = new Logger("Database")

/**
 * KHL has no person-level id: a player id usually covers one team, but some
 * span several, and the same team sometimes issues a new one. We give each
 * person a UUID and attach their KHL player id and team pairs
 * ("registrations") to it.
 */
export interface Player {
	id: string
	name: string
	createdAt: string
}

/** One KHL player id on one team. */
export interface Registration {
	khlPlayerId: string
	playerId: string
	name: string
	position: string | null
	teamId: string
	teamName: string
	teamLogoUrl: string | null
	/** Seasons the registration has appeared in, oldest first */
	seasonIds: string[]
	/** When it was last recorded */
	updatedAt: string
}

/** Schema changes, applied in order. Append only; never edit a shipped one. */
const MIGRATIONS = [
	`
	CREATE TABLE players (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		-- normalized name used to match new registrations to a player
		name_key TEXT NOT NULL,
		created_at TEXT NOT NULL
	);
	CREATE INDEX players_name_key ON players (name_key);

	CREATE TABLE registrations (
		khl_player_id TEXT PRIMARY KEY,
		player_id TEXT NOT NULL REFERENCES players (id),
		name TEXT NOT NULL,
		position TEXT,
		team_id TEXT NOT NULL,
		team_name TEXT NOT NULL,
		team_logo_url TEXT,
		updated_at TEXT NOT NULL
	);
	CREATE INDEX registrations_player_id ON registrations (player_id);

	CREATE TABLE registration_seasons (
		khl_player_id TEXT NOT NULL REFERENCES registrations (khl_player_id),
		season_id TEXT NOT NULL,
		PRIMARY KEY (khl_player_id, season_id)
	);
	`,
	`
	-- One row per component per run of the status checker (see Status.ts)
	CREATE TABLE status_checks (
		component TEXT NOT NULL,
		checked_at TEXT NOT NULL,
		-- League-local "yyyy-MM-dd", which the status page groups by
		day TEXT NOT NULL,
		status TEXT NOT NULL,
		latency_ms INTEGER,
		error TEXT
	);
	CREATE INDEX status_checks_day ON status_checks (day, component);
	CREATE INDEX status_checks_component ON status_checks (component, checked_at);
	`,
	`
	-- One KHL player id can span several teams, so a registration is the
	-- (player id, team) pair. Seasons were recorded against the player id
	-- alone, which merged every team's seasons, so they're dropped here; the
	-- all-seasons search refills them the next time each player is viewed.
	DROP TABLE registration_seasons;

	CREATE TABLE registrations_by_team (
		khl_player_id TEXT NOT NULL,
		player_id TEXT NOT NULL REFERENCES players (id),
		name TEXT NOT NULL,
		position TEXT,
		team_id TEXT NOT NULL,
		team_name TEXT NOT NULL,
		team_logo_url TEXT,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (khl_player_id, team_id)
	);
	INSERT INTO registrations_by_team
		(khl_player_id, player_id, name, position, team_id, team_name, team_logo_url, updated_at)
	SELECT khl_player_id, player_id, name, position, team_id, team_name, team_logo_url, updated_at
	FROM registrations;
	DROP TABLE registrations;
	ALTER TABLE registrations_by_team RENAME TO registrations;
	CREATE INDEX registrations_player_id ON registrations (player_id);

	CREATE TABLE registration_seasons (
		khl_player_id TEXT NOT NULL,
		team_id TEXT NOT NULL,
		season_id TEXT NOT NULL,
		PRIMARY KEY (khl_player_id, team_id, season_id),
		FOREIGN KEY (khl_player_id, team_id)
			REFERENCES registrations (khl_player_id, team_id)
	);
	`,
	`
	-- Loaded KHL and LiveBarn data (see KHLCache), so it survives restarts
	CREATE TABLE cache_entries (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		loaded_at INTEGER NOT NULL,
		expires_at INTEGER NOT NULL
	);
	CREATE INDEX cache_entries_expires_at ON cache_entries (expires_at);
	`,
	`
	-- Fetched pages moved to their own file (PageStore). This holds what we
	-- compute from them (see AppCache), gzipped.
	DROP TABLE cache_entries;
	CREATE TABLE app_cache (
		key TEXT PRIMARY KEY,
		value BLOB NOT NULL,
		computed_at INTEGER NOT NULL
	);
	`,
	`
	-- Every division in every season, from the season's teams page
	CREATE TABLE divisions (
		division_id TEXT NOT NULL,
		season_id TEXT NOT NULL,
		name TEXT NOT NULL,
		PRIMARY KEY (division_id, season_id)
	);
	-- Every team in every season, from the season's teams page, or from a box
	-- score or roster for a team no teams page lists (e.g. one that folded)
	CREATE TABLE teams (
		team_id TEXT NOT NULL,
		season_id TEXT NOT NULL,
		name TEXT NOT NULL,
		logo_url TEXT,
		division_id TEXT,
		PRIMARY KEY (team_id, season_id)
	);
	-- Finished games, from each game's box score and lineups (see
	-- GameRecords.ts), so activity is a query instead of a page per game
	CREATE TABLE games (
		game_id TEXT PRIMARY KEY,
		starts_at TEXT NOT NULL,
		arena_id TEXT,
		away_id TEXT NOT NULL,
		away_season_id TEXT NOT NULL,
		away_goals INTEGER,
		home_id TEXT NOT NULL,
		home_season_id TEXT NOT NULL,
		home_goals INTEGER,
		has_summary INTEGER NOT NULL,
		away_lineup_posted INTEGER NOT NULL,
		home_lineup_posted INTEGER NOT NULL,
		processed_at INTEGER NOT NULL,
		-- When it was first saved with its summary and both lineups; null
		-- until then. Its teams' and players' pages are due after this.
		completed_at INTEGER
	);
	-- Goals and penalties, in scoresheet order (seq). Columns for one kind
	-- are null for the other.
	CREATE TABLE game_events (
		game_id TEXT NOT NULL REFERENCES games (game_id) ON DELETE CASCADE,
		seq INTEGER NOT NULL,
		kind TEXT NOT NULL,
		team_id TEXT NOT NULL,
		period TEXT NOT NULL,
		time TEXT NOT NULL,
		goal_type TEXT,
		scorer_season_goals INTEGER,
		infraction TEXT,
		duration TEXT,
		PRIMARY KEY (game_id, seq),
		CHECK (kind IN ('goal', 'penalty')),
		CHECK (kind = 'goal' OR (goal_type IS NULL AND scorer_season_goals IS NULL)),
		CHECK (kind = 'penalty' OR (infraction IS NULL AND duration IS NULL)),
		CHECK (kind = 'goal' OR (infraction IS NOT NULL AND duration IS NOT NULL))
	);
	-- Who was in each event, by KHL player id; their names come from
	-- registrations, by (KHL player id, the event's team). A bench penalty
	-- has no one.
	CREATE TABLE game_event_players (
		game_id TEXT NOT NULL,
		seq INTEGER NOT NULL,
		role TEXT NOT NULL,
		-- The assist's order on the goal; 0 for a scorer or penalized player
		position INTEGER NOT NULL,
		khl_player_id TEXT NOT NULL,
		PRIMARY KEY (game_id, seq, role, position),
		FOREIGN KEY (game_id, seq) REFERENCES game_events (game_id, seq)
			ON DELETE CASCADE,
		CHECK (role IN ('scorer', 'assist', 'penalized'))
	);
	CREATE INDEX game_event_players_player ON game_event_players (khl_player_id);
	-- Who dressed, and for which team
	CREATE TABLE game_lineups (
		game_id TEXT NOT NULL REFERENCES games (game_id) ON DELETE CASCADE,
		team_id TEXT NOT NULL,
		khl_player_id TEXT NOT NULL,
		PRIMARY KEY (game_id, team_id, khl_player_id)
	);
	CREATE INDEX game_lineups_khl_player_id ON game_lineups (khl_player_id);
	-- Each team's schedule as its schedule page lists it, so the syncer can
	-- see which games have finished without parsing the page
	CREATE TABLE schedule_games (
		team_id TEXT NOT NULL,
		season_id TEXT NOT NULL,
		seq INTEGER NOT NULL,
		-- Null for a game the league never linked
		game_id TEXT,
		starts_at TEXT NOT NULL,
		is_final INTEGER NOT NULL,
		PRIMARY KEY (team_id, season_id, seq)
	);
	-- The hash of the stored page each page's derived rows were last built
	-- from, so a page that changed, or was never processed, is processed
	-- again from what's stored
	CREATE TABLE processed_pages (
		url TEXT PRIMARY KEY,
		hash TEXT NOT NULL,
		processed_at INTEGER NOT NULL
	);
	-- Each KHL id attached to an existing player only because the names
	-- match, so those matches can be reviewed and undone
	CREATE TABLE name_matches (
		khl_player_id TEXT NOT NULL,
		team_id TEXT NOT NULL,
		player_id TEXT NOT NULL,
		accepted INTEGER NOT NULL,
		matched_at TEXT NOT NULL,
		PRIMARY KEY (khl_player_id, team_id)
	);
	`,
	`
	-- A team's name and logo belong to the team, not to each registration:
	-- keep each one's as the team's for its seasons, unless a teams page
	-- already said, then drop them from registrations
	INSERT OR IGNORE INTO teams (team_id, season_id, name, logo_url)
	SELECT r.team_id, s.season_id, r.team_name, r.team_logo_url
	FROM registrations r
	JOIN registration_seasons s USING (khl_player_id, team_id);
	ALTER TABLE registrations DROP COLUMN team_name;
	ALTER TABLE registrations DROP COLUMN team_logo_url;
	`,
]

export function openDatabase(filepath: string) {
	fs.mkdirSync(path.dirname(filepath), {recursive: true})
	const db = new SQLiteDatabase(filepath, {create: true, strict: true})
	db.exec("PRAGMA journal_mode = WAL")
	db.exec("PRAGMA foreign_keys = ON")
	migrate(db)
	return new KHLDatabase(db)
}

function migrate(db: SQLiteDatabase) {
	const {user_version: version} = db
		.query<{user_version: number}, []>("PRAGMA user_version")
		.get()!
	for (let i = version; i < MIGRATIONS.length; i++) {
		db.transaction(() => {
			db.exec(MIGRATIONS[i]!)
			db.exec(`PRAGMA user_version = ${i + 1}`)
		})()
		logger.info("migrate", "applied migration", {version: i + 1})
	}
}

interface RegistrationRow {
	khl_player_id: string
	player_id: string
	name: string
	position: string | null
	team_id: string
	/** From `teams`, as of the registration's latest season there */
	team_name: string | null
	team_logo_url: string | null
	updated_at: string
	season_ids: string | null
}

/**
 * A value we computed from fetched pages, as JSON; times are epoch
 * milliseconds
 */
export interface StoredAppCacheEntry {
	key: string
	value: string
	computedAt: number
}

/** A team as of one season */
export interface TeamRecord {
	teamId: string
	seasonId: string
	name: string
	logoUrl: string | null
	/** Null for a team known only from a box score */
	divisionId: string | null
}

/** A finished game's teams and scores, from its box score and lineups */
export interface GameRecord {
	gameId: string
	startsAt: string
	arenaId: string | null
	away: GameRecordTeam
	home: GameRecordTeam
	/** False until the league posts the game's summary */
	hasSummary: boolean
	/** Epoch milliseconds */
	processedAt: number
}

export interface GameRecordTeam {
	id: string
	/** The season the game's team links point at */
	seasonId: string
	/** Null until the summary is posted */
	goals: number | null
	/** False until the league posts who dressed */
	lineupPosted: boolean
}

/**
 * A game as read back: each team's name and logo from `teams`, its
 * league-local date and time from `startsAt`, and when it was completed
 */
export type GameRecordWithTeams = GameRecord & {
	away: GameRecordTeam & TeamDisplay
	home: GameRecordTeam & TeamDisplay
	localDate: string
	localTime: string
	/** Epoch milliseconds; null until its summary and lineups are posted */
	completedAt: number | null
}

export interface DivisionRecord {
	divisionId: string
	seasonId: string
	name: string
}

interface TeamDisplay {
	/** The team's id if no teams page or box score named it */
	name: string
	logoUrl: string | null
}

/** A goal or penalty as the box score lists it */
export type ScoresheetEvent =
	{kind: "goal"; goal: KHLGoal} | {kind: "penalty"; penalty: KHLPenalty}

type EventRole = "scorer" | "assist" | "penalized"

interface EventRow {
	game_id: string
	seq: number
	kind: ScoresheetEvent["kind"]
	team_id: string
	period: string
	time: string
	goal_type: string | null
	scorer_season_goals: number | null
	infraction: string | null
	duration: string | null
}

/** A goal or penalty in a game, with player names from registrations */
export interface GameEventRecord {
	gameId: string
	event: ActivityEvent
}

export interface GameLineupRecord {
	gameId: string
	/** The team they dressed for */
	teamId: string
	khlPlayerId: string
}

interface GameRow {
	game_id: string
	starts_at: string
	arena_id: string | null
	away_id: string
	away_season_id: string
	away_goals: number | null
	away_name: string | null
	away_logo_url: string | null
	home_id: string
	home_season_id: string
	home_goals: number | null
	home_name: string | null
	home_logo_url: string | null
	has_summary: number
	away_lineup_posted: number
	home_lineup_posted: number
	processed_at: number
	completed_at: number | null
}

interface StatusCheckRow {
	component: string
	checked_at: string
	status: string
	latency_ms: number | null
	error: string | null
}

export class KHLDatabase {
	constructor(private db: SQLiteDatabase) {}

	getPlayer(id: string): Player | null {
		return (
			this.db
				.query<Player, {id: string}>(
					"SELECT id, name, created_at AS createdAt FROM players WHERE id = $id",
				)
				.get({id}) ?? null
		)
	}

	getTeam(teamId: string, seasonId: string): TeamRecord | null {
		return this.db
			.query<TeamRecord, {teamId: string; seasonId: string}>(
				`SELECT team_id AS teamId, season_id AS seasonId, name,
					logo_url AS logoUrl, division_id AS divisionId
				FROM teams WHERE team_id = $teamId AND season_id = $seasonId`,
			)
			.get({teamId, seasonId})
	}

	/** Records a season's teams and divisions as its teams page lists them */
	recordTeams(teams: TeamRecord[], divisions: DivisionRecord[]): void {
		const upsertDivision = this.db.query(
			`INSERT INTO divisions (division_id, season_id, name)
			VALUES ($divisionId, $seasonId, $name)
			ON CONFLICT (division_id, season_id) DO UPDATE SET name = excluded.name`,
		)
		const upsert = this.db.query(
			`INSERT INTO teams (team_id, season_id, name, logo_url, division_id)
			VALUES ($teamId, $seasonId, $name, $logoUrl, $divisionId)
			ON CONFLICT (team_id, season_id) DO UPDATE SET name = excluded.name,
				logo_url = excluded.logo_url, division_id = excluded.division_id`,
		)
		this.db.transaction(() => {
			for (const division of divisions) {
				upsertDivision.run({...division})
			}
			for (const team of teams) {
				upsert.run({...team})
			}
		})()
	}

	/**
	 * Replaces a game's record, events, and lineups, and records its teams if
	 * no teams page has. A complete game is never replaced by an incomplete
	 * one, which would be an older copy of its pages; returns false then.
	 */
	saveGame(
		game: GameRecord,
		teams: TeamRecord[],
		/** In scoresheet order */
		events: ScoresheetEvent[],
		lineups: GameLineupRecord[],
	): boolean {
		const existing = this.db
			.query<{completed_at: number | null}, {gameId: string}>(
				"SELECT completed_at FROM games WHERE game_id = $gameId",
			)
			.get({gameId: game.gameId})
		const isComplete = isGameRecordComplete(game)
		if (existing?.completed_at && !isComplete) {
			return false
		}
		const completedAt = isComplete
			? (existing?.completed_at ?? game.processedAt)
			: null
		this.db.transaction(() => {
			const insertTeam = this.db.query(
				`INSERT OR IGNORE INTO teams
					(team_id, season_id, name, logo_url, division_id)
				VALUES ($teamId, $seasonId, $name, $logoUrl, $divisionId)`,
			)
			for (const team of teams) {
				insertTeam.run({...team})
			}
			// Cascades to its events and lineups
			this.db
				.query("DELETE FROM games WHERE game_id = $gameId")
				.run({gameId: game.gameId})
			this.db
				.query(
					`INSERT INTO games VALUES ($gameId, $startsAt, $arenaId,
						$awayId, $awaySeasonId, $awayGoals, $homeId, $homeSeasonId,
						$homeGoals, $hasSummary, $awayLineupPosted, $homeLineupPosted,
						$processedAt, $completedAt)`,
				)
				.run({
					gameId: game.gameId,
					startsAt: game.startsAt,
					arenaId: game.arenaId,
					awayId: game.away.id,
					awaySeasonId: game.away.seasonId,
					awayGoals: game.away.goals,
					homeId: game.home.id,
					homeSeasonId: game.home.seasonId,
					homeGoals: game.home.goals,
					hasSummary: game.hasSummary ? 1 : 0,
					awayLineupPosted: game.away.lineupPosted ? 1 : 0,
					homeLineupPosted: game.home.lineupPosted ? 1 : 0,
					processedAt: game.processedAt,
					completedAt,
				})
			const insertEvent = this.db.query(
				`INSERT INTO game_events VALUES ($gameId, $seq, $kind, $teamId,
					$period, $time, $goalType, $scorerSeasonGoals, $infraction,
					$duration)`,
			)
			const insertPlayer = this.db.query(
				`INSERT INTO game_event_players VALUES ($gameId, $seq, $role,
					$position, $khlPlayerId)`,
			)
			events.forEach((event, seq) => {
				const {row, players} = toEventRow(event)
				insertEvent.run({gameId: game.gameId, seq, ...row})
				for (const player of players) {
					insertPlayer.run({gameId: game.gameId, seq, ...player})
				}
			})
			const insertLineup = this.db.query(
				`INSERT OR IGNORE INTO game_lineups (game_id, team_id, khl_player_id)
				VALUES ($gameId, $teamId, $khlPlayerId)`,
			)
			for (const l of lineups) {
				insertLineup.run({...l})
			}
		})()
		return true
	}

	getGames(gameIds: string[]): Map<string, GameRecordWithTeams> {
		const rows = this.db
			.query<GameRow, string[]>(
				`SELECT g.*, a.name AS away_name, a.logo_url AS away_logo_url,
					h.name AS home_name, h.logo_url AS home_logo_url
				FROM games g
				LEFT JOIN teams a
					ON a.team_id = g.away_id AND a.season_id = g.away_season_id
				LEFT JOIN teams h
					ON h.team_id = g.home_id AND h.season_id = g.home_season_id
				WHERE g.game_id IN (${toPlaceholders(gameIds)})`,
			)
			.all(...gameIds)
		return new Map(rows.map((row) => [row.game_id, toGameRecord(row)]))
	}

	/**
	 * Goals, assists, and penalties in `gameIds`: those any of the players were
	 * in (a goal they scored or assisted, or their penalty), or the team's
	 * goals and penalties. In scoresheet order within each game.
	 */
	getGameEvents(
		gameIds: string[],
		by:
			| {kind: "players"; khlPlayerIds: string[]}
			| {kind: "team"; teamId: string},
	): GameEventRecord[] {
		const games = toPlaceholders(gameIds)
		const [where, params] = matchField(by, "kind", {
			players: (b) => [
				`EXISTS (SELECT 1 FROM game_event_players p
					WHERE p.game_id = e.game_id AND p.seq = e.seq
					AND p.khl_player_id IN (${toPlaceholders(b.khlPlayerIds)}))`,
				b.khlPlayerIds,
			],
			team: (b) => ["e.team_id = ?", [b.teamId]],
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
				goal: () => {
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

	/** When each player's latest game they dressed for on that team completed */
	getLatestCompletedGames(
		keys: RegistrationKey[],
	): Map<RegistrationKey, number> {
		const ids = [
			...new Set(keys.map((k) => parseRegistrationKey(k).khlPlayerId)),
		]
		const rows = this.db
			.query<
				{khl_player_id: string; team_id: string; completed_at: number},
				string[]
			>(
				`SELECT l.khl_player_id, l.team_id, max(g.completed_at) AS completed_at
				FROM game_lineups l JOIN games g USING (game_id)
				WHERE l.khl_player_id IN (${toPlaceholders(ids)})
					AND g.completed_at IS NOT NULL
				GROUP BY l.khl_player_id, l.team_id`,
			)
			.all(...ids)
		const wanted = new Set(keys)
		return new Map(
			rows.flatMap((row) => {
				const key = toRegistrationKey({
					khlPlayerId: row.khl_player_id,
					teamId: row.team_id,
				})
				return wanted.has(key) ? [[key, row.completed_at] as const] : []
			}),
		)
	}

	/** When the team's latest game that season completed; null if none has */
	getTeamLatestCompletedGame(
		teamId: string,
		seasonId: string,
	): number | null {
		const row = this.db
			.query<
				{completed_at: number | null},
				{teamId: string; seasonId: string}
			>(
				`SELECT max(completed_at) AS completed_at FROM games
				WHERE (away_id = $teamId AND away_season_id = $seasonId)
					OR (home_id = $teamId AND home_season_id = $seasonId)`,
			)
			.get({teamId, seasonId})
		return row?.completed_at ?? null
	}

	/** Replaces a team's schedule as its schedule page lists it */
	saveSchedule(
		teamId: string,
		seasonId: string,
		games: ScheduleGame[],
	): void {
		this.db.transaction(() => {
			this.db
				.query(
					"DELETE FROM schedule_games WHERE team_id = $teamId AND season_id = $seasonId",
				)
				.run({teamId, seasonId})
			const insert = this.db.query(
				`INSERT INTO schedule_games VALUES ($teamId, $seasonId, $seq,
					$gameId, $startsAt, $isFinal)`,
			)
			games.forEach((game, seq) => {
				insert.run({
					teamId,
					seasonId,
					seq,
					gameId: game.gameId,
					startsAt: game.startsAt,
					isFinal: game.isFinal ? 1 : 0,
				})
			})
		})()
	}

	getSchedule(teamId: string, seasonId: string): ScheduleGame[] {
		return this.db
			.query<
				{game_id: string | null; starts_at: string; is_final: number},
				{teamId: string; seasonId: string}
			>(
				`SELECT game_id, starts_at, is_final FROM schedule_games
				WHERE team_id = $teamId AND season_id = $seasonId ORDER BY seq`,
			)
			.all({teamId, seasonId})
			.map((row) => ({
				gameId: row.game_id,
				startsAt: row.starts_at,
				isFinal: row.is_final === 1,
			}))
	}

	/** Every team's recorded schedule that season, by team */
	getSeasonSchedules(seasonId: string): Map<string, ScheduleGame[]> {
		const rows = this.db
			.query<
				{
					team_id: string
					game_id: string | null
					starts_at: string
					is_final: number
				},
				{seasonId: string}
			>(
				`SELECT team_id, game_id, starts_at, is_final FROM schedule_games
				WHERE season_id = $seasonId ORDER BY team_id, seq`,
			)
			.all({seasonId})
		const schedules = new Map<string, ScheduleGame[]>()
		for (const row of rows) {
			schedules.set(row.team_id, [
				...(schedules.get(row.team_id) ?? []),
				{
					gameId: row.game_id,
					startsAt: row.starts_at,
					isFinal: row.is_final === 1,
				},
			])
		}
		return schedules
	}

	/** Each KHL id attached to a player only because the names match */
	getNameMatches(): {
		khlPlayerId: string
		teamId: string
		playerId: string
		accepted: boolean
	}[] {
		return this.db
			.query<
				{
					khl_player_id: string
					team_id: string
					player_id: string
					accepted: number
				},
				[]
			>(
				"SELECT khl_player_id, team_id, player_id, accepted FROM name_matches",
			)
			.all()
			.map((row) => ({
				khlPlayerId: row.khl_player_id,
				teamId: row.team_id,
				playerId: row.player_id,
				accepted: row.accepted === 1,
			}))
	}

	/** The hash of the stored page the page's derived rows were built from */
	getProcessedHash(url: string): string | null {
		const row = this.db
			.query<{hash: string}, {url: string}>(
				"SELECT hash FROM processed_pages WHERE url = $url",
			)
			.get({url})
		return row?.hash ?? null
	}

	setProcessedHash(url: string, hash: string): void {
		this.db
			.query(
				`INSERT INTO processed_pages (url, hash, processed_at)
				VALUES ($url, $hash, $now)
				ON CONFLICT (url) DO UPDATE SET hash = excluded.hash,
					processed_at = excluded.processed_at`,
			)
			.run({url, hash, now: Date.now()})
	}

	/** Our player UUID for each registration we've recorded */
	getPlayerIdsByRegistration(
		keys: RegistrationKey[],
	): Map<RegistrationKey, string> {
		const ids = [
			...new Set(keys.map((k) => parseRegistrationKey(k).khlPlayerId)),
		]
		const rows = this.db
			.query<
				{khl_player_id: string; team_id: string; player_id: string},
				string[]
			>(
				`SELECT khl_player_id, team_id, player_id FROM registrations
				WHERE khl_player_id IN (${toPlaceholders(ids)})`,
			)
			.all(...ids)
		return new Map(
			rows.map((row) => [
				toRegistrationKey({
					khlPlayerId: row.khl_player_id,
					teamId: row.team_id,
				}),
				row.player_id,
			]),
		)
	}

	hasAppCacheEntry(key: string): boolean {
		return !!this.db
			.query<{found: number}, {key: string}>(
				"SELECT 1 AS found FROM app_cache WHERE key = $key",
			)
			.get({key})
	}

	/**
	 * The KHL player ids registered on a team whose latest season there is
	 * `seasonId`: a registration's player page is read as of its latest season
	 */
	getTeamSeasonLatestPlayerIds(teamId: string, seasonId: string): string[] {
		return this.db
			.query<{khl_player_id: string}, {teamId: string; seasonId: string}>(
				`SELECT khl_player_id FROM registration_seasons
				WHERE team_id = $teamId
				GROUP BY khl_player_id
				HAVING max(CAST(season_id AS INTEGER)) = CAST($seasonId AS INTEGER)`,
			)
			.all({teamId, seasonId})
			.map((row) => row.khl_player_id)
	}

	getRegistrations(playerId: string): Registration[] {
		const rows = this.db
			.query<RegistrationRow, {playerId: string}>(
				`SELECT r.*, group_concat(s.season_id) AS season_ids,
					t.name AS team_name, t.logo_url AS team_logo_url
				FROM registrations r
				LEFT JOIN registration_seasons s USING (khl_player_id, team_id)
				LEFT JOIN teams t ON t.team_id = r.team_id AND t.season_id = (
					SELECT t2.season_id FROM teams t2
					JOIN registration_seasons s2
						ON s2.team_id = t2.team_id AND s2.season_id = t2.season_id
					WHERE s2.khl_player_id = r.khl_player_id
						AND s2.team_id = r.team_id
					ORDER BY CAST(t2.season_id AS INTEGER) DESC
					LIMIT 1
				)
				WHERE r.player_id = $playerId
				GROUP BY r.khl_player_id, r.team_id`,
			)
			.all({playerId})
		return rows.map(toRegistration)
	}

	/**
	 * Records KHL search results, attaching each new KHL player id to the
	 * player with the same normalized name (or a new player). Returns the
	 * player UUID for each KHL player id.
	 */
	recordRegistrations(results: KHLPlayerSearchResult[]): Map<string, string> {
		const playerIds = new Map<string, string>()
		this.db.transaction(() => {
			const now = new Date().toISOString()
			for (const result of results) {
				const playerId =
					this.findPlayerIdForRegistration(result.playerId) ??
					this.assignPlayer(result, now)
				this.db
					.query(
						`INSERT INTO registrations
							(khl_player_id, player_id, name, position, team_id, updated_at)
						VALUES ($khlPlayerId, $playerId, $name, $position, $teamId, $now)
						ON CONFLICT (khl_player_id, team_id) DO UPDATE SET
							name = excluded.name,
							position = coalesce(excluded.position, position),
							updated_at = excluded.updated_at`,
					)
					.run({
						khlPlayerId: result.playerId,
						playerId,
						name: result.name,
						position: result.position,
						teamId: result.teamId,
						now,
					})
				// The team as this page names it, unless a teams page already has
				this.db
					.query(
						`INSERT OR IGNORE INTO teams (team_id, season_id, name, logo_url)
						VALUES ($teamId, $seasonId, $teamName, $teamLogoUrl)`,
					)
					.run({
						teamId: result.teamId,
						seasonId: result.seasonId,
						teamName: result.teamName,
						teamLogoUrl: result.teamLogoUrl,
					})
				this.db
					.query(
						`INSERT OR IGNORE INTO registration_seasons (khl_player_id, team_id, season_id)
						VALUES ($khlPlayerId, $teamId, $seasonId)`,
					)
					.run({
						khlPlayerId: result.playerId,
						teamId: result.teamId,
						seasonId: result.seasonId,
					})
				playerIds.set(result.playerId, playerId)
			}
		})()
		return playerIds
	}

	/**
	 * Overwrites a registration's fields and seasons with a complete view of
	 * it. Unlike `recordRegistrations`, which only adds what one page shows,
	 * this removes seasons that aren't in `seasonIds`. The KHL player id and
	 * team identify the registration, so neither changes.
	 */
	reconcileRegistration(
		registration: Pick<
			Registration,
			| "khlPlayerId"
			| "teamId"
			| "name"
			| "position"
			| "teamName"
			| "teamLogoUrl"
			| "seasonIds"
		>,
	): void {
		const key = {
			khlPlayerId: registration.khlPlayerId,
			teamId: registration.teamId,
		}
		this.db.transaction(() => {
			this.db
				.query(
					`UPDATE registrations SET
						name = $name,
						position = $position,
						updated_at = $now
					WHERE khl_player_id = $khlPlayerId AND team_id = $teamId`,
				)
				.run({
					...key,
					name: registration.name,
					position: registration.position,
					now: new Date().toISOString(),
				})
			// The team's name and logo as of the registration's latest season
			const latestSeasonId = registration.seasonIds.at(-1)
			if (latestSeasonId) {
				this.db
					.query(
						`INSERT INTO teams (team_id, season_id, name, logo_url)
						VALUES ($teamId, $seasonId, $teamName, $teamLogoUrl)
						ON CONFLICT (team_id, season_id) DO UPDATE SET
							name = excluded.name,
							logo_url = coalesce(excluded.logo_url, logo_url)`,
					)
					.run({
						teamId: registration.teamId,
						seasonId: latestSeasonId,
						teamName: registration.teamName,
						teamLogoUrl: registration.teamLogoUrl,
					})
			}
			this.db
				.query(
					`DELETE FROM registration_seasons
					WHERE khl_player_id = $khlPlayerId AND team_id = $teamId`,
				)
				.run(key)
			for (const seasonId of registration.seasonIds) {
				this.db
					.query(
						`INSERT INTO registration_seasons (khl_player_id, team_id, season_id)
						VALUES ($khlPlayerId, $teamId, $seasonId)`,
					)
					.run({...key, seasonId})
			}
		})()
	}

	/** A database round trip, for the status checker */
	ping(): void {
		this.db.query("SELECT 1").get()
	}

	recordStatusCheck(check: StatusCheck & {component: string; day: string}) {
		this.db
			.query(
				`INSERT INTO status_checks
					(component, checked_at, day, status, latency_ms, error)
				VALUES ($component, $checkedAt, $day, $status, $latencyMs, $error)`,
			)
			.run({
				component: check.component,
				checkedAt: check.checkedAt,
				day: check.day,
				status: check.status,
				latencyMs: check.latencyMs,
				error: check.error,
			})
	}

	/** Each component's latest check */
	getLatestStatusChecks(): Map<string, StatusCheck> {
		const rows = this.db
			.query<StatusCheckRow, []>(
				`SELECT c.* FROM status_checks c
				JOIN (
					SELECT component, max(checked_at) AS checked_at
					FROM status_checks GROUP BY component
				) latest USING (component, checked_at)`,
			)
			.all()
		return new Map(
			rows.map((row) => [
				row.component,
				{
					checkedAt: row.checked_at,
					status: row.status as StatusLevel,
					latencyMs: row.latency_ms,
					error: row.error,
				},
			]),
		)
	}

	/** Check counts by component and day, from `fromDay` on */
	getStatusDays(fromDay: string): Map<string, StatusDay[]> {
		const rows = this.db
			.query<
				{
					component: string
					day: string
					checks: number
					degraded: number
					outages: number
				},
				{fromDay: string}
			>(
				`SELECT component, day, count(*) AS checks,
					sum(status = 'degraded') AS degraded,
					sum(status = 'outage') AS outages
				FROM status_checks WHERE day >= $fromDay
				GROUP BY component, day ORDER BY day`,
			)
			.all({fromDay})
		const days = new Map<string, StatusDay[]>()
		for (const {component, ...day} of rows) {
			days.set(component, [...(days.get(component) ?? []), day])
		}
		return days
	}

	/** Drops checks from before `day`, which the status page no longer shows */
	pruneStatusChecks(day: string): void {
		this.db.query("DELETE FROM status_checks WHERE day < $day").run({day})
	}

	getAppCacheEntry(key: string): StoredAppCacheEntry | null {
		const row = this.db
			.query<
				{value: Uint8Array<ArrayBuffer>; computed_at: number},
				{key: string}
			>("SELECT value, computed_at FROM app_cache WHERE key = $key")
			.get({key})
		if (!row) {
			return null
		}
		return {
			key,
			value: new TextDecoder().decode(Bun.gunzipSync(row.value)),
			computedAt: row.computed_at,
		}
	}

	setAppCacheEntry(entry: StoredAppCacheEntry): void {
		this.db
			.query(
				`INSERT INTO app_cache (key, value, computed_at)
				VALUES ($key, $value, $computedAt)
				ON CONFLICT (key) DO UPDATE SET value = excluded.value,
					computed_at = excluded.computed_at`,
			)
			.run({...entry, value: Bun.gzipSync(entry.value)})
	}

	/** The player a KHL player id is attached to, if we've recorded it */
	findPlayerIdForRegistration(khlPlayerId: string): string | null {
		const row = this.db
			.query<{player_id: string}, {khlPlayerId: string}>(
				"SELECT player_id FROM registrations WHERE khl_player_id = $khlPlayerId",
			)
			.get({khlPlayerId})
		return row?.player_id ?? null
	}

	/**
	 * The player a new KHL id belongs to: the one player with the same
	 * normalized name if the match is accepted (see acceptNameMatch), or else
	 * a new player. Every match is recorded in name_matches, so the automatic
	 * ones can be reviewed and undone.
	 */
	private assignPlayer(result: KHLPlayerSearchResult, now: string): string {
		const {name} = result
		const nameKey = normalizePlayerName(name)
		const candidates = this.db
			.query<{id: string}, {nameKey: string}>(
				"SELECT id FROM players WHERE name_key = $nameKey",
			)
			.all({nameKey})
		if (candidates.length === 1) {
			const candidate = candidates[0]!
			const accepted = acceptNameMatch({
				incoming: {
					khlPlayerId: result.playerId,
					teamId: result.teamId,
					seasonId: result.seasonId,
					name,
				},
				candidate: {
					playerId: candidate.id,
					registrations: this.getRegistrations(candidate.id),
				},
			})
			this.db
				.query(
					`INSERT INTO name_matches
						(khl_player_id, team_id, player_id, accepted, matched_at)
					VALUES ($khlPlayerId, $teamId, $playerId, $accepted, $now)
					ON CONFLICT (khl_player_id, team_id) DO UPDATE SET
						player_id = excluded.player_id,
						accepted = excluded.accepted,
						matched_at = excluded.matched_at`,
				)
				.run({
					khlPlayerId: result.playerId,
					teamId: result.teamId,
					playerId: candidate.id,
					accepted: accepted ? 1 : 0,
					now,
				})
			if (accepted) {
				return candidate.id
			}
		}
		if (candidates.length > 1) {
			// Namesakes were split by hand; a new registration can't be placed
			// automatically, so it becomes its own player until it's merged.
			logger.warn(
				"assignPlayer",
				"ambiguous name, creating a new player",
				{
					name,
					candidates: candidates.map((c) => c.id),
				},
			)
		}
		const id = crypto.randomUUID()
		this.db
			.query(
				`INSERT INTO players (id, name, name_key, created_at)
				VALUES ($id, $name, $nameKey, $now)`,
			)
			.run({id, name, nameKey, now})
		return id
	}
}

/** A new KHL id with the same normalized name as one existing player */
export interface NameMatch {
	incoming: {
		khlPlayerId: string
		teamId: string
		seasonId: string
		name: string
	}
	candidate: {playerId: string; registrations: Registration[]}
}

/**
 * Whether a new KHL id with the same name as an existing player is the same
 * person, or a namesake who should get their own player
 */
export function acceptNameMatch(_match: NameMatch): boolean {
	// TODO(david): decide when a match is the same person. With every
	// season's rosters synced, a match can span a decade and be two people.
	// Candidates: the candidate has a registration on the same team, or in an
	// adjacent season. Until then every match is accepted, as before, since
	// rejecting splits each returning player's seasons across players.
	return true
}

function toRegistration(row: RegistrationRow): Registration {
	return {
		khlPlayerId: row.khl_player_id,
		playerId: row.player_id,
		name: row.name,
		position: row.position,
		teamId: row.team_id,
		// The team's id if no teams page, roster, or search named it
		teamName: row.team_name ?? row.team_id,
		teamLogoUrl: row.team_logo_url,
		seasonIds: (row.season_ids?.split(",") ?? []).sort(
			(a, b) => Number(a) - Number(b),
		),
		updatedAt: row.updated_at,
	}
}

/** "?, ?, ?" for an IN list; "NULL" for an empty one, which matches nothing */
function toPlaceholders(values: unknown[]): string {
	return values.length > 0 ? values.map(() => "?").join(", ") : "NULL"
}

function toGameRecord(row: GameRow): GameRecordWithTeams {
	return {
		gameId: row.game_id,
		startsAt: row.starts_at,
		...getLeagueLocalTime(row.starts_at),
		completedAt: row.completed_at,
		arenaId: row.arena_id,
		away: {
			id: row.away_id,
			name: row.away_name ?? row.away_id,
			logoUrl: row.away_logo_url,
			seasonId: row.away_season_id,
			goals: row.away_goals,
			lineupPosted: row.away_lineup_posted === 1,
		},
		home: {
			id: row.home_id,
			name: row.home_name ?? row.home_id,
			logoUrl: row.home_logo_url,
			seasonId: row.home_season_id,
			goals: row.home_goals,
			lineupPosted: row.home_lineup_posted === 1,
		},
		hasSummary: row.has_summary === 1,
		processedAt: row.processed_at,
	}
}

/** An event's game_events columns and its game_event_players rows */
function toEventRow(event: ScoresheetEvent): {
	row: {
		kind: ScoresheetEvent["kind"]
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
