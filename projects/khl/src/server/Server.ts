import * as fs from "fs"
import * as path from "path"
import {ConsoleTransport, Logger, setLoggerTransports} from "@dvdzkwsk/logger"
import {ApiError, registerEndpoint} from "@dvdzkwsk/util/ApiServerUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import {matchFn, matchField, matchValue} from "@dvdzkwsk/util/MatchUtil"
import compression from "compression"
import express from "express"
import {AppCache} from "./AppCache.js"
import {
	ArenaMapping,
	getArenaName,
	KHL_ARENA_LIVEBARN_SURFACES,
	LiveBarnSurfaceMapping,
	toDisplayArena,
} from "./Arenas.js"
import {KHLCache} from "./Cache.js"
import {
	GameRecord,
	GameRecordTeam,
	GameRecordWithTeams,
	openDatabase,
	Player,
	Registration,
} from "./Database.js"
import {
	getGameRecheckAt,
	isGameRecordComplete,
	toGameRecords,
} from "./GameRecords.js"
import {
	compareRegistration,
	diffJson,
	reconcileRegistration,
	toIntegrityRecord,
} from "./Integrity.js"
import {
	getKHLArena,
	getKHLBoxScore,
	getKHLBoxScoreUrl,
	getKHLGamePreviewStats,
	getKHLGameStats,
	getKHLGameStatsUrl,
	getKHLLeagueSchedule,
	getKHLPlayer,
	getKHLPlayerSearchUrl,
	getKHLPlayerUrl,
	getKHLScoreboard,
	getKHLStandings,
	getKHLTeamSchedule,
	getKHLTeamsPage,
	getKHLTeamStats,
	KHL_ALL_SEASONS,
	searchKHLPlayers,
} from "./KHL.js"
import {
	getPlayersCacheKey,
	getSyncedPageMaxAgeMs,
	getSyncPageUrl,
	KHLSyncer,
	SyncPage,
} from "./KHLSyncer.js"
import {getLivebarnVenues} from "./LiveBarn.js"
import {
	getPageInfo,
	getPageLastFetchedAt,
	openPageStore,
	PageLoad,
	PageLoadSource,
	setPageStore,
	withPageLoadLog,
	withPageReadPolicy,
} from "./PageStore.js"
import {DEPLOY_INFO, getStatus, startStatusChecks} from "./Status.js"
import {
	ActivityAttendance,
	ActivityEvent,
	ActivityGame,
	ActivityKind,
	ActivityResponse,
	CacheCheckResponse,
	CHECK_CACHE_ENDPOINT,
	DEFAULT_ACTIVITY_KINDS,
	FeedGame,
	GameResponse,
	GamesResponse,
	GET_CACHE_ENTRY_ENDPOINT,
	GET_GAME_ENDPOINT,
	GET_MATCHUP_ENDPOINT,
	GET_PLAYER_ACTIVITY_ENDPOINT,
	GET_PLAYER_ENDPOINT,
	GET_PLAYER_INTEGRITY_ENDPOINT,
	GET_RINK_ENDPOINT,
	GET_STANDINGS_ENDPOINT,
	GET_STATUS_ENDPOINT,
	GET_TEAM_ACTIVITY_ENDPOINT,
	GET_TEAM_ENDPOINT,
	parseRegistrationKey,
	RegistrationKey,
	toRegistrationKey,
	HeadToHeadGame,
	IntegrityCacheEntry,
	IntegrityRegistration,
	IntegrityRegistrationCacheKeys,
	IntegrityUnlinked,
	JsonValue,
	JsonValueSchema,
	LIST_GAMES_ENDPOINT,
	LIST_PLAYERS_ENDPOINT,
	LIST_RINKS_ENDPOINT,
	LIST_TEAM_SEASONS_ENDPOINT,
	LIST_TEAMS_ENDPOINT,
	LiveBarnLink,
	LOG_ENDPOINT,
	MatchupResponse,
	MatchupTeam,
	PlayerIntegrityResponse,
	PlayerResponse,
	PlayerSearchGroup,
	PlayersResponse,
	PlayersResponseSchema,
	RecentGame,
	RecentRinkGame,
	RELOAD_PLAYER_INTEGRITY_ENDPOINT,
	RESYNC_PLAYER_ENDPOINT,
	Rink,
	RinkGame,
	RinkInfo,
	RinkResponse,
	RinkTeam,
	RosterPlayer,
	RUN_BENCHMARK_ENDPOINT,
	SEARCH_ENDPOINT,
	SearchResponse,
	SeasonSummary,
	StandingsResponse,
	TeamResponse,
	TeamRoster,
	TeamSeasonsResponse,
	TeamsResponse,
	toRecentGame,
	UnavailableSchedule,
	UpcomingGame,
} from "../shared/ApiJson.js"
import {getCity} from "../shared/Cities.js"
import {LIMITS} from "../shared/KHLConfig.js"
import {
	compareGameEvents,
	getGoalsByTeam,
	KHLBoxScore,
	KHLBoxScoreTeam,
	KHLGame,
	KHLGamePreviewStats,
	KHLGameStats,
	KHLHomeAway,
	KHLGameTeamStats,
	KHLLeagueGame,
	KHLLeagueTeam,
	KHLPlayerSearchResult,
	KHLRosterRow,
	KHLScoreboardGame,
	KHLScoreboardTeam,
	KHLSeason,
	KHLTeam,
	KHLTeamsPage,
	KHLTeamStats,
	normalizePlayerName,
} from "../shared/KHLJson.js"
import {
	addDaysToKey,
	DAY_MS as DAY,
	getDaysBetween,
	getLeagueDayKey,
	getLeagueLocalTime,
	HOUR_MS as HOUR,
	MINUTE_MS as MINUTE,
} from "../shared/LeagueTime.js"
import {getLiveBarnLiveUrl, getLiveBarnVodUrl} from "../shared/LiveBarn.js"
import {LiveBarnSurface, LiveBarnVenue} from "../shared/LiveBarnJson.js"

setLoggerTransports([new ConsoleTransport({verbose: true})])
const logger = new Logger("Server")

// Defaults suit local dev; the Fly.io image (see Dockerfile/fly.toml) runs a
// bundled copy of this file and points these at its own layout.
const PORT = Number(process.env.KHL_API_PORT ?? 3001)
// Relative to projects/khl, two levels above src/server/
const PROJECT_DIR = path.join(import.meta.dirname, "../..")
const DIST_DIR =
	process.env.KHL_STATIC_DIR ?? path.join(PROJECT_DIR, "dist/website")
const DB_PATH =
	process.env.KHL_DB_PATH ?? path.join(PROJECT_DIR, "data/khl.sqlite")

const db = openDatabase(DB_PATH)
// Fetched KHL and LiveBarn pages, in a file of their own since they can be
// fetched again, unlike the player identities in `db`
const SOURCES_DB_PATH =
	process.env.KHL_SOURCES_DB_PATH ??
	path.join(PROJECT_DIR, "data/sources.sqlite")
setPageStore(openPageStore(SOURCES_DB_PATH))

const app = express()

const cache = new KHLCache()
const appCache = new AppCache(db)
const syncer = new KHLSyncer({
	getSeasons: async () => {
		const teamsPage = await getTeamsPage()
		return {current: teamsPage.season, seasons: teamsPage.seasons}
	},
	// A copy that didn't parse counts: fetching it again won't help until
	// the page or the parser changes
	getFetchedAt: (page) => getPageLastFetchedAt("khl", getSyncPageUrl(page)),
	needsProcessing: (page) => {
		// Processing reads the page's main copy (a game's box score), so
		// without one stored there's nothing to process; it's fetched instead
		if (!getPageInfo("khl", getSyncPageUrl(page))) {
			return false
		}
		return getProcessedUrls(page).some((url) => {
			const info = getPageInfo("khl", url)
			return !!info && db.getProcessedHash(url) !== info.hash
		})
	},
	syncTeams: (seasonId, fetch) => {
		return recordProcessed(async () => {
			const page = await readForSync(fetch, () =>
				getKHLTeamsPage(seasonId),
			)
			recordTeams(page)
			return page.teams.map((team) => team.id)
		})
	},
	syncSchedule: (teamId, seasonId, fetch) => {
		return recordProcessed(async () => {
			const games = await readForSync(fetch, () =>
				getKHLTeamSchedule(teamId, seasonId),
			)
			db.saveSchedule(
				teamId,
				seasonId,
				games.map((game) => ({
					gameId: game.id,
					startsAt: game.startsAt,
					isFinal: game.isFinal,
				})),
			)
		})
	},
	syncTeamStats: (teamId, seasonId, fetch) => {
		return recordProcessed(async () => {
			const stats = await readForSync(fetch, () =>
				getKHLTeamStats(teamId, seasonId),
			)
			const team = db.getTeam(teamId, seasonId)
			await getRoster(
				teamId,
				team?.name ?? teamId,
				team?.logoUrl ?? null,
				stats,
			)
		})
	},
	fetchPlayer: async (registrationKey, seasonId) => {
		await readForSync(true, () => getKHLPlayer(registrationKey, seasonId))
	},
	syncGame: (gameId, fetch) => {
		return recordProcessed(async () => {
			await processGame(
				() => readForSync(fetch, () => getKHLBoxScore(gameId)),
				() => readForSync(fetch, () => getKHLGameStats(gameId)),
			)
		})
	},
	getSchedule: (teamId, seasonId) => db.getSchedule(teamId, seasonId),
	getSeasonSchedules: (seasonId) => db.getSeasonSchedules(seasonId),
	getGameStatus: (gameId) => {
		const record = db.getGames([gameId]).get(gameId)
		return record ? {isComplete: isGameRecordComplete(record)} : null
	},
	getTeamLatestCompletedGame: (teamId, seasonId) => {
		return db.getTeamLatestCompletedGame(teamId, seasonId)
	},
	getTeamRegistrationKeys: (teamId, seasonId) => {
		return db
			.getTeamSeasonLatestPlayerIds(teamId, seasonId)
			.map((khlPlayerId) => toRegistrationKey({khlPlayerId, teamId}))
	},
	getLatestCompletedGames: (keys) => db.getLatestCompletedGames(keys),
	buildPlayerList: async (season, isCurrentSeason) => {
		appCache.set(
			getPlayersCacheKey(season.id),
			await loadPlayers(season, isCurrentSeason),
		)
	},
	hasPlayerList: (seasonId) => appCache.has(getPlayersCacheKey(seasonId)),
})

