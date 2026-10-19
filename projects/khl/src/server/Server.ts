import * as fs from "fs"
import * as path from "path"
import {ConsoleTransport, Logger, setLoggerTransports} from "@dvdzkwsk/logger"
import {ApiError, registerEndpoint} from "@dvdzkwsk/util/ApiServerUtil"
import {sleep} from "@dvdzkwsk/util/AsyncUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import {matchFn, matchField, matchValue} from "@dvdzkwsk/util/MatchUtil"
import compression from "compression"
import express from "express"
import {z} from "zod"
import {
	ArenaMapping,
	getArenaName,
	KHL_ARENA_LIVEBARN_SURFACES,
	LiveBarnSurfaceMapping,
	toDisplayArena,
} from "./Arenas.js"
import {KHLCache} from "./Cache.js"
import {openDatabase, Player, Registration} from "./Database.js"
import {
	compareRegistration,
	diffJson,
	reconcileRegistration,
	toIntegrityRecord,
} from "./Integrity.js"
import {
	getKHLArena,
	getKHLGamePreviewStats,
	getKHLLeagueSchedule,
	getKHLPlayer,
	getKHLPlayerSearchUrl,
	getKHLPlayerUrl,
	getKHLScoreboard,
	getKHLStandings,
	getKHLTeamSchedule,
	KHL_ALL_SEASONS,
	searchKHLPlayers,
} from "./KHL.js"
import {KHLSyncer} from "./KHLSyncer.js"
import {GameRecord, GameRecordTeam, RosterStatRow} from "./LeagueDatabase.js"
import {getLivebarnVenues} from "./LiveBarn.js"
import {
	isOfflineMode,
	openPageStore,
	PageLoad,
	PageLoadSource,
	setOfflineMode,
	setPageStore,
	withPageLoadLog,
} from "./PageStore.js"
import {DEPLOY_INFO, getStatus, startStatusChecks} from "./Status.js"
import {getSyncPageUrl, SyncPage} from "./SyncPages.js"
import {
	ActivityAttendance,
	ActivityEvent,
	ActivityGame,
	ActivityKind,
	ActivityResponse,
	CacheCheckResponse,
	CHECK_CACHE_ENDPOINT,
	DEFAULT_ACTIVITY_KINDS,
	DevSettings,
	DevSettingsResponse,
	DevSettingsSchema,
	FeedGame,
	GameResponse,
	GamesResponse,
	GET_CACHE_ENTRY_ENDPOINT,
	GET_DEV_SETTINGS_ENDPOINT,
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
	PULL_PROD_DATA_ENDPOINT,
	PulledDatabase,
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
	UPDATE_DEV_SETTINGS_ENDPOINT,
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
	KHLGameTeamStats,
	KHLHomeAway,
	KHLLeagueGame,
	KHLLeagueTeam,
	KHLPlayer,
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
const pageStore = openPageStore(SOURCES_DB_PATH)
setPageStore(pageStore)

const app = express()

// Parsed pages the syncer doesn't keep (standings, scoreboards, previews,
// arenas, LiveBarn), in memory
const cache = new KHLCache()
// Keeps the league's tables in sync with the KHL; endpoints read the tables
const syncer = new KHLSyncer(db)
// The background loop crawls the whole league, so dev runs it only when
// asked (KHL_SYNC=1). Without it, a page still syncs when it's first viewed.
const SYNC_LOOP =
	process.env.NODE_ENV === "production" || process.env.KHL_SYNC === "1"
// Dev settings toggled from /admin, in a file so they survive the restart
// `bun --watch` makes on every edit
const DEV_SETTINGS_PATH = path.join(PROJECT_DIR, "data/dev-settings.json")

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

if (process.env.NODE_ENV !== "production") {
	setOfflineMode(readDevSettings().offline)
	const toDevSettingsResponse = (): DevSettingsResponse => ({
		offline: isOfflineMode(),
		syncLoop: SYNC_LOOP,
	})
	registerEndpoint(app, GET_DEV_SETTINGS_ENDPOINT, async () =>
		toDevSettingsResponse(),
	)
	registerEndpoint(app, UPDATE_DEV_SETTINGS_ENDPOINT, async (settings) => {
		fs.mkdirSync(path.dirname(DEV_SETTINGS_PATH), {recursive: true})
		fs.writeFileSync(
			DEV_SETTINGS_PATH,
			JSON.stringify(settings, null, "\t"),
		)
		setOfflineMode(settings.offline)
		logger.info("updateDevSettings", "updated dev settings", settings)
		return toDevSettingsResponse()
	})

	// Fly's CLI isn't in the deployed image either; imported like the
	// benchmark below, to keep it out of the bundle
	let pullRunning = false
	registerEndpoint(app, PULL_PROD_DATA_ENDPOINT, async ({sources}) => {
		if (pullRunning) {
			throw new ApiError(409, "a pull is already running")
		}
		pullRunning = true
		const start = Date.now()
		const dir = path.join(path.dirname(DB_PATH), "prod-snapshots")
		try {
			const pullPath = path.join(PROJECT_DIR, "tools/PullProdData.ts")
			const {downloadProdSnapshots} = (await import(
				pullPath
			)) as typeof import("../../tools/PullProdData.js")
			const downloaded = await downloadProdSnapshots(
				sources ? ["khl", "sources"] : ["khl"],
				dir,
			)
			const pulled: PulledDatabase[] = []
			const backupPath = `${DB_PATH}.bak`
			if (downloaded.khl) {
				pulled.push({name: "khl", mb: getSizeMb(downloaded.khl)})
				db.replaceWith(downloaded.khl, backupPath)
			}
			if (downloaded.sources) {
				pulled.push({
					name: "sources",
					mb: getSizeMb(downloaded.sources),
				})
				pageStore.replaceWith(downloaded.sources)
			}
			// Parsed from the pages just replaced
			cache.clear()
			logger.info("pullProdData", "pulled production's data", {pulled})
			return {pulled, backupPath, ms: Date.now() - start}
		} finally {
			fs.rmSync(dir, {recursive: true, force: true})
			pullRunning = false
		}
	})

	// Drives headless Chrome, which the deployed image doesn't have.
	// Imported by path at request time so puppeteer stays out of the bundle.
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
	// The one place a request records registrations: searches aren't stored
	// or synced, and a player found here needs a UUID to link to. The
	// syncer's rosters record the same players as it reaches them.
	const playerIds = db.recordRegistrations(registrations, "search")
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
					return await getPlayer(toRegistrationKey(r), seasonId)
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
	for (const key of keys) {
		await getInspectableEntry(key).reload()
	}
	logger.info("reloadIntegrity", "reloaded KHL pages", {playerId, keys})
	return getPlayerIntegrity(player)
})

