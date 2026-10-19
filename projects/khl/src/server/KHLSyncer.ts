import {Logger} from "@dvdzkwsk/logger"
import {sleep} from "@dvdzkwsk/util/AsyncUtil"
import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import {matchField, matchValue} from "@dvdzkwsk/util/MatchUtil"
import {KHLDatabase} from "./Database.js"
import {
	getGameRecheckAt,
	getSettleAt,
	isGameRecordComplete,
} from "./GameRecords.js"
import {
	getKHLBoxScore,
	getKHLGameStats,
	getKHLPlayer,
	getKHLTeamSchedule,
	getKHLTeamsPage,
	getKHLTeamStats,
	runInKHLBackground,
} from "./KHL.js"
import {withPageReadPolicy} from "./PageStore.js"
import {getSyncPageUrl, SyncPage} from "./SyncPages.js"
import {RegistrationKey, toRegistrationKey} from "../shared/ApiJson.js"
import {
	KHLBoxScore,
	KHLGame,
	KHLGameStats,
	KHLPlayer,
	KHLPlayerSearchResult,
	KHLTeamsPage,
	KHLTeamStats,
} from "../shared/KHLJson.js"
import {DAY_MS, HOUR_MS, MINUTE_MS} from "../shared/LeagueTime.js"

const logger = new Logger("KHLSyncer")

/**
 * Bump when processing changes what it derives from a page, so every stored
 * page is processed again (from storage, without fetching)
 */
export const PROCESSING_VERSION = 1

/**
 * How long until each kind of page is fetched again, besides what a game
 * triggers: a schedule is also due when each of its games settles, and a
 * team's stats and its players' pages when a game of theirs completes
 */
const REFRESH_MS = {
	teams: {current: DAY_MS, past: 30 * DAY_MS},
	schedule: {current: 6 * HOUR_MS, past: 30 * DAY_MS},
	"team-stats": {current: DAY_MS, past: 30 * DAY_MS},
	player: {current: DAY_MS, past: 30 * DAY_MS},
	// Once complete; corrections after that are rare
	game: {current: 30 * DAY_MS, past: 30 * DAY_MS},
}
/** How long a page whose fetch failed waits before it's tried again */
const RETRY_MS = {current: 30 * MINUTE_MS, past: DAY_MS}
/** The longest the loop sleeps when nothing is due */
const MAX_IDLE_MS = 5 * MINUTE_MS

/**
 * Reads a page for the syncer, parsed: fetched if `fetch`, or else the
 * stored copy, which is fetched only if there isn't one
 */
export interface KHLSyncerPages {
	teams: (seasonId: string | null, fetch: boolean) => Promise<KHLTeamsPage>
	schedule: (
		teamId: string,
		seasonId: string,
		fetch: boolean,
	) => Promise<KHLGame[]>
	teamStats: (
		teamId: string,
		seasonId: string,
		fetch: boolean,
	) => Promise<KHLTeamStats>
	player: (
		key: RegistrationKey,
		seasonId: string,
		fetch: boolean,
	) => Promise<KHLPlayer>
	boxScore: (gameId: string, fetch: boolean) => Promise<KHLBoxScore>
	gameStats: (gameId: string, fetch: boolean) => Promise<KHLGameStats>
}

/** The KHL's pages, through the page store */
export const KHL_PAGES: KHLSyncerPages = {
	teams: (seasonId, fetch) =>
		readForSync(fetch, () => getKHLTeamsPage(seasonId ?? undefined)),
	schedule: (teamId, seasonId, fetch) =>
		readForSync(fetch, () => getKHLTeamSchedule(teamId, seasonId)),
	teamStats: (teamId, seasonId, fetch) =>
		readForSync(fetch, () => getKHLTeamStats(teamId, seasonId)),
	player: (key, seasonId, fetch) =>
		readForSync(fetch, () => getKHLPlayer(key, seasonId)),
	boxScore: (gameId, fetch) =>
		readForSync(fetch, () => getKHLBoxScore(gameId)),
	gameStats: (gameId, fetch) =>
		readForSync(fetch, () => getKHLGameStats(gameId)),
}

/**
 * Fetched if `fetch`, or else the stored copy, which is fetched only if
 * there isn't one. No stale fallback, so a failed fetch fails, and is
 * retried, instead of passing for a fresh one.
 */
function readForSync<T>(fetch: boolean, load: () => Promise<T>): Promise<T> {
	return withPageReadPolicy(
		{maxAgeMs: fetch ? 0 : Infinity, allowStale: false},
		load,
	)
}

