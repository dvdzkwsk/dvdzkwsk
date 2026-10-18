import {Logger} from "@dvdzkwsk/logger"
import {sleep} from "@dvdzkwsk/util/AsyncUtil"
import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import {matchField, matchValue} from "@dvdzkwsk/util/MatchUtil"
import {
	GAME_SETTLE_LIMIT_MS,
	getGameRecheckAt,
	getSettleAt,
	ScheduleGame,
} from "./GameRecords.js"
import {
	getKHLBoxScoreUrl,
	getKHLPlayerUrl,
	getKHLTeamScheduleUrl,
	getKHLTeamsPageUrl,
	getKHLTeamStatsUrl,
	runInKHLBackground,
} from "./KHL.js"
import {PageLoad, withPageLoadLog} from "./PageStore.js"
import {RegistrationKey} from "../shared/ApiJson.js"
import {KHLSeason} from "../shared/KHLJson.js"
import {DAY_MS, HOUR_MS, MINUTE_MS} from "../shared/LeagueTime.js"

const logger = new Logger("KHLSyncer")

/**
 * How often a season's pages are fetched again, on top of the refreshes a
 * finished game triggers. Past seasons are over, so they change only if the
 * league edits them.
 */
const PAGE_REFRESH_MS = {current: 6 * HOUR_MS, past: 30 * DAY_MS}
/** How long a page whose fetch failed waits before it's tried again */
const PAGE_RETRY_MS = {current: 30 * MINUTE_MS, past: DAY_MS}
/**
 * How often to look for current-season games that just finished (each pass,
 * and between the teams of a walk), and how long to wait when nothing is due
 */
const CHECK_INTERVAL_MS = 5 * MINUTE_MS

/**
 * How old a synced page can be and still be read instead of fetched when a
 * visitor needs it: twice the syncer's interval, so a sync that runs late
 * still doesn't send visitors to the KHL
 */
export function getSyncedPageMaxAgeMs(isCurrentSeason: boolean): number {
	return 2 * getSeasonPolicy(PAGE_REFRESH_MS, isCurrentSeason)
}

export function getPlayersCacheKey(seasonId: string): string {
	return `players:${seasonId}`
}

/** A page the syncer keeps */
export type SyncPage =
	| {kind: "teams"; seasonId: string}
	| {kind: "schedule"; teamId: string; seasonId: string}
	| {kind: "team-stats"; teamId: string; seasonId: string}
	| {kind: "player"; registrationKey: RegistrationKey; seasonId: string}
	/** The box score and stats page, fetched together */
	| {kind: "game"; gameId: string}

/** The URL a page is stored under; a game's is its box score's */
export function getSyncPageUrl(page: SyncPage): string {
	return matchField(page, "kind", {
		teams: (p) => getKHLTeamsPageUrl(p.seasonId),
		schedule: (p) => getKHLTeamScheduleUrl(p.teamId, p.seasonId),
		"team-stats": (p) => getKHLTeamStatsUrl(p.teamId, p.seasonId),
		player: (p) => getKHLPlayerUrl(p.registrationKey, p.seasonId),
		game: (p) => getKHLBoxScoreUrl(p.gameId),
	}).toString()
}

/**
 * Reads and stores KHL pages for the syncer, and records what's derived from
 * them. A `sync*` with `fetch` false processes the stored page, fetching it
 * only if there isn't one.
 */
export interface KHLSyncerSource {
	/** The league's current season and every season it lists */
	getSeasons: () => Promise<{current: KHLSeason; seasons: KHLSeason[]}>
	/** When the page was last fetched; null if never */
	getFetchedAt: (page: SyncPage) => number | null
	/**
	 * Whether the stored page's derived rows were built from a different
	 * copy of it, or never built
	 */
	needsProcessing: (page: SyncPage) => boolean
	/** Records the season's teams and divisions; returns the team ids */
	syncTeams: (seasonId: string, fetch: boolean) => Promise<string[]>
	/** Records the team's schedule (see getSchedule) */
	syncSchedule: (
		teamId: string,
		seasonId: string,
		fetch: boolean,
	) => Promise<void>
	/** Records the roster's registrations */
	syncTeamStats: (
		teamId: string,
		seasonId: string,
		fetch: boolean,
	) => Promise<void>
	fetchPlayer: (
		registrationKey: RegistrationKey,
		seasonId: string,
	) => Promise<void>
	/** Saves the game to the games tables from its box score and stats */
	syncGame: (gameId: string, fetch: boolean) => Promise<void>
	/** The team's schedule as last recorded; empty if never */
	getSchedule: (teamId: string, seasonId: string) => ScheduleGame[]
	/** Every team's schedule that season as last recorded, by team */
	getSeasonSchedules: (seasonId: string) => Map<string, ScheduleGame[]>
	/** Null if the game isn't in the games tables */
	getGameStatus: (gameId: string) => {isComplete: boolean} | null
	/** When the team's latest game that season completed; null if none has */
	getTeamLatestCompletedGame: (
		teamId: string,
		seasonId: string,
	) => number | null
	/**
	 * The players registered on the team whose latest season there is this
	 * one, since a registration's player page is read as of that season
	 */
	getTeamRegistrationKeys: (
		teamId: string,
		seasonId: string,
	) => RegistrationKey[]
	/** When each player's latest game they dressed for on that team completed */
	getLatestCompletedGames: (
		keys: RegistrationKey[],
	) => Map<RegistrationKey, number>
	/** Builds the season's player list from its stored team stats pages */
	buildPlayerList: (
		season: KHLSeason,
		isCurrentSeason: boolean,
	) => Promise<void>
	hasPlayerList: (seasonId: string) => boolean
}

