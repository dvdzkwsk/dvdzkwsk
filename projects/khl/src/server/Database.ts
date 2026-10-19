import * as fs from "fs"
import * as path from "path"
import {Logger} from "@dvdzkwsk/logger"
import {Database as SQLiteDatabase} from "bun:sqlite"
import {replaceDatabaseContents} from "./DatabaseSnapshot.js"
import {LeagueDatabase, TeamSource, toPlaceholders} from "./LeagueDatabase.js"
import {
	parseRegistrationKey,
	RegistrationKey,
	StatusCheck,
	StatusBucket,
	StatusLevel,
	toRegistrationKey,
} from "../shared/ApiJson.js"
import {KHLPlayerSearchResult, normalizePlayerName} from "../shared/KHLJson.js"

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
	-- The league's data, derived from fetched pages (see KHLSyncer, which
	-- processes each page as it's stored). Rows refer to each other by id;
	-- names come from joins. Stat columns and values, which each page
	-- defines, are JSON, always read whole.
	DROP TABLE app_cache;
	CREATE TABLE seasons (
		season_id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		-- The season the league's default teams page shows
		is_current INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE divisions (
		division_id TEXT NOT NULL,
		season_id TEXT NOT NULL,
		name TEXT NOT NULL,
		PRIMARY KEY (division_id, season_id)
	);
	-- A team as of one season. source says which page named it last; a
	-- teams page outranks a schedule, a box score, a roster, and a search
	CREATE TABLE teams (
		team_id TEXT NOT NULL,
		season_id TEXT NOT NULL,
		name TEXT NOT NULL,
		logo_url TEXT,
		division_id TEXT,
		source TEXT NOT NULL,
		PRIMARY KEY (team_id, season_id),
		CHECK (source IN ('teams-page', 'schedule', 'box-score', 'roster', 'search'))
	);
	CREATE TABLE arenas (
		arena_id TEXT PRIMARY KEY,
		name TEXT NOT NULL
	);
	-- Each team's schedule as its schedule page lists it
	CREATE TABLE schedule_games (
		team_id TEXT NOT NULL,
		season_id TEXT NOT NULL,
		seq INTEGER NOT NULL,
		-- Null for a game the league never linked
		game_id TEXT,
		starts_at TEXT NOT NULL,
		home_away TEXT NOT NULL,
		opponent_id TEXT NOT NULL,
		arena_id TEXT,
		result TEXT,
		score TEXT,
		is_final INTEGER NOT NULL,
		PRIMARY KEY (team_id, season_id, seq),
		CHECK (home_away IN ('home', 'away'))
	);
	CREATE INDEX schedule_games_game_id ON schedule_games (game_id);
	-- A team's stats page: its stat columns, and a row per player
	CREATE TABLE team_seasons (
		team_id TEXT NOT NULL,
		season_id TEXT NOT NULL,
		skater_columns TEXT NOT NULL,
		goalie_columns TEXT NOT NULL,
		PRIMARY KEY (team_id, season_id)
	);
	CREATE TABLE roster_stats (
		team_id TEXT NOT NULL,
		season_id TEXT NOT NULL,
		-- Goalies are listed in both tables, with empty skater stats
		is_goalie INTEGER NOT NULL,
		seq INTEGER NOT NULL,
		khl_player_id TEXT NOT NULL,
		number TEXT,
		stats TEXT NOT NULL,
		PRIMARY KEY (team_id, season_id, is_goalie, khl_player_id)
	);
	-- A registration's player page as of one season
	CREATE TABLE player_profiles (
		khl_player_id TEXT NOT NULL,
		team_id TEXT NOT NULL,
		season_id TEXT NOT NULL,
		number TEXT,
		position TEXT,
		team_line TEXT,
		stat_sections TEXT NOT NULL,
		season_tables TEXT NOT NULL,
		PRIMARY KEY (khl_player_id, team_id, season_id)
	);
	-- A game from its box score and stats page
	CREATE TABLE games (
		game_id TEXT PRIMARY KEY,
		starts_at TEXT NOT NULL,
		arena_id TEXT,
		-- The box score's period column headers, as JSON
		periods TEXT NOT NULL,
		has_summary INTEGER NOT NULL,
		processed_at INTEGER NOT NULL,
		-- When it was first saved with its summary and both lineups; null
		-- until then
		completed_at INTEGER
	);
	CREATE TABLE game_teams (
		game_id TEXT NOT NULL REFERENCES games (game_id) ON DELETE CASCADE,
		side TEXT NOT NULL,
		team_id TEXT NOT NULL,
		-- The season the game's team links point at
		season_id TEXT NOT NULL,
		goals INTEGER,
		shots INTEGER,
		-- The stats page's columns; null if it couldn't be read
		skater_columns TEXT,
		goalie_columns TEXT,
		PRIMARY KEY (game_id, side),
		CHECK (side IN ('home', 'away'))
	);
	CREATE INDEX game_teams_team ON game_teams (team_id, season_id);
	CREATE TABLE game_periods (
		game_id TEXT NOT NULL REFERENCES games (game_id) ON DELETE CASCADE,
		side TEXT NOT NULL,
		period INTEGER NOT NULL,
		goals INTEGER,
		shots INTEGER,
		PRIMARY KEY (game_id, side, period)
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
	-- Who dressed, for which team, and their stats in the game. A team's
	-- lineup is posted once it has rows.
	CREATE TABLE game_lineups (
		game_id TEXT NOT NULL REFERENCES games (game_id) ON DELETE CASCADE,
		team_id TEXT NOT NULL,
		is_goalie INTEGER NOT NULL,
		seq INTEGER NOT NULL,
		khl_player_id TEXT NOT NULL,
		number TEXT,
		stats TEXT NOT NULL,
		PRIMARY KEY (game_id, team_id, is_goalie, khl_player_id)
	);
	CREATE INDEX game_lineups_khl_player_id ON game_lineups (khl_player_id);
	-- Every page the syncer keeps, and when it's next due. The loop takes
	-- the most urgent due page; processing a page schedules what follows
	-- from it.
	CREATE TABLE fetch_queue (
		url TEXT PRIMARY KEY,
		-- The SyncPage, as JSON
		page TEXT NOT NULL,
		season_id TEXT,
		-- Lower is sooner: how many seasons before the current one
		priority INTEGER NOT NULL,
		next_at INTEGER NOT NULL,
		attempts INTEGER NOT NULL DEFAULT 0,
		last_error TEXT,
		synced_at INTEGER,
		-- Which version of the processing built its rows (see
		-- PROCESSING_VERSION); a newer version reprocesses stored pages
		processed_version INTEGER
	);
	CREATE INDEX fetch_queue_due ON fetch_queue (priority, next_at);
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
	-- keep each one's as the team's for its seasons, as a roster names it,
	-- then drop them from registrations
	INSERT OR IGNORE INTO teams (team_id, season_id, name, logo_url, source)
	SELECT r.team_id, s.season_id, r.team_name, r.team_logo_url, 'roster'
	FROM registrations r
	JOIN registration_seasons s USING (khl_player_id, team_id);
	ALTER TABLE registrations DROP COLUMN team_name;
	ALTER TABLE registrations DROP COLUMN team_logo_url;
	`,
	`
	-- A page a visitor is waiting on goes ahead of the rest of the queue
	-- until it's synced (or fails), whatever its season
	ALTER TABLE fetch_queue ADD COLUMN requested INTEGER NOT NULL DEFAULT 0;
	DROP INDEX fetch_queue_due;
	CREATE INDEX fetch_queue_due ON fetch_queue (requested DESC, priority, next_at);
	`,
	`
	-- Past seasons' schedules and games are synced only when a visitor asks
	-- for them, so drop the ones the crawl queued that never were. A
	-- requested game is queued without a season, so it's left alone.
	DELETE FROM fetch_queue
	WHERE processed_version IS NULL AND requested = 0
		AND json_extract(page, '$.kind') IN ('schedule', 'game')
		AND season_id IS NOT NULL
		AND season_id <> (SELECT season_id FROM seasons WHERE is_current = 1);
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

interface StatusCheckRow {
	component: string
	checked_at: string
	status: string
	latency_ms: number | null
	error: string | null
}

export class KHLDatabase {
	/** The league's data derived from fetched pages, in the same file */
	readonly league: LeagueDatabase

	constructor(private db: SQLiteDatabase) {
		this.league = new LeagueDatabase(db)
	}

	/**
	 * Replaces everything with a snapshot's (e.g. production's), migrating
	 * the snapshot first. Backs this file up to `backupPath` first, since
	 * player identities can't be rebuilt.
	 */
	replaceWith(snapshotPath: string, backupPath: string) {
		const snapshot = new SQLiteDatabase(snapshotPath, {strict: true})
		try {
			migrate(snapshot)
		} finally {
			snapshot.close()
		}
		fs.rmSync(backupPath, {force: true})
		this.db.run("VACUUM INTO ?", [backupPath])
		replaceDatabaseContents(this.db, snapshotPath)
	}

	getPlayer(id: string): Player | null {
		return (
			this.db
				.query<Player, {id: string}>(
					"SELECT id, name, created_at AS createdAt FROM players WHERE id = $id",
				)
				.get({id}) ?? null
		)
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
	 * Records registrations from a page that lists players (a search, a
	 * roster, or a box score), attaching each new KHL player id to the player
	 * with the same normalized name (see acceptNameMatch), or a new player.
	 * Each team is recorded as `source` names it, unless a page that
	 * outranks it already has. Returns the player UUID for each KHL player id.
	 */
	recordRegistrations(
		results: KHLPlayerSearchResult[],
		source: TeamSource,
	): Map<string, string> {
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
				this.league.recordTeams([
					{
						teamId: result.teamId,
						seasonId: result.seasonId,
						name: result.teamName,
						logoUrl: result.teamLogoUrl,
						divisionId: null,
						source,
					},
				])
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
			// The team as the KHL's search names it, as of the registration's
			// latest season, unless a page that outranks a search has
			const latestSeasonId = registration.seasonIds.at(-1)
			if (latestSeasonId) {
				this.league.recordTeams([
					{
						teamId: registration.teamId,
						seasonId: latestSeasonId,
						name: registration.teamName,
						logoUrl: registration.teamLogoUrl,
						divisionId: null,
						source: "search",
					},
				])
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

	/**
	 * Check counts by component and bucket: `bucketMinutes`-long stretches
	 * back to back from `from` (an ISO instant)
	 */
	getStatusBuckets(
		from: string,
		bucketMinutes: number,
	): Map<string, StatusBucket[]> {
		const fromMs = Date.parse(from)
		const bucketMs = bucketMinutes * 60_000
		const rows = this.db
			.query<
				{
					component: string
					bucket: number
					checks: number
					degraded: number
					outages: number
				},
				{from: string; fromSeconds: number; bucketSeconds: number}
			>(
				`SELECT component,
					(unixepoch(checked_at) - $fromSeconds) / $bucketSeconds AS bucket,
					count(*) AS checks,
					sum(status = 'degraded') AS degraded,
					sum(status = 'outage') AS outages
				FROM status_checks WHERE checked_at >= $from
				GROUP BY component, bucket ORDER BY bucket`,
			)
			.all({
				from,
				fromSeconds: fromMs / 1000,
				bucketSeconds: bucketMs / 1000,
			})
		const buckets = new Map<string, StatusBucket[]>()
		for (const {component, bucket, ...counts} of rows) {
			const start = new Date(fromMs + bucket * bucketMs).toISOString()
			buckets.set(component, [
				...(buckets.get(component) ?? []),
				{start, ...counts},
			])
		}
		return buckets
	}

	/** Drops checks from before `before` (an ISO instant), which the status
	    page no longer shows */
	pruneStatusChecks(before: string): void {
		this.db
			.query("DELETE FROM status_checks WHERE checked_at < $before")
			.run({before})
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