/** Every URL whose derived rows a page's processing builds */
function getProcessedUrls(page: SyncPage): string[] {
	return matchField(page, "kind", {
		teams: () => [getSyncPageUrl(page)],
		schedule: () => [getSyncPageUrl(page)],
		"team-stats": () => [getSyncPageUrl(page)],
		// Nothing is derived from a player page
		player: () => [],
		game: (p) => [
			getKHLBoxScoreUrl(p.gameId).toString(),
			getKHLGameStatsUrl(p.gameId).toString(),
		],
	})
}

/**
 * Runs `process`, then records the hash of each stored page it parsed as
 * what its derived rows were built from (see needsProcessing)
 */
async function recordProcessed<T>(process: () => Promise<T>): Promise<T> {
	const log: PageLoad[] = []
	const result = await withPageLoadLog(log, process)
	for (const load of log) {
		if (load.hash) {
			db.setProcessedHash(load.key, load.hash)
		}
	}
	return result
}

/**
 * Reads a KHL page for the syncer: fetched if `fetch`, or else the stored
 * copy, which is fetched only if there isn't one. No stale fallback, so a
 * failed fetch is retried later instead of passing for a fresh one.
 */
function readForSync<T>(fetch: boolean, load: () => Promise<T>): Promise<T> {
	return withPageReadPolicy(
		{maxAgeMs: fetch ? 0 : Infinity, allowStale: false},
		load,
	)
}

// The league-wide players list is ~700kb of JSON, ~150kb gzipped
app.use(compression())

// Client log batches with stack traces can outgrow the 100kb default
app.use(express.json({limit: "512kb"}))

// Reports where each API request's pages came from: counts in Server-Timing
// (DevTools shows them under the request's Timing), and anything that wasn't
// in memory in the log. The pages themselves, which name internal cache keys,
// go in X-KHL-Pages only in dev or when the request sends X-KHL-Debug.
app.use("/api", (req, res, next) => {
	const log: PageLoad[] = []
	const listPages =
		process.env.NODE_ENV !== "production" || !!req.get("X-KHL-Debug")
	const json = res.json.bind(res)
	res.json = (body) => {
		if (log.length > 0 && !res.headersSent) {
			res.setHeader("Server-Timing", toServerTiming(log))
			if (listPages) {
				res.setHeader("X-KHL-Pages", toPageLoadsHeader(log))
			}
			logPageLoads(req.originalUrl, log)
		}
		return json(body)
	}
	withPageLoadLog(log, next)
})

app.get("/api/health", (_req, res) => {
	res.json({ok: true, commit: DEPLOY_INFO.commit, dirty: DEPLOY_INFO.dirty})
})

registerEndpoint(app, GET_STATUS_ENDPOINT, async () => getStatus(db))

// Dev only: drives headless Chrome, which the deployed image doesn't have.
// Imported by path at request time so puppeteer stays out of the bundle.
if (process.env.NODE_ENV !== "production") {
	let benchmarkRunning = false
	registerEndpoint(app, RUN_BENCHMARK_ENDPOINT, async ({names}) => {
		if (benchmarkRunning) {
			throw new ApiError(409, "a benchmark is already running")
		}
		benchmarkRunning = true
		try {
			const benchmarkPath = path.join(PROJECT_DIR, "tools/Benchmark.ts")
			const {runBenchmark} = (await import(
				benchmarkPath
			)) as typeof import("../../tools/Benchmark.js")
			return await runBenchmark(names)
		} finally {
			benchmarkRunning = false
		}
	})
}

registerEndpoint(app, SEARCH_ENDPOINT, async ({q}) => {
	const query = q.trim()
	const teamsPage = await getTeamsPage()
	const response: SearchResponse = {
		season: teamsPage.season,
		players: [],
		teams: [],
		rinks: [],
	}
	if (query.length < 2) {
		return response
	}

	const registrations = await cache.cached(
		`search:${query.toLowerCase()}:${teamsPage.season.id}`,
		10 * MINUTE,
		() => searchKHLPlayers(query, teamsPage.season.id),
	)
	const playerIds = db.recordRegistrations(registrations)
	const groups = new Map<string, PlayerSearchGroup>()
	for (const registration of registrations) {
		const playerId = playerIds.get(registration.playerId)!
		let group = groups.get(playerId)
		if (!group) {
			group = {playerId, name: registration.name, registrations: []}
			groups.set(playerId, group)
		}
		group.registrations.push(registration)
	}
	response.players = [...groups.values()]

	const needle = query.toLowerCase()
	response.rinks = Object.entries(KHL_ARENA_LIVEBARN_SURFACES)
		.filter(([, arena]) => {
			const cityName = getCity(arena.city)?.name ?? ""
			return (
				getMappedArenaName(arena).toLowerCase().includes(needle) ||
				cityName.toLowerCase().includes(needle)
			)
		})
		.map(([arenaId, arena]) => ({
			arenaId,
			name: getMappedArenaName(arena),
			city: arena.city,
		}))
	response.teams = teamsPage.teams
		.filter((team) => team.name.toLowerCase().includes(needle))
		.map((team) => {
			return {
				team,
				divisionName: getDivisionName(teamsPage, team.divisionId),
			}
		})
	return response
})

registerEndpoint(app, GET_PLAYER_ENDPOINT, async ({playerId}) => {
	const {player, registrations} = getPlayerRegistrations(playerId)

	const teamsPage = await getTeamsPage()
	const currentSeason = teamsPage.season

	// The KHL site 500s on some old pages, so one bad page shouldn't fail the
	// whole player: missing profiles and schedules are skipped and reported.
	const [profiles, schedules] = await Promise.all([
		Promise.all(
			registrations.map(async (r) => {
				try {
					const seasonId = r.seasonIds.at(-1)!
					return await getPlayer(
						toRegistrationKey(r),
						seasonId,
						seasonId === currentSeason.id,
					)
				} catch (error) {
					logger.warn("getPlayer", "KHL player page unavailable", {
						khlPlayerId: r.khlPlayerId,
						error,
					})
					return null
				}
			}),
		),
		getPlayerSchedules(registrations, teamsPage),
	])

	const response: PlayerResponse = {
		playerId,
		name: player.name,
		currentSeason,
		registrations: registrations.map((r, i) => {
			return {
				khlPlayerId: r.khlPlayerId,
				teamId: r.teamId,
				teamName: r.teamName,
				teamLogoUrl: r.teamLogoUrl,
				seasonIds: r.seasonIds,
				profile: profiles[i] ?? null,
			}
		}),
		games: await toFeedGames(schedules.games, [teamsPage]),
		unavailableSchedules: schedules.unavailable,
		upcoming: await getUpcomingGames(
			new Set(
				registrations
					.filter((r) => r.seasonIds.includes(currentSeason.id))
					.map((r) => r.teamId),
			),
		),
	}
	return response
})

registerEndpoint(
	app,
	GET_PLAYER_ACTIVITY_ENDPOINT,
	async ({playerId, kinds, days, limit}) => {
		return toActivityResponse(
			await getActivity(
				{kind: "player", playerId},
				{kinds, lookbackDays: days, maxEvents: limit},
			),
		)
	},
)

registerEndpoint(app, GET_PLAYER_INTEGRITY_ENDPOINT, async ({playerId}) => {
	return getPlayerIntegrity(getStoredPlayer(playerId))
})

registerEndpoint(app, RELOAD_PLAYER_INTEGRITY_ENDPOINT, async ({playerId}) => {
	const player = getStoredPlayer(playerId)
	const keys = [getHistoryCacheKey(player)]
	for (const r of db.getRegistrations(playerId)) {
		const latestSeasonId = r.seasonIds.at(-1)
		if (latestSeasonId) {
			keys.push(getPlayerCacheKey(toRegistrationKey(r), latestSeasonId))
		}
	}
	keys.forEach((key) => cache.invalidate(key))
	logger.info("reloadIntegrity", "dropped cached KHL pages", {
		playerId,
		keys,
	})
	return getPlayerIntegrity(player)
})

registerEndpoint(app, RESYNC_PLAYER_ENDPOINT, async ({playerId}) => {
	return getPlayerIntegrity(getStoredPlayer(playerId), {apply: true})
})

/**
 * Cache keys an integrity report lists. Their loaders only fetch and parse,
 * so a check can run one again without side effects.
 */
const INSPECTABLE_CACHE_PREFIXES = ["history:", "player:", "schedule:"]

function assertInspectableCacheKey(key: string) {
	if (!INSPECTABLE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
		throw new ApiError(400, `cache key ${key} can't be inspected`)
	}
}

registerEndpoint(app, GET_CACHE_ENTRY_ENDPOINT, async ({key}) => {
	assertInspectableCacheKey(key)
	const entry = cache.getLoadedEntry(key)
	return {
		key,
		...toIntegrityCacheInfo(key),
		value: entry ? JsonValueSchema.parse(await entry.value) : null,
	}
})

registerEndpoint(
	app,
	CHECK_CACHE_ENDPOINT,
	async ({key}): Promise<CacheCheckResponse> => {
		assertInspectableCacheKey(key)
		const checkedAt = new Date().toISOString()
		const entry = cache.getLoadedEntry(key)
		if (!entry) {
			return {
				key,
				status: "not-cached",
				checkedAt,
				differences: [],
				differenceCount: 0,
				khl: null,
				error: null,
			}
		}
		const cachedValue = JsonValueSchema.parse(await entry.value)
		let khl: JsonValue
		try {
			// Deliberately past the cache: the point is the KHL's page now
			khl = JsonValueSchema.parse(await entry.load())
		} catch (cause) {
			const error = toError(cause)
			logger.warn("checkCache", "KHL page unavailable", {key, error})
			return {
				key,
				status: "failed",
				checkedAt,
				differences: [],
				differenceCount: 0,
				khl: null,
				error: error.message,
			}
		}
		const differences = diffJson(cachedValue, khl)
		return {
			key,
			status: differences.length > 0 ? "differs" : "match",
			checkedAt,
			differences: differences.slice(0, LIMITS.CACHE_CHECK_DIFFERENCES),
			differenceCount: differences.length,
			khl,
			error: null,
		}
	},
)

function getStoredPlayer(playerId: string): Player {
	const player = db.getPlayer(playerId)
	if (!player) {
		throw new ApiError(404, `player ${playerId} not found`)
	}
	return player
}

/**
 * The player's registrations, most recently active first, as recorded from
 * every roster, box score, and search. The syncer records every season's
 * rosters, so this doesn't search the KHL.
 */
function getPlayerRegistrations(playerId: string) {
	const player = getStoredPlayer(playerId)
	const registrations = db
		.getRegistrations(playerId)
		.filter((r) => r.seasonIds.length > 0)
		.sort(compareLatestSeasonFirst)
	return {player, registrations}
}