/**
 * Keeps a copy of every KHL page behind the site's player pages: every
 * season's teams, each team's schedule and stats, each finished game's box
 * score and lineups, and each rostered player's page as of their latest
 * season. It walks the current season first, then the rest newest first,
 * fetching only the pages that are due, so a restart walks again and skips
 * what's fresh. A stored page that's not due but whose derived rows are
 * missing or out of date is processed again from storage. Fetches share the
 * KHL's background rate limit, so visitors don't wait on them.
 *
 * A page is due when it was never fetched, when its season's refresh
 * interval has passed, or when something that changes it has happened
 * since: a team's schedule after each of its games ends, its stats after
 * each game completes (its summary and lineups are posted), a player's page
 * after each completed game they dressed for, and a game's own pages until
 * it's complete.
 */
export class KHLSyncer {
	/** When each page whose fetch failed may be tried again */
	private retryAt = new Map<string, number>()
	/** When each walked season next has a page due, so others are skipped */
	private seasonDueAt = new Map<string, number>()
	/**
	 * Due times the finished-games check found during a season's walk,
	 * which the walk's own due time mustn't overwrite
	 */
	private noted = new Map<string, number>()
	private currentSeasonId: string | null = null
	private lastGameCheckAt = 0

	constructor(private source: KHLSyncerSource) {}

	start() {
		void this.run()
	}

	/**
	 * Checks for current-season games that just finished, then walks every
	 * season that has a page due, a team at a time, checking again between
	 * teams, so a refresh after a game never waits for a long walk. Returns
	 * how many pages it fetched.
	 */
	syncOnce(): Promise<number> {
		const log: PageLoad[] = []
		return runInKHLBackground(() =>
			withPageLoadLog(log, async () => {
				await this.checkFinishedGames()
				for await (const _team of this.walkDueSeasons()) {
					await this.checkFinishedGames()
				}
				return log.filter((load) =>
					matchValue(load.source, {
						memory: false,
						stored: false,
						fetched: true,
						stale: false,
					}),
				).length
			}),
		)
	}

	private async run() {
		for (;;) {
			try {
				if ((await this.syncOnce()) === 0) {
					await sleep(CHECK_INTERVAL_MS)
				}
			} catch (error) {
				// Pages' failures are handled where they're read, so this is a
				// bug; wait rather than spin
				logger.error("run", "sync failed", {error})
				await sleep(CHECK_INTERVAL_MS)
			}
		}
	}

	/** Yields after each team it walks */
	private async *walkDueSeasons(): AsyncGenerator<void> {
		let listed: {current: KHLSeason; seasons: KHLSeason[]}
		try {
			listed = await this.source.getSeasons()
		} catch (error) {
			logger.warn("walkDueSeasons", "couldn't list seasons", {error})
			return
		}
		const {current, seasons} = listed
		this.currentSeasonId = current.id
		const ordered = [
			current,
			...seasons
				.filter((s) => s.id !== current.id)
				.sort((a, b) => Number(b.id) - Number(a.id)),
		]
		for (const season of ordered) {
			if ((this.seasonDueAt.get(season.id) ?? 0) > Date.now()) {
				continue
			}
			const walk = new SeasonWalk(season.id === current.id)
			const start = Date.now()
			this.noted.delete(season.id)
			yield* this.walkSeason(walk, season)
			const noted = this.noted.get(season.id) ?? Infinity
			const dueAt = Math.min(walk.dueAt, noted)
			this.seasonDueAt.set(season.id, dueAt)
			logger.info("walkDueSeasons", "walked season", {
				seasonId: season.id,
				ms: Date.now() - start,
				nextDueAt: Number.isFinite(dueAt)
					? new Date(dueAt).toISOString()
					: null,
			})
		}
	}