registerEndpoint(app, RESYNC_PLAYER_ENDPOINT, async ({playerId}) => {
	return getPlayerIntegrity(getStoredPlayer(playerId), {apply: true})
})

/**
 * What an integrity report lists, by its key: a player's name search (in
 * the memory cache), or a player page or schedule (synced into the league
 * tables)
 */
interface InspectableEntry {
	info: Pick<IntegrityCacheEntry, "cachedAt" | "expiresAt">
	/** What we have; null if nothing yet */
	read: () => Promise<unknown>
	/** The KHL's page now, without keeping it */
	fetchFresh: () => Promise<unknown>
	/** Fetches the page again and keeps it */
	reload: () => Promise<void>
}

function getInspectableEntry(key: string): InspectableEntry {
	const [prefix, ...ids] = key.split(":")
	const fromSync = (
		page: SyncPage,
		read: () => unknown,
		fetchFresh: () => Promise<unknown>,
	): InspectableEntry => {
		const queued = db.league.getQueueInfo(getSyncPageUrl(page))
		const toIso = (at: number | null | undefined) =>
			at ? new Date(at).toISOString() : null
		return {
			info: {
				cachedAt: toIso(queued?.syncedAt),
				expiresAt: toIso(queued?.nextAt),
			},
			read: async () => (queued?.syncedAt ? read() : null),
			fetchFresh,
			reload: () => syncer.sync(page, true),
		}
	}
	if (prefix === "player" && ids.length === 3) {
		const [khlPlayerId, teamId, seasonId] = ids as [string, string, string]
		const registrationKey = toRegistrationKey({khlPlayerId, teamId})
		return fromSync(
			{kind: "player", registrationKey, seasonId},
			() => db.league.getPlayerProfile(registrationKey, seasonId),
			() => getKHLPlayer(registrationKey, seasonId, {store: false}),
		)
	}
	if (prefix === "schedule" && ids.length === 2) {
		const [teamId, seasonId] = ids as [string, string]
		return fromSync(
			{kind: "schedule", teamId, seasonId},
			() => db.league.getSchedule(teamId, seasonId),
			() => getKHLTeamSchedule(teamId, seasonId, {store: false}),
		)
	}
	if (prefix === "history") {
		const entry = cache.getLoadedEntry(key)
		return {
			info: cache.getInfo(key) ?? {cachedAt: null, expiresAt: null},
			read: async () => (entry ? await entry.value : null),
			fetchFresh: async () => {
				if (!entry) {
					throw new ApiError(400, `${key} isn't loaded`)
				}
				return entry.load()
			},
			reload: async () => cache.invalidate(key),
		}
	}
	throw new ApiError(400, `cache key ${key} can't be inspected`)
}