function compareLatestSeasonFirst(a: Registration, b: Registration): number {
	return Number(b.seasonIds.at(-1) ?? 0) - Number(a.seasonIds.at(-1) ?? 0)
}

function getHistoryCacheKey(player: Player): string {
	return `history:${normalizePlayerName(player.name)}`
}

/**
 * The KHL's all-seasons search rows with the player's name, one per
 * registration per season. Records nothing; see `syncPlayerHistory`.
 */
function searchPlayerHistory(player: Player): Promise<KHLPlayerSearchResult[]> {
	const nameKey = normalizePlayerName(player.name)
	return cache.cached(getHistoryCacheKey(player), HOUR, async () => {
		return (await searchKHLPlayers(player.name, KHL_ALL_SEASONS)).filter(
			(r) => normalizePlayerName(r.name) === nameKey,
		)
	})
}

/** Search results already recorded, so each load is recorded once */
const recordedHistories = new WeakSet<KHLPlayerSearchResult[]>()

/**
 * Picks up the player's registrations from every season (including teams
 * they joined since we last looked) and returns the search rows.
 */
async function syncPlayerHistory(
	player: Player,
): Promise<KHLPlayerSearchResult[]> {
	const results = await searchPlayerHistory(player)
	if (!recordedHistories.has(results)) {
		db.recordRegistrations(results)
		recordedHistories.add(results)
	}
	return results
}

/**
 * Compares every registration attached to the player with the KHL's search
 * and player pages, and lists what a resync would change. Writes nothing
 * unless `apply`, which records the search's new ids and seasons and then
 * stores each registration as the KHL has it. The cache is read before
 * anything loads, so it shows what the player's page would have used.
 */
async function getPlayerIntegrity(
	player: Player,
	{apply = false}: {apply?: boolean} = {},
): Promise<PlayerIntegrityResponse> {
	const checkedAt = new Date().toISOString()
	const historyKey = getHistoryCacheKey(player)
	// By key: two KHL ids on the same team can share a schedule
	const cache = new Map<string, IntegrityCacheEntry>()
	const addCacheEntry = (
		kind: IntegrityCacheEntry["kind"],
		key: string,
		label: string,
	) => {
		if (!cache.has(key)) {
			cache.set(key, {key, kind, label, ...toIntegrityCacheInfo(key)})
		}
	}
	addCacheEntry("search", historyKey, `“${player.name}”, all seasons`)

	let searchResults: KHLPlayerSearchResult[] | null = null
	let searchError: string | null = null
	try {
		searchResults = apply
			? await syncPlayerHistory(player)
			: await searchPlayerHistory(player)
	} catch (cause) {
		const error = toError(cause)
		logger.warn("getPlayerIntegrity", "KHL search unavailable", {
			playerId: player.id,
			error,
		})
		searchError = error.message
	}

	let registrations = db
		.getRegistrations(player.id)
		.sort(compareLatestSeasonFirst)
	for (const r of registrations) {
		const keys = getRegistrationCacheKeys(r)
		if (keys.profile) {
			addCacheEntry(
				"profile",
				keys.profile,
				`${r.teamName} · KHL id ${r.khlPlayerId} · season ${r.seasonIds.at(-1)}`,
			)
		}
		r.seasonIds.forEach((seasonId, i) => {
			addCacheEntry(
				"schedule",
				keys.schedules[i]!,
				`${r.teamName} · season ${seasonId}`,
			)
		})
	}

	const pages = new Map(
		await Promise.all(
			registrations.map(async (r) => {
				return [
					toRegistrationKey(r),
					await loadIntegrityProfile(r),
				] as const
			}),
		),
	)
	const getOwnSearchResults = (r: Registration) => {
		return (
			searchResults?.filter(
				(s) => s.playerId === r.khlPlayerId && s.teamId === r.teamId,
			) ?? null
		)
	}

	if (apply) {
		for (const r of registrations) {
			const reconciled = reconcileRegistration(
				r,
				getOwnSearchResults(r),
				pages.get(toRegistrationKey(r))!.profile,
			)
			if (reconciled) {
				db.reconcileRegistration({
					...reconciled,
					khlPlayerId: r.khlPlayerId,
				})
				logger.info("resync", "updated registration", {
					playerId: player.id,
					khlPlayerId: r.khlPlayerId,
					teamId: r.teamId,
					differences: diffJson(toIntegrityRecord(r), reconciled),
				})
			}
		}
		registrations = db
			.getRegistrations(player.id)
			.sort(compareLatestSeasonFirst)
	}

	const integrityRegistrations = registrations.map(
		(r): IntegrityRegistration => {
			const page = pages.get(toRegistrationKey(r))!
			const ownSearchResults = getOwnSearchResults(r)
			const stored = toIntegrityRecord(r)
			const expected =
				reconcileRegistration(r, ownSearchResults, page.profile) ??
				stored
			return {
				khlPlayerId: r.khlPlayerId,
				name: r.name,
				position: r.position,
				teamId: r.teamId,
				teamName: r.teamName,
				teamLogoUrl: r.teamLogoUrl,
				seasonIds: r.seasonIds,
				updatedAt: r.updatedAt,
				...page,
				searchResults: ownSearchResults ?? [],
				mismatches: compareRegistration(
					r,
					ownSearchResults,
					page.profile,
				),
				stored,
				expected,
				differences: diffJson(stored, expected),
				cacheKeys: getRegistrationCacheKeys(r),
			}
		},
	)

	// Search rows with the player's name that aren't this player's recorded
	// registrations: attached to another player, or not recorded at all (an
	// id's new team is a new registration, recorded by the next resync)
	const ownKeys = new Set(registrations.map(toRegistrationKey))
	const unlinked = new Map<string, IntegrityUnlinked>()
	for (const s of searchResults ?? []) {
		const key = toRegistrationKey({
			khlPlayerId: s.playerId,
			teamId: s.teamId,
		})
		if (ownKeys.has(key)) {
			continue
		}
		const otherPlayerId = db.findPlayerIdForRegistration(s.playerId)
		const row = unlinked.get(key) ?? {
			khlPlayerId: s.playerId,
			name: s.name,
			teamId: s.teamId,
			teamName: s.teamName,
			seasonIds: [],
			playerId: otherPlayerId === player.id ? null : otherPlayerId,
			khlUrl: "",
		}
		row.seasonIds.push(s.seasonId)
		unlinked.set(key, row)
	}
	for (const row of unlinked.values()) {
		row.seasonIds.sort((a, b) => Number(a) - Number(b))
		row.khlUrl = getKHLPlayerUrl(
			toRegistrationKey(row),
			row.seasonIds.at(-1)!,
		).toString()
	}

	return {
		playerId: player.id,
		name: player.name,
		createdAt: player.createdAt,
		checkedAt,
		cache: [...cache.values()],
		registrations: integrityRegistrations,
		unlinked: [...unlinked.values()],
		searchUrl: getKHLPlayerSearchUrl(
			player.name,
			KHL_ALL_SEASONS,
		).toString(),
		searchError,
	}
}

/**
 * The cache keys of the KHL pages the player's page loads for a registration:
 * its player page (see `loadIntegrityProfile`) and its schedules (see
 * `getPlayerSchedules`)
 */
function getRegistrationCacheKeys(
	r: Registration,
): IntegrityRegistrationCacheKeys {
	const latestSeasonId = r.seasonIds.at(-1)
	return {
		profile: latestSeasonId
			? getPlayerCacheKey(toRegistrationKey(r), latestSeasonId)
			: null,
		schedules: r.seasonIds.map((seasonId) => {
			return getScheduleCacheKey(r.teamId, seasonId)
		}),
	}
}

/** A registration's KHL player page as of its latest season */
async function loadIntegrityProfile(
	r: Registration,
): Promise<
	Pick<IntegrityRegistration, "profile" | "profileError" | "profileUrl">
> {
	const latestSeasonId = r.seasonIds.at(-1)
	if (!latestSeasonId) {
		return {
			profile: null,
			profileError: "No seasons recorded, so there's no page to load",
			profileUrl: null,
		}
	}
	const profileUrl = getKHLPlayerUrl(
		toRegistrationKey(r),
		latestSeasonId,
	).toString()
	try {
		const currentSeason = await getCurrentSeason()
		const profile = await getPlayer(
			toRegistrationKey(r),
			latestSeasonId,
			latestSeasonId === currentSeason.id,
		)
		return {profile, profileError: null, profileUrl}
	} catch (cause) {
		const error = toError(cause)
		logger.warn("getPlayerIntegrity", "KHL player page unavailable", {
			khlPlayerId: r.khlPlayerId,
			error,
		})
		return {profile: null, profileError: error.message, profileUrl}
	}
}

function toIntegrityCacheInfo(
	key: string,
): Pick<IntegrityCacheEntry, "cachedAt" | "expiresAt"> {
	return cache.getInfo(key) ?? {cachedAt: null, expiresAt: null}
}

/**
 * Every game of every team and season the player was on. A schedule the KHL
 * site fails to load is skipped and reported in `unavailable`.
 */
async function getPlayerSchedules(
	registrations: Registration[],
	teamsPage: KHLTeamsPage,
): Promise<{games: KHLGame[]; unavailable: UnavailableSchedule[]}> {
	// One schedule per team per season the player was on it
	const teamSeasons = new Map<
		string,
		{teamId: string; teamName: string; seasonId: string}
	>()
	for (const r of registrations) {
		for (const seasonId of r.seasonIds) {
			teamSeasons.set(`${r.teamId}:${seasonId}`, {
				teamId: r.teamId,
				teamName: r.teamName,
				seasonId,
			})
		}
	}
	const unavailable: UnavailableSchedule[] = []
	const schedules = await Promise.all(
		[...teamSeasons.values()].map(async ({teamId, teamName, seasonId}) => {
			try {
				return await getSchedule(
					teamId,
					seasonId,
					seasonId === teamsPage.season.id,
				)
			} catch (error) {
				logger.warn("getSchedule", "KHL schedule unavailable", {
					teamId,
					seasonId,
					error,
				})
				unavailable.push({
					teamId,
					teamName,
					seasonId,
					seasonName:
						teamsPage.seasons.find((s) => s.id === seasonId)
							?.name ?? null,
				})
				return []
			}
		}),
	)
	return {games: schedules.flat(), unavailable}
}

/** Whose activity it is, by our ids */
type ActivitySubject =
	| {kind: "player"; playerId: string}
	| {kind: "team"; teamId: string; season?: string}