	/** Yields after each team */
	private async *walkSeason(
		walk: SeasonWalk,
		season: KHLSeason,
	): AsyncGenerator<void> {
		const teamsPage: SyncPage = {kind: "teams", seasonId: season.id}
		const fetch = this.isDue(walk, teamsPage, null)
		const teamIds = await this.attempt(walk, teamsPage, () =>
			this.source.syncTeams(season.id, fetch),
		)
		if (!teamIds) {
			return
		}
		let rosterChanged = false
		for (const teamId of teamIds) {
			if (await this.walkTeam(walk, teamId, season.id)) {
				rosterChanged = true
			}
			yield
		}
		if (rosterChanged || !this.source.hasPlayerList(season.id)) {
			try {
				await this.source.buildPlayerList(season, walk.isCurrentSeason)
			} catch (error) {
				logger.error("walkSeason", "couldn't build the player list", {
					seasonId: season.id,
					error,
				})
			}
		}
	}

	/**
	 * Walks current-season teams with a game that finished recently, at most
	 * every 5 minutes, from the schedules last recorded. Their pages' due
	 * rules decide what's fetched, so a team already refreshed fetches
	 * nothing. When it next has something due counts toward the current
	 * season's due time.
	 */
	private async checkFinishedGames() {
		const now = Date.now()
		const seasonId = this.currentSeasonId
		if (!seasonId || now - this.lastGameCheckAt < CHECK_INTERVAL_MS) {
			return
		}
		this.lastGameCheckAt = now
		const walk = new SeasonWalk(true)
		for (const [teamId, games] of this.source.getSeasonSchedules(
			seasonId,
		)) {
			const settleAt = getLatestSettleAt(games)
			if (settleAt !== null && settleAt > now - GAME_SETTLE_LIMIT_MS) {
				await this.walkTeam(walk, teamId, seasonId)
			}
		}
		this.noteDue(seasonId, walk.dueAt)
	}

	/** Brings a season's due time forward, surviving a walk in progress */
	private noteDue(seasonId: string, at: number) {
		const min = (prev: number | undefined) => Math.min(prev ?? Infinity, at)
		this.seasonDueAt.set(seasonId, min(this.seasonDueAt.get(seasonId)))
		this.noted.set(seasonId, min(this.noted.get(seasonId)))
	}

	/**
	 * Walks a team: its schedule, then its finished games, then its stats
	 * and players, whose pages are due after games complete. Returns whether
	 * its roster was recorded again.
	 */
	private async walkTeam(
		walk: SeasonWalk,
		teamId: string,
		seasonId: string,
	): Promise<boolean> {
		// The recorded schedule says which games have ended since the page
		// was fetched
		const schedulePage: SyncPage = {kind: "schedule", teamId, seasonId}
		const ended = getLatestSettleAt(
			this.source.getSchedule(teamId, seasonId),
		)
		await this.sync(walk, schedulePage, ended, (fetch) =>
			this.source.syncSchedule(teamId, seasonId, fetch),
		)
		const schedule = this.source.getSchedule(teamId, seasonId)
		// The team's pages are next due when its next game settles
		const now = Date.now()
		for (const game of schedule) {
			const settleAt = getSettleAt(game)
			if (settleAt > now) {
				walk.dueBy(settleAt)
			}
		}

		for (const game of schedule) {
			if (game.gameId && game.isFinal) {
				await this.walkGame(walk, game.gameId, game.startsAt)
			}
		}

		const completedAt = this.source.getTeamLatestCompletedGame(
			teamId,
			seasonId,
		)
		const statsPage: SyncPage = {kind: "team-stats", teamId, seasonId}
		const rosterRecorded = await this.sync(
			walk,
			statsPage,
			completedAt,
			(fetch) => this.source.syncTeamStats(teamId, seasonId, fetch),
		)

		const keys = this.source.getTeamRegistrationKeys(teamId, seasonId)
		const completions = this.source.getLatestCompletedGames(keys)
		for (const registrationKey of keys) {
			const page: SyncPage = {kind: "player", registrationKey, seasonId}
			if (
				this.isDue(walk, page, completions.get(registrationKey) ?? null)
			) {
				await this.attempt(walk, page, () =>
					this.source.fetchPlayer(registrationKey, seasonId),
				)
			}
		}
		return rosterRecorded
	}

