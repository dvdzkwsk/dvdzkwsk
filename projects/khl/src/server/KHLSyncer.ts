import {Logger} from "@dvdzkwsk/logger"
import {sleep} from "@dvdzkwsk/util/AsyncUtil"
import {matchValue} from "@dvdzkwsk/util/MatchUtil"
import {
	GAME_RECHECK_MS,
	GAME_SETTLE_LIMIT_MS,
	GAME_SETTLE_MS,
} from "./GameRecords.js"
import {runInKHLBackground} from "./KHL.js"
import {PageLoad, withPageLoadLog} from "./PageStore.js"
import {RegistrationKey} from "../shared/ApiJson.js"
import {KHLSeason} from "../shared/KHLJson.js"
import {
	DAY_MS,
	getGameEndsAt,
	HOUR_MS,
	MINUTE_MS,
} from "../shared/LeagueTime.js"

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
 * How often to look for current-season games that just finished, between
 * the teams of a walk, and how long to wait when nothing is due
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
	/** The box score, which the game's stats page is fetched with */
	| {kind: "game"; gameId: string}

/** A schedule's game, as much of it as the syncer needs */
export interface SyncGame {
	/** Null for a game the league never linked */
	gameId: string | null
	startsAt: string
	isFinal: boolean
}

/**
 * Reads and stores KHL pages for the syncer, and records what's derived from
 * them. A `read*` with `fetch` false reads the stored page, fetching it only
 * if there isn't one.
 */
export interface KHLSyncerSource {
	/** The league's current season and every season it lists */
	getSeasons: () => Promise<{current: KHLSeason; seasons: KHLSeason[]}>
	/** When the page was last fetched; null if never */
	getFetchedAt: (page: SyncPage) => number | null
	/** The season's team ids; records the teams */
	readTeams: (seasonId: string, fetch: boolean) => Promise<string[]>
	readSchedule: (
		teamId: string,
		seasonId: string,
		fetch: boolean,
	) => Promise<SyncGame[]>
	/** Fetches the page, and records the roster's registrations */
	fetchTeamStats: (teamId: string, seasonId: string) => Promise<void>
	fetchPlayer: (
		registrationKey: RegistrationKey,
		seasonId: string,
	) => Promise<void>
	/** Saves the game to the games tables from its box score and stats */
	readGame: (gameId: string, fetch: boolean) => Promise<void>
	/** Null if the game isn't in the games tables */
	getGameStatus: (gameId: string) => {isComplete: boolean} | null
	/** The players registered on the team that season */
	getTeamRegistrationKeys: (
		teamId: string,
		seasonId: string,
	) => RegistrationKey[]
	/** Each player's latest game they dressed for, by start time */
	getLatestDressedGameStarts: (
		registrationKeys: RegistrationKey[],
	) => Map<RegistrationKey, string>
	/** Builds the season's player list from its stored team stats pages */
	buildPlayerList: (
		season: KHLSeason,
		isCurrentSeason: boolean,
	) => Promise<void>
	hasPlayerList: (seasonId: string) => boolean
}

/**
 * Keeps a copy of every KHL page behind the site's player pages: every
 * season's teams, each team's schedule and stats, each rostered player's
 * page, and each finished game's box score and lineups. It walks the current
 * season first, then the rest newest first, fetching only the pages that
 * are due, so a restart walks again and skips what's fresh. Fetches share
 * the KHL's background rate limit, so visitors don't wait on them.
 *
 * A page is due when it was never fetched, when its season's refresh
 * interval has passed, or when a game that changes it has finished since:
 * a team's schedule and stats after each of its games, a player's page after
 * each game they dressed for, and a game's own pages until its summary and
 * lineups are posted.
 */
export class KHLSyncer {
	/** When each page whose fetch failed may be tried again */
	private retryAt = new Map<string, number>()
	/** When each walked season next has a page due, so others are skipped */
	private seasonDueAt = new Map<string, number>()
	/** The current season's schedules as of the last walk, by team */
	private currentSchedules = new Map<string, SyncGame[]>()
	private currentSeasonId: string | null = null
	private lastGameCheckAt = 0

	constructor(private source: KHLSyncerSource) {}

	start() {
		void this.run()
	}