registerEndpoint(app, GET_CACHE_ENTRY_ENDPOINT, async ({key}) => {
	const entry = getInspectableEntry(key)
	const value = await entry.read()
	return {
		key,
		...entry.info,
		value: value === null ? null : JsonValueSchema.parse(value),
	}
})

registerEndpoint(
	app,
	CHECK_CACHE_ENDPOINT,
	async ({key}): Promise<CacheCheckResponse> => {
		const checkedAt = new Date().toISOString()
		const entry = getInspectableEntry(key)
		const stored = await entry.read()
		if (stored === null) {
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
		const cachedValue = JsonValueSchema.parse(stored)
		let khl: JsonValue
		try {
			// Deliberately past what's kept: the point is the KHL's page now
			khl = JsonValueSchema.parse(await entry.fetchFresh())
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
		db.recordRegistrations(results, "search")
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
		const profile = await getPlayer(toRegistrationKey(r), latestSeasonId)
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
	return getInspectableEntry(key).info
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
				return await getSchedule(teamId, seasonId)
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
	game: GameRecord
	/** The subject's side */
	side: KHLHomeAway
	attendance: ActivityAttendance
	/** Latest first */
	events: ActivityEvent[]
}

/**
 * The subject's final games from the `lookbackDays` before their latest one
 * that have a requested event or attendance (see ActivityKind), newest first,
 * with at most `maxEvents` events in all. Games are read from the league
 * tables, syncing any that never were (see getGameRecords).
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
	for (const {gameId, event} of db.league.getGameEvents(gameIds, by)) {
		eventsByGame.set(gameId, [...(eventsByGame.get(gameId) ?? []), event])
	}
	const getAttendance = matchField(by, "kind", {
		players: (b) => {
			const dressed = db.league.getDressedGameIds(gameIds, b.khlPlayerIds)
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
			const {team} = await getListedTeam(s.teamId, s.season)
			return {
				games: await getSchedule(team.id, team.seasonId),
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
/**
 * Games from the league tables, syncing any that never were. A game whose
 * pages fail to load is left out. The syncer keeps each game fresh, looking
 * again until its summary and lineups are posted.
 */
async function getGameRecords(
	gameIds: string[],
): Promise<Map<string, GameRecord>> {
	await Promise.all(
		gameIds.map(async (gameId) => {
			try {
				// A game that's failing is left out
				await syncer.ensureSynced({kind: "game", gameId})
			} catch (error) {
				logger.warn("getGameRecords", "game pages unavailable", {
					gameId,
					error,
				})
			}
		}),
	)
	return db.league.getGames(gameIds)
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
	const toActivityTeam = (team: GameRecordTeam) => ({
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
		getSchedule(team.id, team.seasonId),
		getTeamStats(team.id, team.seasonId),
		isCurrentSeason ? getUpcomingGames(new Set([team.id])) : [],
	])
	const response: TeamResponse = {
		team,
		divisionName: getDivisionName(teamsPage, team.divisionId),
		season: teamsPage.season,
		seasons: stats.seasons,
		games: await toFeedGames(schedule, [teamsPage]),
		upcoming,
		roster: getRoster(team.id, stats),
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
		return getTeamStats(team.id, team.seasonId).catch((error: unknown) => {
			logger.warn("getGame", "KHL team stats unavailable", {
				teamId: team.id,
				seasonId: team.seasonId,
				error,
			})
			return null
		})
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
						getRoster(away.id, awayStats),
						getRoster(home.id, homeStats),
					]).then(([away, home]) => ({away, home}))
				: null,
			boxScore.hasSummary ? getGameLineups(boxScore) : null,
			getGameSeasonSummary(away, boxScore.startsAt),
			getGameSeasonSummary(home, boxScore.startsAt),
			// Extras for the comparison; the game shows without them
			getPreviewStats(gameId),
		])
	const response: GameResponse = {
		boxScore: {...boxScore, arena: toDisplayArena(boxScore.arena)},
		previewStats,
		score: await getFinalScore(boxScore),
		playerIds: Object.fromEntries(getBoxScorePlayerIds(boxScore)),
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

// From the league tables the syncer keeps: a request never reads a stats page
registerEndpoint(app, LIST_PLAYERS_ENDPOINT, async ({season}) => {
	const current = await getTeamsPage()
	const seasonId = season ?? current.season.id
	const isListed = [current.season, ...current.seasons].some(
		(s) => s.id === seasonId,
	)
	if (!isListed) {
		throw new ApiError(404, `season ${seasonId} not found`)
	}
	const teamsPage =
		seasonId === current.season.id ? current : await getTeamsPage(seasonId)
	const before = db.league.getSeasonRosters(seasonId)
	const synced = await syncTeamStats(
		teamsPage.teams.filter((team) => !before.has(team.id)),
	)
	const rosters = db.league.getSeasonRosters(seasonId)
	// Teams whose stats page failed, or is still syncing, are left out and
	// listed
	const loaded = teamsPage.teams.filter(
		(team) => rosters.has(team.id) || synced.get(team.id) === "synced",
	)
	// Registered players who haven't played (backups, most goalies) have no
	// stats to compare, and would be a third of the list
	const toRows = (team: KHLTeam, players: RosterPlayer[]) => {
		return players
			.filter((p) => Number(p.stats["GP"]) > 0)
			.map((p) => ({...p, teamId: team.id}))
	}
	const rosterOf = (team: KHLTeam) => {
		const rows = rosters.get(team.id) ?? []
		const toRosterRow = (row: RosterStatRow): KHLRosterRow => ({
			playerId: row.khlPlayerId,
			number: row.number,
			name: row.name,
			stats: row.stats,
		})
		return getRoster(team.id, {
			skaterColumns: [],
			skaters: rows.filter((r) => !r.isGoalie).map(toRosterRow),
			goalieColumns: [],
			goalies: rows.filter((r) => r.isGoalie).map(toRosterRow),
		})
	}
	const response: PlayersResponse = {
		season: teamsPage.season,
		seasons: teamsPage.seasons,
		teams: loaded.map((team) => ({
			team,
			divisionName: getDivisionName(teamsPage, team.divisionId),
		})),
		skaters: loaded.flatMap((team) => toRows(team, rosterOf(team).skaters)),
		goalies: loaded.flatMap((team) => toRows(team, rosterOf(team).goalies)),
		unavailableTeams: teamsPage.teams.filter(
			(team) => synced.get(team.id) === "failed",
		),
		loadingTeams: teamsPage.teams.filter(
			(team) => !rosters.has(team.id) && !synced.has(team.id),
		),
	}
	return response
})

/** How long the players list waits for teams' stats pages to sync */
const PLAYERS_SYNC_WAIT_MS = 3000

/**
 * Syncs the teams' stats pages that never were, waiting up to
 * PLAYERS_SYNC_WAIT_MS. Returns how each one that finished went; the rest
 * keep syncing, so the list fills in on a later load.
 */
async function syncTeamStats(
	teams: KHLTeam[],
): Promise<Map<string, "synced" | "failed">> {
	const outcomes = new Map<string, "synced" | "failed">()
	const syncs = teams.map(async (team) => {
		const page: SyncPage = {
			kind: "team-stats",
			teamId: team.id,
			seasonId: team.seasonId,
		}
		try {
			// False for a page that's failing and waiting to be retried
			const ok = await syncer.ensureSynced(page)
			outcomes.set(team.id, ok ? "synced" : "failed")
		} catch (error) {
			logger.warn("syncTeamStats", "team stats unavailable", {
				page,
				error,
			})
			outcomes.set(team.id, "failed")
		}
	})
	await Promise.race([Promise.all(syncs), sleep(PLAYERS_SYNC_WAIT_MS)])
	return outcomes
}

registerEndpoint(app, LIST_TEAM_SEASONS_ENDPOINT, async ({teamId, season}) => {
	const stats = await getTeamStats(teamId, season)
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
				getTeamStats(teamA.id, teamA.seasonId),
				getTeamStats(teamB.id, teamB.seasonId),
				getSchedule(teamA.id, teamA.seasonId),
				getSchedule(teamB.id, teamB.seasonId),
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
				roster: getRoster(team.id, stats),
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
	if (SYNC_LOOP) {
		syncer.start()
	}
})

function getSizeMb(filepath: string): number {
	return Math.round(fs.statSync(filepath).size / 1e6)
}

/** The settings in DEV_SETTINGS_PATH; all off if there's no file */
function readDevSettings(): DevSettings {
	if (!fs.existsSync(DEV_SETTINGS_PATH)) {
		return {offline: false}
	}
	let json: unknown
	try {
		json = JSON.parse(fs.readFileSync(DEV_SETTINGS_PATH, "utf8"))
	} catch (error) {
		throw logger.newError("readDevSettings", "couldn't read dev settings", {
			path: DEV_SETTINGS_PATH,
			error,
		})
	}
	const result = DevSettingsSchema.safeParse(json)
	if (!result.success) {
		throw logger.newError("readDevSettings", "unexpected dev settings", {
			path: DEV_SETTINGS_PATH,
			issues: z.prettifyError(result.error),
		})
	}
	return result.data
}

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

/**
 * A synced page's data from the league tables, syncing the page first if it
 * never was. A page that's failing and waiting to be retried is a 502, as a
 * failed fetch would be, without fetching it again.
 */
async function readSynced<T>(page: SyncPage, read: () => T | null): Promise<T> {
	if (!(await syncer.ensureSynced(page))) {
		throw new ApiError(
			502,
			"the league's page for this couldn't be loaded; it'll be retried",
		)
	}
	const value = read()
	if (value === null) {
		throw logger.newError("readSynced", "synced page has no records", {
			page,
		})
	}
	return value
}

/** A season's teams page (the current season's by default) */
function getTeamsPage(seasonId?: string): Promise<KHLTeamsPage> {
	return readSynced({kind: "teams", seasonId: seasonId ?? null}, () =>
		db.league.getTeamsPage(seasonId ?? null),
	)
}

async function getCurrentSeason(): Promise<KHLSeason> {
	return (await getTeamsPage()).season
}

/** The integrity report's key for a player's page */
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
): Promise<KHLPlayer> {
	return readSynced({kind: "player", registrationKey, seasonId}, () =>
		db.league.getPlayerProfile(registrationKey, seasonId),
	)
}

/** The integrity report's key for a team's schedule */
function getScheduleCacheKey(teamId: string, seasonId: string): string {
	return `schedule:${teamId}:${seasonId}`
}

function getSchedule(teamId: string, seasonId: string): Promise<KHLGame[]> {
	return readSynced({kind: "schedule", teamId, seasonId}, () =>
		db.league.getSchedule(teamId, seasonId),
	)
}

function getTeamStats(teamId: string, seasonId: string): Promise<KHLTeamStats> {
	return readSynced({kind: "team-stats", teamId, seasonId}, () =>
		db.league.getTeamStats(teamId, seasonId),
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
				return await getSchedule(awayId, season.id)
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
): Promise<SeasonSummary | null> {
	try {
		const [teamsPage, schedule] = await Promise.all([
			getTeamsPage(team.seasonId),
			getSchedule(team.id, team.seasonId),
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

/** A game's stats page; fails if it couldn't be read */
function getGameStats(gameId: string): Promise<KHLGameStats> {
	return readSynced({kind: "game", gameId}, () =>
		db.league.getGameStats(gameId),
	)
}

function getBoxScore(gameId: string): Promise<KHLBoxScore> {
	return readSynced({kind: "game", gameId}, () =>
		db.league.getBoxScore(gameId),
	)
}

/**
 * Our player UUID for each KHL player id the box score names, so they link
 * to player pages. The syncer recorded everyone when it processed the game.
 */
function getBoxScorePlayerIds(boxScore: KHLBoxScore): Map<string, string> {
	const keys = [
		...boxScore.goals.flatMap((g) =>
			[g.scorer, ...g.assists].map((player) =>
				toRegistrationKey({khlPlayerId: player.id, teamId: g.teamId}),
			),
		),
		...boxScore.penalties.flatMap((p) =>
			p.player
				? [
						toRegistrationKey({
							khlPlayerId: p.player.id,
							teamId: p.teamId,
						}),
					]
				: [],
		),
	]
	const playerIds = db.getPlayerIdsByRegistration(keys)
	return new Map(
		[...playerIds].map(([key, playerId]) => [
			parseRegistrationKey(key).khlPlayerId,
			playerId,
		]),
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
			return getRoster(team.id, teamStats)
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
/**
 * A team's roster as a stats page lists it, with each player's UUID. The
 * syncer recorded everyone when it processed the page, so this only reads.
 */
function getRoster(
	teamId: string,
	stats: Pick<
		KHLTeamStats,
		"skaterColumns" | "skaters" | "goalieColumns" | "goalies"
	>,
): TeamRoster {
	const goalieIds = new Set(stats.goalies.map((g) => g.playerId))
	const rows = [...stats.skaters, ...stats.goalies]
	const playerIds = db.getPlayerIdsByRegistration(
		rows.map((row) =>
			toRegistrationKey({khlPlayerId: row.playerId, teamId}),
		),
	)
	const toRosterPlayers = (rows: KHLRosterRow[]): RosterPlayer[] => {
		return rows.flatMap((row) => {
			const playerId = playerIds.get(
				toRegistrationKey({khlPlayerId: row.playerId, teamId}),
			)
			if (!playerId) {
				logger.warn("getRoster", "player not recorded; left out", {
					teamId,
					khlPlayerId: row.playerId,
				})
				return []
			}
			return [
				{
					playerId,
					khlPlayerId: row.playerId,
					number: row.number,
					name: row.name,
					stats: row.stats,
				},
			]
		})
	}
	return {
		skaterColumns: stats.skaterColumns,
		// Goalies appear in the skater table too, with empty skater stats
		skaters: toRosterPlayers(
			stats.skaters.filter((row) => !goalieIds.has(row.playerId)),
		),
		goalieColumns: stats.goalieColumns,
		goalies: toRosterPlayers(stats.goalies),
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
