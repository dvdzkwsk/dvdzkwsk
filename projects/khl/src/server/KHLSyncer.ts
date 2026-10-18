import {Logger} from "@dvdzkwsk/logger"
import {sleep} from "@dvdzkwsk/util/AsyncUtil"
import {AppCache} from "./AppCache.js"
import {runInKHLBackground} from "./KHL.js"
import {PlayersResponse, PlayersResponseSchema} from "../shared/ApiJson.js"
import {KHLSeason} from "../shared/KHLJson.js"
import {DAY_MS, HOUR_MS, MINUTE_MS} from "../shared/LeagueTime.js"

const logger = new Logger("KHLSyncer")

/**
 * How long until a season's player list is built again, and when to try
 * again after a failed sync. Readers keep getting the last list meanwhile.
 */
const SYNC_POLICY = {
	// Changes only as players register or play
	current: {
		refreshMs: 6 * HOUR_MS,
		partialRefreshMs: 30 * MINUTE_MS,
		retryMs: 30 * MINUTE_MS,
	},
	// Over, so it changes only if the league edits it. Lists missing teams
	// wait longer than the current season's, since old pages often fail for good.
	past: {refreshMs: 7 * DAY_MS, partialRefreshMs: DAY_MS, retryMs: DAY_MS},
}
/** How often to look for a season that's due */
const CHECK_INTERVAL_MS = 5 * MINUTE_MS

export function getPlayersCacheKey(seasonId: string): string {
	return `players:${seasonId}`
}

export interface KHLSyncerSource {
	/** The league's current season and every season it lists */
	getSeasons: () => Promise<{current: KHLSeason; seasons: KHLSeason[]}>
	/** A season's player list, built from every team's stats page */
	loadPlayers: (
		season: KHLSeason,
		isCurrentSeason: boolean,
	) => Promise<PlayersResponse>
}

/**
 * Keeps every season's player list in the app cache (getPlayersCacheKey),
 * so serving one never fetches from the KHL. Each list reads every team's stats page
 * (~175 of them), so the syncer builds one season at a time in the
 * background: the current season first, then the rest in the league's order.
 */
export class KHLSyncer {
	/** When each season whose sync failed may try again */
	private retryAt = new Map<string, number>()

	constructor(
		private appCache: AppCache,
		private source: KHLSyncerSource,
	) {}

	start() {
		void this.run()
	}

	/**
	 * Syncs the first season that's due; false if none is. Its KHL fetches
	 * share the background rate limit, so visitors' requests don't wait on it.
	 */
	syncNext(): Promise<boolean> {
		return runInKHLBackground(() => this.syncFirstDue())
	}

	private async syncFirstDue(): Promise<boolean> {
		let listed: {current: KHLSeason; seasons: KHLSeason[]}
		try {
			listed = await this.source.getSeasons()
		} catch (error) {
			logger.warn("syncNext", "couldn't list seasons, skipping a check", {
				error,
			})
			return false
		}
		const {current, seasons} = listed
		const season = [current, ...seasons].find((s) => this.isDue(s.id))
		if (!season) {
			return false
		}
		await this.syncSeason(season, season.id === current.id)
		return true
	}

	private async run() {
		for (;;) {
			if (!(await this.syncNext())) {
				await sleep(CHECK_INTERVAL_MS)
			}
		}
	}

	/** Never built, or stale, and not waiting out a failure */
	private isDue(seasonId: string): boolean {
		const now = Date.now()
		if ((this.retryAt.get(seasonId) ?? 0) > now) {
			return false
		}
		const players = this.appCache.get(
			getPlayersCacheKey(seasonId),
			PlayersResponseSchema,
		)
		return !players || now >= players.staleAt
	}

	private async syncSeason(season: KHLSeason, isCurrentSeason: boolean) {
		const policy = isCurrentSeason ? SYNC_POLICY.current : SYNC_POLICY.past
		const start = Date.now()
		try {
			const players = await this.source.loadPlayers(
				season,
				isCurrentSeason,
			)
			// Missing teams, so it's built again sooner
			const refreshMs =
				players.unavailableTeams.length > 0
					? policy.partialRefreshMs
					: policy.refreshMs
			this.appCache.set(
				getPlayersCacheKey(season.id),
				players,
				Date.now() + refreshMs,
			)
			this.retryAt.delete(season.id)
			logger.info("syncSeason", "synced players", {
				seasonId: season.id,
				teams: players.teams.length,
				unavailableTeams: players.unavailableTeams.length,
				ms: Date.now() - start,
			})
		} catch (error) {
			// The list built before, if any, is still served
			logger.error("syncSeason", "couldn't sync players", {
				seasonId: season.id,
				error,
			})
			this.retryAt.set(season.id, Date.now() + policy.retryMs)
		}
	}
}