/** A game in a subject's activity, before it's shaped for the API */
interface ActivityRow {
	game: GameRecordWithTeams
	/** The subject's side */
	side: KHLHomeAway
	attendance: ActivityAttendance
	/** Latest first */
	events: ActivityEvent[]
}

/**
 * The subject's final games from the `lookbackDays` before their latest one
 * that have a requested event or attendance (see ActivityKind), newest first,
 * with at most `maxEvents` events in all. Games are read from the games
 * tables; one that isn't there yet is processed from its pages first (see
 * getGameRecords), and one whose pages fail to load is left out.
 */
async function getActivity(
	subject: ActivitySubject,
	{
		kinds = DEFAULT_ACTIVITY_KINDS,
		lookbackDays = LIMITS.ACTIVITY_LOOKBACK_DAYS,
		maxEvents = LIMITS.ACTIVITY_EVENTS,
	}: {kinds?: ActivityKind[]; lookbackDays?: number; maxEvents?: number} = {},
): Promise<ActivityRow[]> {
	const {games, by} = await getActivitySubject(subject)
	const wanted = new Set(kinds)

	const finals = [
		...new Map(
			games
				.filter((game) => game.isFinal && game.id)
				.sort((a, b) => b.startsAt.localeCompare(a.startsAt))
				.map((game) => [game.id!, game]),
		).values(),
	]
	const since = finals[0]
		? Date.parse(finals[0].startsAt) - lookbackDays * DAY
		: 0
	const recent = finals.filter((game) => Date.parse(game.startsAt) >= since)

	const records = await getGameRecords(recent.map((game) => game.id!))
	const gameIds = [...records.keys()]
	const eventsByGame = new Map<string, ActivityEvent[]>()
	for (const {gameId, event} of db.getGameEvents(gameIds, by)) {
		eventsByGame.set(gameId, [...(eventsByGame.get(gameId) ?? []), event])
	}
	const getAttendance = matchField(by, "kind", {
		players: (b) => {
			const dressed = db.getDressedGameIds(gameIds, b.khlPlayerIds)
			return (
				gameId: string,
				side: GameRecordTeam,
			): ActivityAttendance => {
				// Not posted yet: count it, so a late lineup never hides goals
				if (!side.lineupPosted || dressed.has(gameId)) {
					return "played"
				}
				return "skipped"
			}
		},
		team: () => (): ActivityAttendance => "played",
	})

	const rows: ActivityRow[] = []
	let count = 0
	for (const game of recent) {
		const record = records.get(game.id!)
		const side = record
			? matchValue(game.homeAway, {home: record.home, away: record.away})
			: null
		// The box score and schedule disagree on the team: leave it out
		if (!record || side?.id !== game.team.id) {
			continue
		}
		const attendance = getAttendance(record.gameId, side)
		const events = matchFn(attendance, {
			played: () =>
				(eventsByGame.get(record.gameId) ?? [])
					.filter((event) => wanted.has(event.kind))
					.sort((a, b) =>
						compareGameEvents(getEventAt(b), getEventAt(a)),
					),
			skipped: (): ActivityEvent[] => [],
		}).slice(0, Math.max(0, maxEvents - count))
		if (events.length === 0 && !wanted.has(attendance)) {
			continue
		}
		count += events.length
		rows.push({game: record, side: game.homeAway, attendance, events})
	}
	return rows
}

/**
 * A subject's games, and whose goals, assists, and penalties count as its
 * own. A player can have a KHL player id per team they were on.
 */
async function getActivitySubject(subject: ActivitySubject): Promise<{
	games: KHLGame[]
	by:
		| {kind: "players"; khlPlayerIds: string[]}
		| {kind: "team"; teamId: string}
}> {
	return matchField(subject, "kind", {
		team: async (s) => {
			const {team, isCurrentSeason} = await getListedTeam(
				s.teamId,
				s.season,
			)
			return {
				games: await getSchedule(
					team.id,
					team.seasonId,
					isCurrentSeason,
				),
				by: {kind: "team" as const, teamId: team.id},
			}
		},
		player: async (s) => {
			const {registrations} = getPlayerRegistrations(s.playerId)
			const {games} = await getPlayerSchedules(
				registrations,
				await getTeamsPage(),
			)
			return {
				games,
				by: {
					kind: "players" as const,
					khlPlayerIds: [
						...new Set(registrations.map((r) => r.khlPlayerId)),
					],
				},
			}
		},
	})
}

/**
 * Games from the games tables, processing any that aren't there yet, or were
 * processed before their summary or lineups were posted, from their pages.
 * A game whose pages fail to load is left out.
 */
async function getGameRecords(
	gameIds: string[],
): Promise<Map<string, GameRecordWithTeams>> {
	const stored = db.getGames(gameIds)
	const now = Date.now()
	const toProcess = gameIds.filter((gameId) => {
		const record = stored.get(gameId)
		return !record || isGameRecordUnsettled(record, now)
	})
	if (toProcess.length === 0) {
		return stored
	}
	await Promise.all(
		toProcess.map(async (gameId) => {
			try {
				await processGame(
					() => getBoxScore(gameId),
					() => getGameStats(gameId),
				)
			} catch (error) {
				logger.warn("getGameRecords", "game pages unavailable", {
					gameId,
					error,
				})
			}
		}),
	)
	return db.getGames(gameIds)
}

/**
 * Processed before its summary or lineups were posted, long enough ago to
 * look again, and recently enough that they still might be
 */
function isGameRecordUnsettled(record: GameRecord, now: number): boolean {
	const recheckAt = getGameRecheckAt({
		startsAt: record.startsAt,
		isComplete: isGameRecordComplete(record),
		lastLookedAt: record.processedAt,
	})
	return recheckAt !== null && recheckAt <= now
}

/**
 * Saves a game to the games tables from its box score and stats pages, and
 * records everyone its box score names, whose names the events are read with.
 * The stats page is optional: without it, the lineups are left unposted.
 */
async function processGame(
	loadBoxScore: () => Promise<KHLBoxScore>,
	loadStats: () => Promise<KHLGameStats>,
): Promise<GameRecord> {
	const boxScore = await loadBoxScore()
	const stats = await loadStats().catch((error: unknown) => {
		logger.warn("processGame", "game stats unavailable", {
			gameId: boxScore.gameId,
			error,
		})
		return null
	})
	recordBoxScorePlayers(boxScore)
	const records = toGameRecords(boxScore, stats)
	db.saveGame(records.game, records.teams, records.events, records.lineups)
	return records.game
}

/** Activity rows as the API returns them, with replay and player links */
async function toActivityResponse(
	rows: ActivityRow[],
): Promise<ActivityResponse> {
	const surfacesByArena = await getSurfacesByArena(
		rows.map((r) => r.game.arenaId),
	)
	const playerIds = new Map<string, string>()
	for (const {events} of rows) {
		for (const event of events) {
			const refs = matchField(event, "kind", {
				goal: (e) => [e.goal.scorer, ...e.goal.assists],
				assist: (e) => [e.goal.scorer, ...e.goal.assists],
				penalty: (e) => (e.penalty.player ? [e.penalty.player] : []),
			})
			for (const ref of refs) {
				const playerId = db.findPlayerIdForRegistration(ref.id)
				if (playerId) {
					playerIds.set(ref.id, playerId)
				}
			}
		}
	}
	const toActivityTeam = (team: GameRecordWithTeams["home"]) => ({
		id: team.id,
		name: team.name,
		logoUrl: team.logoUrl,
		seasonId: team.seasonId,
		goals: team.goals,
	})
	const games = rows.map(({game, side, attendance, events}): ActivityGame => {
		const [team, opponent] = matchValue(side, {
			home: [game.home, game.away],
			away: [game.away, game.home],
		})
		return {
			gameId: game.gameId,
			startsAt: game.startsAt,
			homeAway: side,
			team: toActivityTeam(team),
			opponent: toActivityTeam(opponent),
			livebarn: toLiveBarnLinks(
				game.arenaId ? (surfacesByArena.get(game.arenaId) ?? []) : [],
				game,
			),
			attendance,
			events,
		}
	})
	return {games, playerIds: Object.fromEntries(playerIds)}
}

/** When an activity event happened on the scoresheet */
function getEventAt(event: ActivityEvent) {
	return matchField(event, "kind", {
		goal: (e) => e.goal,
		assist: (e) => e.goal,
		penalty: (e) => e.penalty,
	})
}

/** A team as listed in `season` (default: the current one), or a 404 */
async function getListedTeam(teamId: string, season: string | undefined) {
	const [teamsPage, currentSeason] = await Promise.all([
		getTeamsPage(season),
		getCurrentSeason(),
	])
	const team = findListedTeam(teamsPage, teamId)
	if (!team) {
		throw new ApiError(404, `team ${teamId} not found`)
	}
	return {
		team,
		teamsPage,
		isCurrentSeason: team.seasonId === currentSeason.id,
	}
}

registerEndpoint(app, GET_TEAM_ENDPOINT, async ({teamId, season}) => {
	const {team, teamsPage, isCurrentSeason} = await getListedTeam(
		teamId,
		season,
	)
	const [schedule, stats, upcoming] = await Promise.all([
		getSchedule(team.id, team.seasonId, isCurrentSeason),
		getTeamStats(team.id, team.seasonId, isCurrentSeason),
		isCurrentSeason ? getUpcomingGames(new Set([team.id])) : [],
	])
	const response: TeamResponse = {
		team,
		divisionName: getDivisionName(teamsPage, team.divisionId),
		season: teamsPage.season,
		seasons: stats.seasons,
		games: await toFeedGames(schedule, [teamsPage]),
		upcoming,
		roster: await getRoster(team.id, team.name, team.logoUrl, stats),
	}
	return response
})

// Separate from the team, since it reads a page per recent game
registerEndpoint(
	app,
	GET_TEAM_ACTIVITY_ENDPOINT,
	async ({teamId, season, kinds, days, limit}) => {
		return toActivityResponse(
			await getActivity(
				{kind: "team", teamId, season},
				{kinds, lookbackDays: days, maxEvents: limit},
			),
		)
	},
)