	/**
	 * Walks every season that has a page due, a team at a time. Between
	 * teams, it checks for current-season games that just finished, so their
	 * refreshes never wait for a long walk. Returns how many pages it fetched.
	 */
	syncOnce(): Promise<number> {
		const log: PageLoad[] = []
		return runInKHLBackground(() =>
			withPageLoadLog(log, async () => {
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
			yield* this.walkSeason(walk, season)
			this.seasonDueAt.set(season.id, walk.dueAt)
		}
	}

	/** Yields after each team */
	private async *walkSeason(
		walk: SeasonWalk,
		season: KHLSeason,
	): AsyncGenerator<void> {
		const teamsPage: SyncPage = {kind: "teams", seasonId: season.id}
		const teamIds = await this.attempt(walk, teamsPage, () =>
			this.source.readTeams(season.id, this.isDue(walk, teamsPage, null)),
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
	 * every 5 minutes. Their pages' due rules decide what's fetched, so a
	 * team already refreshed fetches nothing.
	 */
	private async checkFinishedGames() {
		const now = Date.now()
		if (
			!this.currentSeasonId ||
			now - this.lastGameCheckAt < CHECK_INTERVAL_MS
		) {
			return
		}
		this.lastGameCheckAt = now
		const walk = new SeasonWalk(true)
		for (const [teamId, games] of this.currentSchedules) {
			const settleAt = getLatestSettleAt(games)
			if (settleAt !== null && settleAt > now - GAME_SETTLE_LIMIT_MS) {
				await this.walkTeam(walk, teamId, this.currentSeasonId)
			}
		}
	}

	/** Returns whether the team's stats, and so its roster, were fetched */
	private async walkTeam(
		walk: SeasonWalk,
		teamId: string,
		seasonId: string,
	): Promise<boolean> {
		// The stored schedule says which games have finished since its fetch,
		// and so whether it, the stats, and the roster need fetching again
		const schedulePage: SyncPage = {kind: "schedule", teamId, seasonId}
		const stored = await this.attempt(walk, schedulePage, () =>
			this.source.readSchedule(teamId, seasonId, false),
		)
		if (!stored) {
			return false
		}
		const changedAt = getLatestSettleAt(stored)
		const schedule = this.isDue(walk, schedulePage, changedAt)
			? ((await this.attempt(walk, schedulePage, () =>
					this.source.readSchedule(teamId, seasonId, true),
				)) ?? stored)
			: stored
		if (walk.isCurrentSeason) {
			this.currentSchedules.set(teamId, schedule)
		}
		// The team's pages are next due when its next game settles
		const now = Date.now()
		for (const game of schedule) {
			const settleAt = getSettleAt(game)
			if (settleAt > now) {
				walk.dueBy(settleAt)
			}
		}

		const statsPage: SyncPage = {kind: "team-stats", teamId, seasonId}
		const statsFetched =
			this.isDue(walk, statsPage, changedAt) &&
			(await this.attempt(walk, statsPage, () =>
				this.source.fetchTeamStats(teamId, seasonId),
			)) !== null

		// Before the players, whose pages are due after a game they dressed
		// for, which is known once the game's lineups are saved
		for (const game of schedule) {
			if (game.gameId && game.isFinal) {
				await this.walkGame(walk, game.gameId, game.startsAt)
			}
		}

		const registrationKeys = this.source.getTeamRegistrationKeys(
			teamId,
			seasonId,
		)
		const latestGames =
			this.source.getLatestDressedGameStarts(registrationKeys)
		for (const registrationKey of registrationKeys) {
			const latest = latestGames.get(registrationKey)
			const page: SyncPage = {kind: "player", registrationKey, seasonId}
			const changed = latest ? getSettleAt({startsAt: latest}) : null
			if (this.isDue(walk, page, changed)) {
				await this.attempt(walk, page, () =>
					this.source.fetchPlayer(registrationKey, seasonId),
				)
			}
		}

		return statsFetched
	}

	/**
	 * A finished game's pages are due once it should have settled, if they
	 * were fetched before then, and again now and then until its summary and
	 * lineups are posted
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
		const isSettling =
			!!status &&
			!status.isComplete &&
			now - Date.parse(startsAt) < GAME_SETTLE_LIMIT_MS
		if (fetchedAt !== null && isSettling) {
			const recheckAt = fetchedAt + GAME_RECHECK_MS
			isDue ||= recheckAt <= now
			walk.dueBy(recheckAt)
		}
		if (isDue || !status) {
			// Not due but not saved yet: save it from the stored pages
			await this.attempt(walk, page, () =>
				this.source.readGame(gameId, isDue),
			)
		}
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
			return result
		} catch (error) {
			const nextAt =
				Date.now() +
				getSeasonPolicy(PAGE_RETRY_MS, walk.isCurrentSeason)
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

/** When a game's pages should be final: a while after its scheduled end */
function getSettleAt(game: {startsAt: string}): number {
	return getGameEndsAt(game).getTime() + GAME_SETTLE_MS
}

/** The latest settle time among games that have settled; null if none */
function getLatestSettleAt(games: SyncGame[]): number | null {
	const now = Date.now()
	const settled = games.map(getSettleAt).filter((at) => at <= now)
	return settled.length > 0 ? Math.max(...settled) : null
}