	/**
	 * A finished game's pages are due once it should have settled, if they
	 * were fetched before then, and again now and then until it's complete
	 */
	private async walkGame(walk: SeasonWalk, gameId: string, startsAt: string) {
		const now = Date.now()
		const settleAt = getSettleAt({startsAt})
		if (settleAt > now) {
			walk.dueBy(settleAt)
			return
		}
		const page: SyncPage = {kind: "game", gameId}
		const fetchedAt = this.source.getFetchedAt(page)
		const status = this.source.getGameStatus(gameId)
		let isDue = fetchedAt === null || fetchedAt < settleAt
		if (fetchedAt !== null && status) {
			const recheckAt = getGameRecheckAt({
				startsAt,
				isComplete: status.isComplete,
				lastLookedAt: fetchedAt,
			})
			if (recheckAt !== null) {
				isDue ||= recheckAt <= now
				walk.dueBy(recheckAt)
			}
		}
		if (isDue) {
			await this.attempt(walk, page, () =>
				this.source.syncGame(gameId, true),
			)
		} else if (this.source.needsProcessing(page)) {
			// Stored, but never saved, or saved from a different copy
			await this.attempt(walk, page, () =>
				this.source.syncGame(gameId, false),
			)
		}
	}

	/**
	 * Fetches the page if it's due, or else processes the stored copy if its
	 * derived rows are missing or out of date. Returns whether either ran.
	 */
	private async sync(
		walk: SeasonWalk,
		page: SyncPage,
		changedAt: number | null,
		sync: (fetch: boolean) => Promise<void>,
	): Promise<boolean> {
		const fetch = this.isDue(walk, page, changedAt)
		if (!fetch && !this.source.needsProcessing(page)) {
			return false
		}
		return (await this.attempt(walk, page, () => sync(fetch))) !== null
	}

	/** Runs `work`, unless the page is waiting to be retried after a failure */
	private async attempt<T>(
		walk: SeasonWalk,
		page: SyncPage,
		work: () => Promise<T>,
	): Promise<T | null> {
		const key = JSON.stringify(page)
		const retryAt = this.retryAt.get(key) ?? 0
		if (retryAt > Date.now()) {
			walk.dueBy(retryAt)
			return null
		}
		try {
			const result = await work()
			this.retryAt.delete(key)
			// Fetched just now, or earlier: either way it's next due then
			const fetchedAt = this.source.getFetchedAt(page)
			if (fetchedAt !== null) {
				walk.dueBy(
					fetchedAt +
						getSeasonPolicy(PAGE_REFRESH_MS, walk.isCurrentSeason),
				)
			}
			return result
		} catch (error) {
			// A failed fetch may work soon; a page that didn't parse won't
			// until it changes, so it waits for its next refresh
			const retryMs =
				error instanceof FetchError ? PAGE_RETRY_MS : PAGE_REFRESH_MS
			const nextAt =
				Date.now() + getSeasonPolicy(retryMs, walk.isCurrentSeason)
			this.retryAt.set(key, nextAt)
			walk.dueBy(nextAt)
			logger.warn("attempt", "couldn't sync page", {page, error})
			return null
		}
	}

	/**
	 * Never fetched, past its season's refresh interval, or fetched before
	 * `changedAt`, when something that changes it happened. Otherwise notes
	 * when it will be due.
	 */
	private isDue(
		walk: SeasonWalk,
		page: SyncPage,
		changedAt: number | null,
	): boolean {
		const fetchedAt = this.source.getFetchedAt(page)
		if (fetchedAt === null) {
			return true
		}
		const now = Date.now()
		if (changedAt !== null && changedAt <= now && fetchedAt < changedAt) {
			return true
		}
		const refreshAt =
			fetchedAt + getSeasonPolicy(PAGE_REFRESH_MS, walk.isCurrentSeason)
		if (refreshAt <= now) {
			return true
		}
		walk.dueBy(refreshAt)
		return false
	}
}

/** One walk of a season: whether it's current, and when it's next due */
class SeasonWalk {
	dueAt = Infinity

	constructor(readonly isCurrentSeason: boolean) {}

	dueBy(at: number) {
		this.dueAt = Math.min(this.dueAt, at)
	}
}

function getSeasonPolicy(
	policy: {current: number; past: number},
	isCurrentSeason: boolean,
): number {
	return isCurrentSeason ? policy.current : policy.past
}

/** The latest settle time among games that have settled; null if none */
function getLatestSettleAt(games: ScheduleGame[]): number | null {
	const now = Date.now()
	const settled = games.map(getSettleAt).filter((at) => at <= now)
	return settled.length > 0 ? Math.max(...settled) : null
}