/**
 * Keeps the league's tables in sync with the KHL. Every page it keeps is a
 * row in the fetch queue with when it's next due; the loop takes the most
 * urgent due page, fetches it, processes it into tables, and schedules it
 * and whatever follows from it:
 *
 * - The default teams page queues every season's teams page.
 * - A teams page queues each team's schedule and stats.
 * - A schedule queues each game for when it should have settled, and is
 *   due again when its next game settles.
 * - A team's stats queue each rostered player's page (as of their latest
 *   season).
 * - A game is looked at again until it's complete (its summary and lineups
 *   are posted), and completing makes its teams' stats and the pages of
 *   the players who dressed due right away.
 *
 * The current season comes first, then past seasons newest first. Visitors
 * go through `ensureSynced`, which syncs a page that never was, so every
 * stored page is processed whoever fetched it, and the tables always match
 * what's stored.
 */
export class KHLSyncer {
	/** Syncs in flight, so concurrent syncs of one page share one */
	private syncing = new Map<string, Promise<void>>()

	constructor(
		private db: KHLDatabase,
		private pages: KHLSyncerPages = KHL_PAGES,
	) {}

	start() {
		this.seed()
		void this.run()
	}

	/** Queues the league's default teams page, which everything follows from */
	seed() {
		this.enqueue({kind: "teams", seasonId: null}, 0)
	}

	/**
	 * Syncs the next page: first any whose rows an older version of the
	 * processing built (from storage), then the most urgent due one. Returns
	 * false if there was nothing to do.
	 */
	syncNext(): Promise<boolean> {
		return runInKHLBackground(async () => {
			const outdated = this.db.league.takeOutdated(PROCESSING_VERSION)
			const due = outdated ?? this.db.league.takeDue(Date.now())
			if (!due) {
				return false
			}
			// Failures are recorded on the page and retried; nothing to do here
			await this.sync(due.page, !outdated).catch(() => {})
			return true
		})
	}

	/**
	 * Makes sure a page has been synced, syncing it now if it never has
	 * (from the stored copy, fetched if there isn't one). Visitors call this
	 * before reading a page's tables. Returns false, without trying again,
	 * for a page that's never been synced and is waiting to be retried after
	 * a failure, so visitors don't refetch a page that's failing.
	 */
	async ensureSynced(page: SyncPage): Promise<boolean> {
		const state = this.db.league.getSyncState(
			getSyncPageUrl(page),
			Date.now(),
		)
		return matchValue(state, {
			synced: async () => true,
			waiting: async () => false,
			unsynced: async () => {
				await this.sync(page, false)
				return true
			},
		})()
	}

	/**
	 * Reads a page (fetched if `fetch`), processes it into tables, and
	 * schedules it and what follows from it. A failure is recorded on the
	 * page and rethrown: a failed fetch is retried in 30 minutes (a day for
	 * past seasons), and a page that didn't parse at its next refresh.
	 */
	sync(page: SyncPage, fetch: boolean): Promise<void> {
		const url = getSyncPageUrl(page)
		const inFlight = this.syncing.get(url)
		if (inFlight) {
			return inFlight
		}
		const run = this.syncPage(page, url, fetch).finally(() => {
			this.syncing.delete(url)
		})
		this.syncing.set(url, run)
		return run
	}

	private async run() {
		for (;;) {
			try {
				if (!(await this.syncNext())) {
					const nextAt = this.db.league.getNextDueAt() ?? Infinity
					await sleep(
						Math.min(
							Math.max(nextAt - Date.now(), 1000),
							MAX_IDLE_MS,
						),
					)
				}
			} catch (error) {
				// Pages' failures are handled where they're synced, so this
				// is a bug; wait rather than spin
				logger.error("run", "sync failed", {error})
				await sleep(MAX_IDLE_MS)
			}
		}
	}

	private async syncPage(page: SyncPage, url: string, fetch: boolean) {
		const isCurrent = this.isCurrentSeason(getPageSeasonId(page))
		this.enqueue(page, 0)
		try {
			const nextAt = await this.process(page, fetch)
			this.db.league.markSynced(url, {
				nextAt,
				version: PROCESSING_VERSION,
				now: Date.now(),
			})
		} catch (error) {
			// A failed fetch may work soon; a page that didn't parse won't
			// until it changes, so it waits for its next refresh
			const waitMs =
				error instanceof FetchError
					? getSeasonPolicy(RETRY_MS, isCurrent)
					: getSeasonPolicy(REFRESH_MS[page.kind], isCurrent)
			this.db.league.markFailed(url, {
				nextAt: Date.now() + waitMs,
				error: error instanceof Error ? error.message : String(error),
			})
			logger.warn("syncPage", "couldn't sync page", {page, error})
			throw error
		}
	}