registerEndpoint(app, GET_GAME_ENDPOINT, async ({gameId}) => {
	const [boxScore, currentSeason] = await Promise.all([
		getBoxScore(gameId),
		getCurrentSeason(),
	])
	const {away, home} = boxScore
	// Team pages are extras: if the KHL site fails on one, still show the game
	const getStats = (team: KHLBoxScoreTeam) => {
		const isCurrentSeason = team.seasonId === currentSeason.id
		return getTeamStats(team.id, team.seasonId, isCurrentSeason).catch(
			(error: unknown) => {
				logger.warn("getGame", "KHL team stats unavailable", {
					teamId: team.id,
					seasonId: team.seasonId,
					error,
				})
				return null
			},
		)
	}
	const [surfaces, awayStats, homeStats] = await Promise.all([
		boxScore.arena ? getVerifiedSurfaces(boxScore.arena.id) : [],
		getStats(away),
		getStats(home),
	])
	const [headToHead, rosters, lineups, awayForm, homeForm, previewStats] =
		await Promise.all([
			awayStats && homeStats
				? getHeadToHead(awayStats, homeStats, currentSeason.id, {
						excludeGameId: boxScore.gameId,
					})
				: [],
			awayStats && homeStats
				? Promise.all([
						getRoster(away.id, away.name, away.logoUrl, awayStats),
						getRoster(home.id, home.name, home.logoUrl, homeStats),
					]).then(([away, home]) => ({away, home}))
				: null,
			boxScore.hasSummary ? getGameLineups(boxScore) : null,
			getGameSeasonSummary(away, boxScore.startsAt, currentSeason.id),
			getGameSeasonSummary(home, boxScore.startsAt, currentSeason.id),
			// Extras for the comparison; the game shows without them
			getPreviewStats(gameId),
		])
	const response: GameResponse = {
		boxScore: {...boxScore, arena: toDisplayArena(boxScore.arena)},
		previewStats,
		score: await getFinalScore(boxScore),
		playerIds: Object.fromEntries(recordBoxScorePlayers(boxScore)),
		livebarn: toLiveBarnLinks(surfaces, boxScore),
		headToHead,
		rosters,
		lineups,
		form: {away: awayForm, home: homeForm},
		currentSeason,
	}
	return response
})

registerEndpoint(app, LIST_TEAMS_ENDPOINT, async ({season}) => {
	const teamsPage = await getTeamsPage(season)
	const response: TeamsResponse = {
		season: teamsPage.season,
		seasons: teamsPage.seasons,
		divisions: teamsPage.divisions
			.map((division) => ({
				name: division.name,
				teams: teamsPage.teams
					.filter((t) => t.divisionId === division.id)
					.sort((a, b) => a.name.localeCompare(b.name)),
			}))
			.filter((division) => division.teams.length > 0),
	}
	return response
})

registerEndpoint(app, GET_STANDINGS_ENDPOINT, async ({season}) => {
	const page = await cache.cached(
		`standings:${season ?? "current"}`,
		10 * MINUTE,
		() => {
			return getKHLStandings(season)
		},
	)
	const response: StandingsResponse = {
		season: page.season,
		seasons: page.seasons,
		divisions: page.divisions.filter((d) => d.rows.length > 0),
	}
	return response
})

// Only ever served from the app cache, which the syncer builds, since a list
// reads every team's stats page
registerEndpoint(app, LIST_PLAYERS_ENDPOINT, async ({season}) => {
	const teamsPage = await getTeamsPage()
	const seasonId = season ?? teamsPage.season.id
	const isListed = [teamsPage.season, ...teamsPage.seasons].some(
		(s) => s.id === seasonId,
	)
	if (!isListed) {
		throw new ApiError(404, `season ${seasonId} not found`)
	}
	const players = appCache.get(
		getPlayersCacheKey(seasonId),
		PlayersResponseSchema,
	)
	if (!players) {
		throw new ApiError(
			503,
			"this season's players are still loading; try again in a few minutes",
		)
	}
	// Player UUIDs are looked up now rather than kept from when the list was
	// built, so a merge or resync since then shows right away
	const list = players.value
	const playerIds = db.getPlayerIdsByRegistration(
		[...list.skaters, ...list.goalies].map(toRegistrationKey),
	)
	const withPlayerIds = <T extends RosterPlayer & {teamId: string}>(
		rows: T[],
	): T[] => {
		return rows.map((row) => ({
			...row,
			playerId: playerIds.get(toRegistrationKey(row)) ?? row.playerId,
		}))
	}
	const response: PlayersResponse = {
		...list,
		skaters: withPlayerIds(list.skaters),
		goalies: withPlayerIds(list.goalies),
	}
	return response
})

/**
 * A season's player list, from every team's stats page (~175 of them), read
 * one team at a time. KHLSyncer runs it in the background lane, which paces
 * the fetches.
 */
async function loadPlayers(
	season: KHLSeason,
	isCurrentSeason: boolean,
): Promise<PlayersResponse> {
	// Stored pages, which the syncer just walked, rather than the memory
	// cache, which would keep every season's pages once they were read
	const teamsPage = await readForSync(false, () =>
		getKHLTeamsPage(isCurrentSeason ? undefined : season.id),
	)
	// One team's page failing leaves it out rather than failing the list
	const unavailableTeams: KHLTeam[] = []
	const loaded: {team: KHLTeam; roster: TeamRoster}[] = []
	for (const team of teamsPage.teams) {
		try {
			const stats = await readForSync(false, () =>
				getKHLTeamStats(team.id, team.seasonId),
			)
			const roster = await getRoster(
				team.id,
				team.name,
				team.logoUrl,
				stats,
			)
			loaded.push({team, roster})
		} catch (error) {
			logger.warn("loadPlayers", "KHL team stats unavailable", {
				teamId: team.id,
				seasonId: team.seasonId,
				error,
			})
			unavailableTeams.push(team)
		}
	}
	// Registered players who haven't played (backups, most goalies) have no
	// stats to compare, and would be a third of the list
	const toRows = (team: KHLTeam, players: RosterPlayer[]) => {
		return players
			.filter((p) => Number(p.stats["GP"]) > 0)
			.map((p) => ({...p, teamId: team.id}))
	}
	return {
		season: teamsPage.season,
		seasons: teamsPage.seasons,
		teams: loaded.map(({team}) => ({
			team,
			divisionName: getDivisionName(teamsPage, team.divisionId),
		})),
		skaters: loaded.flatMap(({team, roster}) =>
			toRows(team, roster.skaters),
		),
		goalies: loaded.flatMap(({team, roster}) =>
			toRows(team, roster.goalies),
		),
		unavailableTeams,
	}
}

registerEndpoint(app, LIST_TEAM_SEASONS_ENDPOINT, async ({teamId, season}) => {
	const currentSeason = await getCurrentSeason()
	const stats = await getTeamStats(
		teamId,
		season,
		season === currentSeason.id,
	)
	const response: TeamSeasonsResponse = {seasons: stats.seasons}
	return response
})

registerEndpoint(
	app,
	GET_MATCHUP_ENDPOINT,
	async ({a, b, aSeason, bSeason}) => {
		const [pageA, pageB, currentSeason] = await Promise.all([
			getTeamsPage(aSeason),
			getTeamsPage(bSeason),
			getCurrentSeason(),
		])
		if (a === b && pageA.season.id === pageB.season.id) {
			throw new ApiError(400, "pick two different teams or seasons")
		}
		const getTeam = (teamsPage: KHLTeamsPage, teamId: string) => {
			const team = findListedTeam(teamsPage, teamId)
			if (!team) {
				throw new ApiError(
					404,
					`team ${teamId} not found in season ${teamsPage.season.id}`,
				)
			}
			return team
		}
		const teamA = getTeam(pageA, a)
		const teamB = getTeam(pageB, b)
		const isCurrentA = teamA.seasonId === currentSeason.id
		const isCurrentB = teamB.seasonId === currentSeason.id
		const [statsA, statsB, scheduleA, scheduleB, upcoming] =
			await Promise.all([
				getTeamStats(teamA.id, teamA.seasonId, isCurrentA),
				getTeamStats(teamB.id, teamB.seasonId, isCurrentB),
				getSchedule(teamA.id, teamA.seasonId, isCurrentA),
				getSchedule(teamB.id, teamB.seasonId, isCurrentB),
				isCurrentA && isCurrentB
					? getUpcomingGames(new Set([teamA.id]))
					: [],
			])
		const toMatchupTeam = async (
			teamsPage: KHLTeamsPage,
			team: KHLTeam,
			stats: KHLTeamStats,
			schedule: KHLGame[],
		): Promise<MatchupTeam> => {
			return {
				team,
				season: teamsPage.season,
				divisionName: getDivisionName(teamsPage, team.divisionId),
				...getSeasonRecord(schedule),
				roster: await getRoster(
					team.id,
					team.name,
					team.logoUrl,
					stats,
				),
			}
		}
		const [matchupA, matchupB, headToHead, previewA, previewB] =
			await Promise.all([
				toMatchupTeam(pageA, teamA, statsA, scheduleA),
				toMatchupTeam(pageB, teamB, statsB, scheduleB),
				// A team against its own past season has no head-to-head
				teamA.id === teamB.id
					? []
					: getHeadToHead(statsA, statsB, currentSeason.id, {
							// The matchup shows each picked season's meetings
							includeSeasonIds: [teamA.seasonId, teamB.seasonId],
						}),
				getSeasonPreviewStats(scheduleA),
				getSeasonPreviewStats(scheduleB),
			])
		const response: MatchupResponse = {
			currentSeason,
			a: matchupA,
			b: matchupB,
			headToHead,
			previewStats: combinePreviewStats(previewA, previewB),
			upcoming: upcoming.filter(({game}) => {
				return (
					game.homeTeam.id === teamB.id ||
					game.awayTeam.id === teamB.id
				)
			}),
		}
		return response
	},
)

/** A game's preview stats; null if the KHL site fails, as they're extras. */
async function getPreviewStats(
	gameId: string,
): Promise<KHLGamePreviewStats | null> {
	try {
		return await cache.cached(`game-preview:${gameId}`, 10 * MINUTE, () =>
			getKHLGamePreviewStats(gameId),
		)
	} catch (error) {
		logger.warn("getPreviewStats", "KHL preview stats unavailable", {
			gameId,
			error,
		})
		return null
	}
}

/** One team's side of a game's preview stats */
type TeamPreviewStats = Record<keyof KHLGamePreviewStats, number | null>

/**
 * A team's PP%, PK%, shots and PIM for its season. The league only shows these
 * on game previews, but every preview in a season shows the season to date,
 * so any of the team's games will do: its latest.
 */
async function getSeasonPreviewStats(
	schedule: KHLGame[],
): Promise<TeamPreviewStats | null> {
	const game = schedule
		.filter((g) => g.id)
		.reduce<KHLGame | null>(
			(latest, g) =>
				!latest || g.startsAt > latest.startsAt ? g : latest,
			null,
		)
	if (!game?.id) {
		return null
	}
	const stats = await getPreviewStats(game.id)
	if (!stats) {
		return null
	}
	const side = game.homeAway
	return {
		powerPlayPct: stats.powerPlayPct?.[side] ?? null,
		penaltyKillPct: stats.penaltyKillPct?.[side] ?? null,
		shotsPerGame: stats.shotsPerGame?.[side] ?? null,
		shotsAgainstPerGame: stats.shotsAgainstPerGame?.[side] ?? null,
		penaltyMinutesPerGame: stats.penaltyMinutesPerGame?.[side] ?? null,
	}
}

