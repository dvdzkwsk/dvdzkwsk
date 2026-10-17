import * as fs from "fs"
import * as path from "path"
import {Logger} from "@dvdzkwsk/logger"
import {Database as SQLiteDatabase} from "bun:sqlite"
import {StatusCheck, StatusDay, StatusLevel} from "../shared/ApiJson.js"
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
	team_name: string
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

	getRegistrations(playerId: string): Registration[] {
		const rows = this.db
			.query<RegistrationRow, {playerId: string}>(
				`SELECT r.*, group_concat(s.season_id) AS season_ids
				FROM registrations r
				LEFT JOIN registration_seasons s USING (khl_player_id, team_id)
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
					this.assignPlayer(result.name, now)
				this.db
					.query(
						`INSERT INTO registrations
							(khl_player_id, player_id, name, position, team_id, team_name, team_logo_url, updated_at)
						VALUES ($khlPlayerId, $playerId, $name, $position, $teamId, $teamName, $teamLogoUrl, $now)
						ON CONFLICT (khl_player_id, team_id) DO UPDATE SET
							name = excluded.name,
							position = coalesce(excluded.position, position),
							team_name = excluded.team_name,
							team_logo_url = coalesce(excluded.team_logo_url, team_logo_url),
							updated_at = excluded.updated_at`,
					)
					.run({
						khlPlayerId: result.playerId,
						playerId,
						name: result.name,
						position: result.position,
						teamId: result.teamId,
						teamName: result.teamName,
						teamLogoUrl: result.teamLogoUrl,
						now,
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
						team_name = $teamName,
						team_logo_url = $teamLogoUrl,
						updated_at = $now
					WHERE khl_player_id = $khlPlayerId AND team_id = $teamId`,
				)
				.run({
					...key,
					name: registration.name,
					position: registration.position,
					teamName: registration.teamName,
					teamLogoUrl: registration.teamLogoUrl,
					now: new Date().toISOString(),
				})
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

	/** The player a KHL player id is attached to, if we've recorded it */
	findPlayerIdForRegistration(khlPlayerId: string): string | null {
		const row = this.db
			.query<{player_id: string}, {khlPlayerId: string}>(
				"SELECT player_id FROM registrations WHERE khl_player_id = $khlPlayerId",
			)
			.get({khlPlayerId})
		return row?.player_id ?? null
	}

	private assignPlayer(name: string, now: string): string {
		const nameKey = normalizePlayerName(name)
		const candidates = this.db
			.query<{id: string}, {nameKey: string}>(
				"SELECT id FROM players WHERE name_key = $nameKey",
			)
			.all({nameKey})
		if (candidates.length === 1) {
			return candidates[0]!.id
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

function toRegistration(row: RegistrationRow): Registration {
	return {
		khlPlayerId: row.khl_player_id,
		playerId: row.player_id,
		name: row.name,
		position: row.position,
		teamId: row.team_id,
		teamName: row.team_name,
		teamLogoUrl: row.team_logo_url,
		seasonIds: (row.season_ids?.split(",") ?? []).sort(
			(a, b) => Number(a) - Number(b),
		),
		updatedAt: row.updated_at,
	}
}