	/** Processes a page into tables; returns when it's next due */
	private process(page: SyncPage, fetch: boolean): Promise<number> {
		return matchField(page, "kind", {
			teams: (p) => this.processTeams(p.seasonId, fetch),
			schedule: (p) => this.processSchedule(p.teamId, p.seasonId, fetch),
			"team-stats": (p) =>
				this.processTeamStats(p.teamId, p.seasonId, fetch),
			player: (p) =>
				this.processPlayer(p.registrationKey, p.seasonId, fetch),
			game: (p) => this.processGame(p.gameId, fetch),
		})
	}

	private async processTeams(
		seasonId: string | null,
		fetch: boolean,
	): Promise<number> {
		const page = await this.pages.teams(seasonId, fetch)
		const isDefault = seasonId === null
		this.db.league.saveTeamsPage(page, isDefault)
		if (isDefault) {
			this.db.league.setCurrentSeason(page.season.id)
			for (const season of page.seasons) {
				this.enqueue({kind: "teams", seasonId: season.id}, 0)
			}
		}
		for (const team of page.teams) {
			const ids = {teamId: team.id, seasonId: team.seasonId}
			this.enqueue({kind: "schedule", ...ids}, 0)
			this.enqueue({kind: "team-stats", ...ids}, 0)
		}
		return this.refreshAt("teams", page.season.id)
	}

	private async processSchedule(
		teamId: string,
		seasonId: string,
		fetch: boolean,
	): Promise<number> {
		const games = await this.pages.schedule(teamId, seasonId, fetch)
		this.db.league.saveSchedule(teamId, seasonId, games)
		const now = Date.now()
		let nextAt = this.refreshAt("schedule", seasonId)
		for (const game of games) {
			const settleAt = getSettleAt(game)
			if (settleAt > now) {
				// Due again once each game settles, to see it marked final
				nextAt = Math.min(nextAt, settleAt)
			}
			if (game.id) {
				this.enqueue(
					{kind: "game", gameId: game.id},
					game.isFinal ? 0 : settleAt,
					seasonId,
				)
			}
		}
		return nextAt
	}

	private async processTeamStats(
		teamId: string,
		seasonId: string,
		fetch: boolean,
	): Promise<number> {
		const stats = await this.pages.teamStats(teamId, seasonId, fetch)
		this.db.league.saveTeamStats(stats)
		const team = this.db.league.getTeam(teamId, seasonId)
		const goalieIds = new Set(stats.goalies.map((g) => g.playerId))
		this.db.recordRegistrations(
			[...stats.skaters, ...stats.goalies].map((row) => ({
				playerId: row.playerId,
				name: row.name,
				position: goalieIds.has(row.playerId) ? "Goalie" : "Skater",
				teamId,
				teamName: team?.name ?? teamId,
				teamLogoUrl: team?.logoUrl ?? null,
				seasonId,
			})),
			"roster",
		)
		// A registration's page is read as of its latest season
		for (const khlPlayerId of this.db.getTeamSeasonLatestPlayerIds(
			teamId,
			seasonId,
		)) {
			const registrationKey = toRegistrationKey({khlPlayerId, teamId})
			this.enqueue({kind: "player", registrationKey, seasonId}, 0)
		}
		return this.refreshAt("team-stats", seasonId)
	}

	private async processPlayer(
		key: RegistrationKey,
		seasonId: string,
		fetch: boolean,
	): Promise<number> {
		const player = await this.pages.player(key, seasonId, fetch)
		this.db.league.savePlayerProfile(player)
		return this.refreshAt("player", seasonId)
	}