/** Two teams' preview stats as a game's: a as "away", b as "home" */
function combinePreviewStats(
	a: TeamPreviewStats | null,
	b: TeamPreviewStats | null,
): KHLGamePreviewStats | null {
	if (!a && !b) {
		return null
	}
	const pair = (key: keyof KHLGamePreviewStats) => {
		const away = a?.[key] ?? null
		const home = b?.[key] ?? null
		return away === null && home === null ? null : {away, home}
	}
	return {
		powerPlayPct: pair("powerPlayPct"),
		penaltyKillPct: pair("penaltyKillPct"),
		shotsPerGame: pair("shotsPerGame"),
		shotsAgainstPerGame: pair("shotsAgainstPerGame"),
		penaltyMinutesPerGame: pair("penaltyMinutesPerGame"),
	}
}

registerEndpoint(app, LOG_ENDPOINT, async ({sessionId, userAgent, logs}) => {
	for (const log of logs) {
		// Keep the client's own context, prefixed so it's clear where it came from
		new Logger(`client.${log.context}`)[log.level](
			log.subcontext,
			log.message,
			{
				...log.aux,
				client: {
					sessionId,
					url: log.url,
					timestamp: log.timestamp,
					userAgent,
				},
			},
		)
	}
	return {ok: true}
})

registerEndpoint(app, LIST_RINKS_ENDPOINT, async () => {
	const teamsPage = await getTeamsPage()
	const rinks = await Promise.all(
		Object.keys(KHL_ARENA_LIVEBARN_SURFACES).map((arenaId) => {
			return getRink(arenaId, teamsPage)
		}),
	)
	return {season: teamsPage.season, rinks}
})

registerEndpoint(app, LIST_GAMES_ENDPOINT, async ({from, to = from}) => {
	const teamsPage = await getTeamsPage()
	// One scoreboard per day; fetchKHLPage limits how many run at once
	const days = Array.from({length: getDaysBetween(from, to)}, (_, i) => {
		return addDaysToKey(from, i)
	})
	const games = await Promise.all(
		days.map((day) => getDayGames(day, teamsPage)),
	)
	const response: GamesResponse = {
		season: teamsPage.season,
		// Each day is already in order, and the days are too
		games: games.flat(),
	}
	return response
})

/** A day's games from the scoreboard, with their rinks, soonest first. */
async function getDayGames(
	date: string,
	teamsPage: KHLTeamsPage,
): Promise<UpcomingGame[]> {
	const scoreboard = await getScoreboard(date)
	const games = await Promise.all(
		scoreboard.map(async (game): Promise<UpcomingGame | null> => {
			// Final games' cards drop their start time and rink; the box
			// score has both
			let {startsAt, arena} = game
			if (!startsAt || !arena) {
				const boxScore = await getBoxScore(game.gameId).catch(
					(error: unknown) => {
						logger.warn("listGames", "box score unavailable", {
							gameId: game.gameId,
							error,
						})
						return null
					},
				)
				startsAt ??= boxScore?.startsAt ?? null
				arena ??= boxScore?.arena ?? null
			}
			if (!startsAt) {
				return null
			}
			const toRinkTeam = (team: KHLScoreboardTeam): RinkTeam => ({
				id: team.id,
				// The scoreboard doubles apostrophes ("Carl''s"); prefer the teams page
				name:
					findListedTeam(teamsPage, team.id)?.name ??
					team.name.replaceAll("''", "'"),
				logoUrl: team.logoUrl,
				divisionName:
					getListedDivisionName(teamsPage, team.id) ??
					team.divisionName,
			})
			const {away, home} = game
			return {
				rink: await getRinkInfoOrFallback(arena),
				game: {
					gameId: game.gameId,
					startsAt,
					awayTeam: toRinkTeam(away),
					homeTeam: toRinkTeam(home),
					score:
						game.isFinal &&
						away.goals !== null &&
						home.goals !== null
							? {away: away.goals, home: home.goals}
							: null,
				},
			}
		}),
	)
	return games
		.filter((g) => g !== null)
		.sort((a, b) => a.game.startsAt.localeCompare(b.game.startsAt))
}

/** How many finished games a rink page lists, and how far back it looks */
const RECENT_RINK_GAMES = 5
const RECENT_RINK_DAYS = 14

/**
 * A rink's latest finished games, newest first. Walks the scoreboard back a
 * day at a time, stopping once it has enough: finished games' cards lack the
 * rink, so each day costs a box score per game, and asking for weeks at once
 * gets the KHL site to block us. Quiet rinks may have fewer than five.
 */
async function getRecentRinkGames(
	arenaId: string,
	teamsPage: KHLTeamsPage,
): Promise<RecentRinkGame[]> {
	const surfaces = await getVerifiedSurfaces(arenaId)
	const now = new Date()
	const found: UpcomingGame[] = []
	for (
		let i = 0;
		i < RECENT_RINK_DAYS && found.length < RECENT_RINK_GAMES;
		i++
	) {
		const date = getLeagueDayKey(new Date(now.getTime() - i * DAY))
		const games = await getDayGames(date, teamsPage).catch(
			(error: unknown) => {
				logger.warn("getRink", "scoreboard unavailable", {date, error})
				return []
			},
		)
		found.push(
			...games.filter((g) => g.rink.arenaId === arenaId && g.game.score),
		)
	}
	return found
		.sort((a, b) => b.game.startsAt.localeCompare(a.game.startsAt))
		.slice(0, RECENT_RINK_GAMES)
		.map(({game}) => ({
			game,
			livebarn: toLiveBarnLinks(
				surfaces,
				getLeagueLocalTime(game.startsAt),
			),
		}))
}

registerEndpoint(app, GET_RINK_ENDPOINT, async ({arenaId}) => {
	if (!KHL_ARENA_LIVEBARN_SURFACES[arenaId]) {
		throw new ApiError(404, `rink ${arenaId} not found`)
	}
	const teamsPage = await getTeamsPage()
	const [rink, arena, recent] = await Promise.all([
		getRink(arenaId, teamsPage),
		cache.cached(`arena-page:${arenaId}`, 24 * HOUR, () =>
			getKHLArena(arenaId),
		),
		getRecentRinkGames(arenaId, teamsPage),
	])
	const response: RinkResponse = {
		season: teamsPage.season,
		rink,
		address: arena.address,
		recent,
	}
	return response
})

app.use("/api", (req, res, next) => {
	// "/api" itself is the client's API docs page
	if (req.path === "/") {
		next()
		return
	}
	res.status(404).json({error: "not found"})
})

// Serve the built app when it exists (`build`); in dev, Vite serves it.
if (fs.existsSync(DIST_DIR)) {
	app.use(express.static(DIST_DIR))
	app.get("/{*path}", (_req, res) => {
		res.sendFile(path.join(DIST_DIR, "index.html"))
	})
}

app.use(
	(
		error: unknown,
		_req: express.Request,
		res: express.Response,
		_next: express.NextFunction,
	) => {
		logger.error("request", "request failed", {error})
		// 502 when the KHL (or LiveBarn) site failed us; else it's our bug
		res.status(error instanceof FetchError ? 502 : 500).json({
			error: error instanceof Error ? error.message : String(error),
		})
	},
)

app.listen(PORT, () => {
	logger.info("listen", `server listening on http://localhost:${PORT}`, {
		commit: DEPLOY_INFO.commit,
	})
	startStatusChecks(db)
	syncer.start()
})

const PAGE_LOAD_LABELS: Record<PageLoadSource, string> = {
	memory: "from memory",
	stored: "from stored pages",
	fetched: "fetched from the KHL or LiveBarn",
	stale: "stored pages served after a failed fetch",
}

function countPageLoads(log: PageLoad[]): Record<PageLoadSource, number> {
	const counts = {memory: 0, stored: 0, fetched: 0, stale: 0}
	for (const load of log) {
		counts[load.source]++
	}
	return counts
}

function toServerTiming(log: PageLoad[]): string {
	const counts = countPageLoads(log)
	const fetchMs = log.reduce((total, load) => total + load.ms, 0)
	return (Object.keys(counts) as PageLoadSource[])
		.map((source) => {
			const dur = matchValue(source, {
				memory: "",
				stored: "",
				fetched: `;dur=${fetchMs}`,
				stale: "",
			})
			const desc = `${counts[source]} ${PAGE_LOAD_LABELS[source]}`
			return `khl-${source}${dur};desc="${desc}"`
		})
		.join(", ")
}

/** "fetched <url>, memory <key>, ...", capped so the header stays small */
function toPageLoadsHeader(log: PageLoad[]): string {
	const MAX_PAGES = 40
	// Header values must be printable ASCII; player names may not be
	const items = log
		.slice(0, MAX_PAGES)
		.map(
			(load) =>
				`${load.source} ${load.key.replace(/[^\x20-\x7e]/g, "?")}`,
		)
	if (log.length > MAX_PAGES) {
		items.push(`+${log.length - MAX_PAGES} more`)
	}
	return items.join(", ")
}

function logPageLoads(path: string, log: PageLoad[]) {
	const counts = countPageLoads(log)
	if (counts.stored + counts.fetched + counts.stale === 0) {
		return
	}
	logger.info("pageLoads", "loaded pages", {
		path,
		...counts,
		fetchMs: log.reduce((total, load) => total + load.ms, 0),
		pages: log
			.filter((load) =>
				matchValue(load.source, {
					memory: false,
					stored: true,
					fetched: true,
					stale: true,
				}),
			)
			.map((load) => `${load.source} ${load.key}`),
	})
}

/** Also records the season's teams, for names and logos by id */
function getTeamsPage(seasonId?: string): Promise<KHLTeamsPage> {
	const key = `teams:${seasonId ?? "current"}`
	return cache.cached(key, HOUR, async () => {
		const page = await getKHLTeamsPage(seasonId)
		recordTeams(page)
		return page
	})
}

function recordTeams(page: KHLTeamsPage) {
	db.recordTeams(
		page.teams.map((team) => ({
			teamId: team.id,
			seasonId: team.seasonId,
			name: team.name,
			logoUrl: team.logoUrl,
			divisionId: team.divisionId,
		})),
		page.divisions.map((division) => ({
			divisionId: division.id,
			seasonId: division.seasonId,
			name: division.name,
		})),
	)
}