	private async processGame(gameId: string, fetch: boolean): Promise<number> {
		const boxScore = await this.pages.boxScore(gameId, fetch)
		const stats = await this.pages
			.gameStats(gameId, fetch)
			.catch((error: unknown) => {
				// The lineups are left unposted, and the game looked at again
				logger.warn("processGame", "game stats unavailable", {
					gameId,
					error,
				})
				return null
			})
		// Everyone the game names, so its events and lineups read with names
		this.db.recordRegistrations(
			getGamePlayers(boxScore, stats),
			"box-score",
		)
		const now = Date.now()
		const {completedSinceLastSave} = this.db.league.saveGame(
			boxScore,
			stats,
			now,
		)
		const saved = this.db.league.getGames([gameId]).get(gameId)
		if (saved && isGameRecordComplete(saved)) {
			// Its teams' stats and its players' pages change once it's
			// posted. Saved incomplete before, it was posted since; if not,
			// it's taken as posted by the time it settled, so a page synced
			// since (e.g. earlier in the same first sync) isn't fetched again.
			const postedBy = completedSinceLastSave
				? now
				: getSettleAt(boxScore)
			for (const team of [boxScore.away, boxScore.home]) {
				this.enqueue(
					{
						kind: "team-stats",
						teamId: team.id,
						seasonId: team.seasonId,
					},
					now,
					team.seasonId,
					postedBy,
				)
			}
			for (const {teamId, khlPlayerId} of this.db.league.getLineupKeys(
				gameId,
			)) {
				const team = [boxScore.away, boxScore.home].find(
					(t) => t.id === teamId,
				)!
				const registrationKey = toRegistrationKey({khlPlayerId, teamId})
				this.enqueue(
					{kind: "player", registrationKey, seasonId: team.seasonId},
					now,
					team.seasonId,
					postedBy,
				)
			}
		}
		const recheckAt = getGameRecheckAt({
			startsAt: boxScore.startsAt,
			isComplete: !!saved && isGameRecordComplete(saved),
			lastLookedAt: now,
		})
		return recheckAt ?? now + REFRESH_MS.game.current
	}

	/**
	 * Queues a page if it isn't. With `ifSyncedBefore`, a queued page last
	 * synced before then is brought forward to `nextAt`. Pages are ranked by
	 * how many seasons before the current one they are; teams pages first,
	 * since every season's teams come from them.
	 */
	private enqueue(
		page: SyncPage,
		nextAt: number,
		seasonId: string | null = getPageSeasonId(page),
		ifSyncedBefore?: number,
	) {
		const queuedSeasonId = page.kind === "teams" ? null : seasonId
		this.db.league.enqueue(
			getSyncPageUrl(page),
			page,
			{
				seasonId: queuedSeasonId,
				priority: this.getPriority(queuedSeasonId),
				nextAt,
			},
			ifSyncedBefore,
		)
	}

	private getPriority(seasonId: string | null): number {
		const current = this.db.league.getCurrentSeasonId()
		if (seasonId === null || current === null) {
			return 0
		}
		return Math.max(0, Number(current) - Number(seasonId))
	}

	private isCurrentSeason(seasonId: string | null): boolean {
		return (
			seasonId === null ||
			seasonId === this.db.league.getCurrentSeasonId()
		)
	}

	private refreshAt(kind: keyof typeof REFRESH_MS, seasonId: string): number {
		return (
			Date.now() +
			getSeasonPolicy(REFRESH_MS[kind], this.isCurrentSeason(seasonId))
		)
	}
}

/** The season a page belongs to, if it says; a game's comes from its schedule */
function getPageSeasonId(page: SyncPage): string | null {
	return matchField(page, "kind", {
		teams: (p) => p.seasonId,
		schedule: (p) => p.seasonId,
		"team-stats": (p) => p.seasonId,
		player: (p) => p.seasonId,
		game: () => null,
	})
}

function getSeasonPolicy(
	policy: {current: number; past: number},
	isCurrentSeason: boolean,
): number {
	return isCurrentSeason ? policy.current : policy.past
}

/** Everyone a game names: in its goals and penalties, and in its lineups */
function getGamePlayers(
	boxScore: KHLBoxScore,
	stats: KHLGameStats | null,
): KHLPlayerSearchResult[] {
	const teams = new Map(
		[boxScore.away, boxScore.home].map((team) => [team.id, team]),
	)
	const named = [
		...boxScore.goals.flatMap((g) =>
			[g.scorer, ...g.assists].map((player) => ({
				player,
				teamId: g.teamId,
			})),
		),
		...boxScore.penalties.flatMap((p) =>
			p.player ? [{player: p.player, teamId: p.teamId}] : [],
		),
		...(["away", "home"] as const).flatMap((side) => {
			const lineup = stats?.[side]
			const teamId = boxScore[side].id
			return [...(lineup?.skaters ?? []), ...(lineup?.goalies ?? [])].map(
				(row) => ({player: {id: row.playerId, name: row.name}, teamId}),
			)
		}),
	]
	return named.flatMap(({player, teamId}) => {
		const team = teams.get(teamId)
		if (!team) {
			return []
		}
		return [
			{
				playerId: player.id,
				name: player.name,
				position: null,
				teamId: team.id,
				teamName: team.name,
				teamLogoUrl: team.logoUrl,
				seasonId: team.seasonId,
			},
		]
	})
}