async function getCurrentSeason(): Promise<KHLSeason> {
	return (await getTeamsPage()).season
}

/** Past seasons' pages don't change, so they're kept much longer */
function getSeasonTtl(isCurrentSeason: boolean): number {
	return isCurrentSeason ? 10 * MINUTE : 24 * HOUR
}

function getPlayerCacheKey(
	registrationKey: RegistrationKey,
	seasonId: string,
): string {
	const {khlPlayerId, teamId} = parseRegistrationKey(registrationKey)
	return `player:${khlPlayerId}:${teamId}:${seasonId}`
}

/** The player's KHL page as of `seasonId` */
function getPlayer(
	registrationKey: RegistrationKey,
	seasonId: string,
	isCurrentSeason: boolean,
) {
	return cache.cached(
		getPlayerCacheKey(registrationKey, seasonId),
		10 * MINUTE,
		() => {
			return getKHLPlayer(registrationKey, seasonId)
		},
		{maxPageAgeMs: getSyncedPageMaxAgeMs(isCurrentSeason)},
	)
}

function getScheduleCacheKey(teamId: string, seasonId: string): string {
	return `schedule:${teamId}:${seasonId}`
}

function getSchedule(
	teamId: string,
	seasonId: string,
	isCurrentSeason: boolean,
): Promise<KHLGame[]> {
	return cache.cached(
		getScheduleCacheKey(teamId, seasonId),
		getSeasonTtl(isCurrentSeason),
		() => {
			return getKHLTeamSchedule(teamId, seasonId)
		},
		{maxPageAgeMs: getSyncedPageMaxAgeMs(isCurrentSeason)},
	)
}

function getTeamStats(
	teamId: string,
	seasonId: string,
	isCurrentSeason: boolean,
): Promise<KHLTeamStats> {
	return cache.cached(
		`team-stats:${teamId}:${seasonId}`,
		getSeasonTtl(isCurrentSeason),
		() => getKHLTeamStats(teamId, seasonId),
		{maxPageAgeMs: getSyncedPageMaxAgeMs(isCurrentSeason)},
	)
}

/** Finished games between two teams, newest first. */
async function getHeadToHead(
	awayStats: KHLTeamStats,
	homeStats: KHLTeamStats,
	currentSeasonId: string,
	options: {
		/** The game being previewed, which isn't its own head-to-head */
		excludeGameId?: string
		/** Searched even if they're older than the most recent shared seasons */
		includeSeasonIds?: string[]
	} = {},
): Promise<HeadToHeadGame[]> {
	const {excludeGameId, includeSeasonIds = []} = options
	const awayId = awayStats.teamId
	const homeId = homeStats.teamId
	const homeSeasonIds = new Set(homeStats.seasons.map((s) => s.id))
	// Both lists are newest first
	const sharedSeasons = awayStats.seasons
		.filter((s) => homeSeasonIds.has(s.id))
		.filter((s, i) => {
			return (
				i < LIMITS.HEAD_TO_HEAD_SEASONS ||
				includeSeasonIds.includes(s.id)
			)
		})
	const schedules = await Promise.all(
		sharedSeasons.map(async (season) => {
			try {
				return await getSchedule(
					awayId,
					season.id,
					season.id === currentSeasonId,
				)
			} catch (error) {
				logger.warn("getHeadToHead", "KHL schedule unavailable", {
					teamId: awayId,
					seasonId: season.id,
					error,
				})
				return []
			}
		}),
	)
	const games = schedules
		.flat()
		.filter((game) => {
			return (
				game.opponent.id === homeId &&
				game.isFinal &&
				game.id !== excludeGameId
			)
		})
		.sort((a, b) => b.startsAt.localeCompare(a.startsAt))
	const surfacesByArena = await getSurfacesByArena(
		games.map((g) => g.arena?.id ?? null),
	)
	return games.map((game) => {
		const surfaces = game.arena
			? (surfacesByArena.get(game.arena.id) ?? [])
			: []
		return toHeadToHeadGame(game, toLiveBarnLinks(surfaces, game))
	})
}

function toHeadToHeadGame(
	game: KHLGame,
	livebarn: LiveBarnLink[],
): HeadToHeadGame {
	return {
		gameId: game.id,
		seasonId: game.seasonId,
		startsAt: game.startsAt,
		arena: toDisplayArena(game.arena),
		homeTeamId: matchValue(game.homeAway, {
			home: game.team.id,
			away: game.opponent.id,
		}),
		goals: getGoalsByTeam(game),
		livebarn,
	}
}

/**
 * A team's season going into a game, from its schedule. Null if the KHL site
 * fails: the game page shows without it.
 */
async function getGameSeasonSummary(
	team: KHLBoxScoreTeam,
	startsAt: string,
	currentSeasonId: string,
): Promise<SeasonSummary | null> {
	try {
		const [teamsPage, schedule] = await Promise.all([
			getTeamsPage(team.seasonId),
			getSchedule(
				team.id,
				team.seasonId,
				team.seasonId === currentSeasonId,
			),
		])
		const listed = findListedTeam(teamsPage, team.id)
		return {
			team: listed ?? {
				id: team.id,
				name: team.name,
				seasonId: team.seasonId,
				divisionId: "",
				logoUrl: team.logoUrl,
			},
			season: teamsPage.season,
			divisionName: getListedDivisionName(teamsPage, team.id) ?? "",
			// For a past game, its season going in rather than what came after
			...getSeasonRecord(
				schedule.filter((game) => game.startsAt < startsAt),
			),
		}
	} catch (error) {
		logger.warn("getGameSeasonSummary", "KHL schedule unavailable", {
			teamId: team.id,
			seasonId: team.seasonId,
			error,
		})
		return null
	}
}

type SeasonRecord = Pick<
	MatchupTeam,
	| "gamesPlayed"
	| "wins"
	| "losses"
	| "ties"
	| "goalsFor"
	| "goalsAgainst"
	| "recent"
	| "streak"
>

/** Record, goals, and form from a team's schedule (oldest first). */
function getSeasonRecord(schedule: KHLGame[]): SeasonRecord {
	const record: SeasonRecord = {
		gamesPlayed: 0,
		wins: 0,
		losses: 0,
		ties: 0,
		goalsFor: 0,
		goalsAgainst: 0,
		recent: [],
		streak: null,
	}
	const results: RecentGame[] = []
	for (const game of schedule) {
		const recent = toRecentGame({
			...game,
			arena: toDisplayArena(game.arena),
		})
		if (!recent) {
			continue
		}
		record.gamesPlayed += 1
		record.goalsFor += recent.goalsFor
		record.goalsAgainst += recent.goalsAgainst
		if (recent.result === "W") {
			record.wins += 1
		} else if (recent.result === "L") {
			record.losses += 1
		} else {
			record.ties += 1
		}
		results.push(recent)
	}
	record.recent = results.slice(-LIMITS.MATCHUP_RECENT_GAMES)
	const last = results.at(-1)?.result
	if (last) {
		let count = 0
		while (results[results.length - 1 - count]?.result === last) {
			count += 1
		}
		record.streak = {result: last, count}
	}
	return record
}

function getGameStats(gameId: string): Promise<KHLGameStats> {
	// Like box scores: check again soon until the lineups are posted
	return cache.cached(
		`game-stats:${gameId}`,
		10 * MINUTE,
		() => {
			return getKHLGameStats(gameId)
		},
		{
			getTtlMs: (stats) => {
				const isPosted =
					stats.away.skaters.length + stats.home.skaters.length > 0
				return isPosted ? 6 * HOUR : 10 * MINUTE
			},
		},
	)
}

function getBoxScore(gameId: string): Promise<KHLBoxScore> {
	// Summaries are posted (and sometimes corrected) after the game, so check
	// again soon until there's one; after that, corrections are rare
	return cache.cached(
		`box-score:${gameId}`,
		10 * MINUTE,
		() => {
			return getKHLBoxScore(gameId)
		},
		{
			getTtlMs: (boxScore) =>
				boxScore.hasSummary ? 6 * HOUR : 10 * MINUTE,
		},
	)
}

/**
 * Records everyone named in the box score so they link to player pages.
 * Returns our player UUID for each KHL player id.
 */
function recordBoxScorePlayers(boxScore: KHLBoxScore): Map<string, string> {
	const teams = new Map<string, KHLBoxScoreTeam>(
		[boxScore.away, boxScore.home].map((t) => [t.id, t]),
	)
	const entries = [
		...boxScore.goals.flatMap((g) => {
			return [g.scorer, ...g.assists].map((player) => ({
				player,
				teamId: g.teamId,
			}))
		}),
		...boxScore.penalties.flatMap((p) => {
			return p.player ? [{player: p.player, teamId: p.teamId}] : []
		}),
	]
	return db.recordRegistrations(
		entries.flatMap(({player, teamId}) => {
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
		}),
	)
}

function getMappedArenaName(arena: ArenaMapping): string {
	return arena.displayName ?? arena.khlArenaName
}

/** A KHL arena with its LiveBarn surfaces and upcoming league games. */
async function getRink(
	arenaId: string,
	teamsPage: KHLTeamsPage,
): Promise<Rink> {
	const [info, leagueGames] = await Promise.all([
		getRinkInfo(arenaId),
		getLeagueSchedule(),
	])
	return {
		...info,
		games: leagueGames
			.filter((g) => g.arena?.id === arenaId)
			.map((g) => toRinkGame(g, teamsPage)),
	}
}

/** A day's games from the league's scoreboard, "yyyy-MM-dd" */
function getScoreboard(date: string): Promise<KHLScoreboardGame[]> {
	// A finished day's scores only change when the league corrects one
	const isPast = date < getLeagueDayKey(new Date())
	return cache.cached(`scoreboard:${date}`, isPast ? HOUR : 5 * MINUTE, () =>
		getKHLScoreboard(date),
	)
}

/**
 * The game's final score. The scoreboard often has it before the league
 * posts the box score's summary.
 */
async function getFinalScore(
	boxScore: KHLBoxScore,
): Promise<{away: number; home: number} | null> {
	const {away, home} = boxScore
	if (boxScore.hasSummary && away.goals !== null && home.goals !== null) {
		return {away: away.goals, home: home.goals}
	}
	if (Date.parse(boxScore.startsAt) > Date.now()) {
		return null
	}
	const scoreboard = await getScoreboard(boxScore.localDate).catch(
		(error: unknown) => {
			logger.warn("getGame", "KHL scoreboard unavailable", {
				date: boxScore.localDate,
				error,
			})
			return []
		},
	)
	const game = scoreboard.find((g) => g.gameId === boxScore.gameId)
	if (
		!game?.isFinal ||
		game.away.goals === null ||
		game.home.goals === null
	) {
		return null
	}
	return {away: game.away.goals, home: game.home.goals}
}

/** A rink we track, or a bare one for rinks off our list (or not set) */
async function getRinkInfoOrFallback(
	arena: {id: string; name: string} | null,
	/** The name when there's no arena at all */
	missingName = "Unknown rink",
): Promise<RinkInfo> {
	if (arena && KHL_ARENA_LIVEBARN_SURFACES[arena.id]) {
		return getRinkInfo(arena.id)
	}
	return {
		arenaId: arena?.id ?? "",
		name: arena ? getArenaName(arena) : missingName,
		city: "",
		livebarn: [],
	}
}

function findListedTeam(
	teamsPage: KHLTeamsPage,
	teamId: string,
): KHLTeam | undefined {
	return teamsPage.teams.find((t) => t.id === teamId)
}

/** The team's division in the page's season, if the teams page lists it */
function getListedDivisionName(
	teamsPage: KHLTeamsPage,
	teamId: string,
): string | null {
	const listed = findListedTeam(teamsPage, teamId)
	return listed ? getDivisionName(teamsPage, listed.divisionId) : null
}

async function getRinkInfo(arenaId: string): Promise<RinkInfo> {
	const surfaces = await getVerifiedSurfaces(arenaId)
	return {
		arenaId,
		name: getMappedArenaName(KHL_ARENA_LIVEBARN_SURFACES[arenaId]!),
		city: KHL_ARENA_LIVEBARN_SURFACES[arenaId]!.city,
		livebarn: surfaces.map((s) => ({
			surfaceId: s.surfaceId,
			surfaceName: s.surfaceName,
			liveUrl: getLiveBarnLiveUrl(s.surfaceId),
		})),
	}
}

/** League-wide upcoming games, soonest first. */
async function getLeagueSchedule(): Promise<KHLLeagueGame[]> {
	const games = await cache.cached(
		"league-schedule",
		5 * MINUTE,
		getKHLLeagueSchedule,
	)
	return [...games].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

function toRinkGame(game: KHLLeagueGame, teamsPage: KHLTeamsPage): RinkGame {
	const toRinkTeam = (team: KHLLeagueTeam): RinkTeam => ({
		...team,
		divisionName: getListedDivisionName(teamsPage, team.id),
	})
	return {
		gameId: game.id,
		startsAt: game.startsAt,
		homeTeam: toRinkTeam(game.homeTeam),
		awayTeam: toRinkTeam(game.awayTeam),
	}
}

/** League-schedule games involving any of `teamIds`, as game cards. */
async function getUpcomingGames(teamIds: Set<string>): Promise<UpcomingGame[]> {
	if (teamIds.size === 0) {
		return []
	}
	const [teamsPage, leagueGames] = await Promise.all([
		getTeamsPage(),
		getLeagueSchedule(),
	])
	const games = leagueGames.filter((g) => {
		return teamIds.has(g.homeTeam.id) || teamIds.has(g.awayTeam.id)
	})
	return Promise.all(
		games.map(async (g): Promise<UpcomingGame> => {
			return {
				// Not yet assigned a rink
				rink: await getRinkInfoOrFallback(g.arena, "TBD"),
				game: toRinkGame(g, teamsPage),
			}
		}),
	)
}

/**
 * Who played for each team in a game, with their stats in it. Null if the
 * KHL site fails: the box score shows without it.
 */
async function getGameLineups(
	boxScore: KHLBoxScore,
): Promise<{away: TeamRoster; home: TeamRoster} | null> {
	try {
		const stats = await getGameStats(boxScore.gameId)
		const lineup = (team: KHLBoxScoreTeam, teamStats: KHLGameTeamStats) => {
			return getRoster(team.id, team.name, team.logoUrl, {
				...teamStats,
				seasonId: team.seasonId,
			})
		}
		const [away, home] = await Promise.all([
			lineup(boxScore.away, stats.away),
			lineup(boxScore.home, stats.home),
		])
		return {away, home}
	} catch (error) {
		logger.warn("getGameLineups", "KHL game stats unavailable", {
			gameId: boxScore.gameId,
			error,
		})
		return null
	}
}

/**
 * The team's roster for a season, with each player recorded in the database
 * so they link to a player page.
 */
async function getRoster(
	teamId: string,
	teamName: string,
	teamLogoUrl: string | null,
	stats: Pick<
		KHLTeamStats,
		"seasonId" | "skaterColumns" | "skaters" | "goalieColumns" | "goalies"
	>,
): Promise<TeamRoster> {
	const goalieIds = new Set(stats.goalies.map((g) => g.playerId))
	const playerIds = db.recordRegistrations(
		[...stats.skaters, ...stats.goalies].map((row) => ({
			playerId: row.playerId,
			name: row.name,
			position: goalieIds.has(row.playerId) ? "Goalie" : "Skater",
			teamId,
			teamName,
			teamLogoUrl,
			seasonId: stats.seasonId,
		})),
	)
	const toRosterPlayer = (row: KHLRosterRow): RosterPlayer => ({
		playerId: playerIds.get(row.playerId)!,
		khlPlayerId: row.playerId,
		number: row.number,
		name: row.name,
		stats: row.stats,
	})
	return {
		skaterColumns: stats.skaterColumns,
		// Goalies appear in the skater table too, with empty skater stats
		skaters: stats.skaters
			.filter((row) => !goalieIds.has(row.playerId))
			.map(toRosterPlayer),
		goalieColumns: stats.goalieColumns,
		goalies: stats.goalies.map(toRosterPlayer),
	}
}

function getDivisionName(teamsPage: KHLTeamsPage, divisionId: string): string {
	return teamsPage.divisions.find((d) => d.id === divisionId)?.name ?? ""
}

interface LiveBarnSurfaceEntry {
	venue: LiveBarnVenue
	surface: LiveBarnSurface
}

async function getLiveBarnSurfaces(): Promise<
	Map<number, LiveBarnSurfaceEntry>
> {
	return cache.cached("livebarn:surfaces", 24 * HOUR, async () => {
		const venues = await getLivebarnVenues()
		const surfaces = new Map<number, LiveBarnSurfaceEntry>()
		for (const venue of venues) {
			for (const surface of venue.surfaces) {
				surfaces.set(surface.id, {venue, surface})
			}
		}
		return surfaces
	})
}

async function toFeedGames(
	games: KHLGame[],
	/** For opponent logos */
	teamsPages: KHLTeamsPage[],
): Promise<FeedGame[]> {
	const surfacesByArena = await getSurfacesByArena(
		games.map((g) => g.arena?.id ?? null),
	)
	const logos = getTeamLogos(teamsPages)
	return [...games]
		.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
		.map((game) => {
			const surfaces = game.arena
				? (surfacesByArena.get(game.arena.id) ?? [])
				: []
			return {
				game: {...game, arena: toDisplayArena(game.arena)},
				opponentLogoUrl: logos.get(game.opponent.id) ?? null,
				livebarn: toLiveBarnLinks(surfaces, game),
			}
		})
}

/** Verified LiveBarn surfaces for each arena the games were played at. */
async function getSurfacesByArena(
	arenaIds: (string | null)[],
): Promise<Map<string, LiveBarnSurfaceMapping[]>> {
	const uniqueIds = [...new Set(arenaIds.flatMap((id) => id ?? []))]
	return new Map(
		await Promise.all(
			uniqueIds.map(async (arenaId) => {
				return [arenaId, await getVerifiedSurfaces(arenaId)] as const
			}),
		),
	)
}

/** Live and replay links for a game on each of its arena's surfaces. */
function toLiveBarnLinks(
	surfaces: LiveBarnSurfaceMapping[],
	game: {localDate: string; localTime: string},
): LiveBarnLink[] {
	return surfaces.map((surface): LiveBarnLink => {
		return {
			...surface,
			liveUrl: getLiveBarnLiveUrl(surface.surfaceId),
			// KHL and every mapped venue are on Pacific time, so the
			// league-local start time is also venue-local.
			vodUrl: getLiveBarnVodUrl(
				surface.surfaceId,
				game.localDate,
				game.localTime,
			),
		}
	})
}

/**
 * Team logos by id, from teams pages the caller already has (schedule rows
 * don't carry logos). Fetching a page per season of a long player history
 * would trip the KHL site's 403s, so teams missing from these pages (e.g.
 * folded ones) just show initials. Earlier pages win.
 */
function getTeamLogos(teamsPages: KHLTeamsPage[]): Map<string, string> {
	const logos = new Map<string, string>()
	for (const page of teamsPages) {
		for (const team of page.teams) {
			if (team.logoUrl && !logos.has(team.id)) {
				logos.set(team.id, team.logoUrl)
			}
		}
	}
	return logos
}

/**
 * The arena's mapped LiveBarn surfaces, keeping only those whose names still
 * match on both sites. Never throws: a failed check just means no links.
 */
async function getVerifiedSurfaces(
	arenaId: string,
): Promise<LiveBarnSurfaceMapping[]> {
	try {
		return await cache.cached(`arena:${arenaId}`, 24 * HOUR, () =>
			verifyArenaMapping(arenaId),
		)
	} catch (error) {
		logger.error("getVerifiedSurfaces", "could not verify arena", {
			arenaId,
			error,
		})
		return []
	}
}

async function verifyArenaMapping(
	arenaId: string,
): Promise<LiveBarnSurfaceMapping[]> {
	const mapping = KHL_ARENA_LIVEBARN_SURFACES[arenaId]
	if (!mapping) {
		const arena = await getKHLArena(arenaId)
		logger.warn("verifyArenaMapping", "arena has no LiveBarn mapping", {
			arena,
		})
		return []
	}

	const arena = await getKHLArena(arenaId)
	if (arena.name !== mapping.khlArenaName) {
		logger.error("verifyArenaMapping", "KHL arena name changed", {
			arenaId,
			expected: mapping.khlArenaName,
			actual: arena.name,
		})
		return []
	}

	const surfaces = await getLiveBarnSurfaces()
	return mapping.livebarnSurfaces.filter((expected) => {
		const actual = surfaces.get(expected.surfaceId)
		const matches =
			actual?.venue.name === expected.venueName &&
			actual.surface.name === expected.surfaceName
		if (!matches) {
			logger.error("verifyArenaMapping", "LiveBarn surface changed", {
				arenaId,
				expected,
				actual: actual
					? {
							venueName: actual.venue.name,
							surfaceName: actual.surface.name,
						}
					: null,
			})
		}
		return matches
	})
}
