import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import {afterEach, describe, expect, setSystemTime, test} from "bun:test"
import {openDatabase} from "./Database.js"
import {KHLSyncer, KHLSyncerPages} from "./KHLSyncer.js"
import {isOfflineMode, OfflineError, setOfflineMode} from "./PageStore.js"
import {getSyncPageUrl, SyncPage} from "./SyncPages.js"
import {parseRegistrationKey, toRegistrationKey} from "../shared/ApiJson.js"
import {KHLGame, KHLGameTeamStats} from "../shared/KHLJson.js"
import {DAY_MS, HOUR_MS, MINUTE_MS} from "../shared/LeagueTime.js"

const START = new Date("2026-10-18T12:00:00Z").getTime()
const SEASONS = [
	{id: "100", name: "Fall 2026"},
	{id: "96", name: "Summer 2026"},
]

const iso = (ms: number) => new Date(ms).toISOString()
const url = (page: SyncPage) => getSyncPageUrl(page)

interface Game {
	seasonId: string
	away: string
	home: string
	startsAt: string
	isFinal: boolean
}

/**
 * A fake KHL behind the syncer's page readers, synced into a real database.
 * "Fetching" a page takes `fetchMs` of the clock. A game is posted (its
 * summary and lineups) once it has lineups.
 */
const createLeague = ({fetchMs = 0}: {fetchMs?: number} = {}) => {
	const teamsBySeason = new Map([
		["100", ["11", "12"]],
		["96", ["22", "23"]],
	])
	const games = new Map<string, Game>([
		[
			"1",
			{
				seasonId: "100",
				away: "11",
				home: "12",
				startsAt: iso(START - 3 * HOUR_MS),
				isFinal: true,
			},
		],
		[
			"2",
			{
				seasonId: "96",
				away: "22",
				home: "23",
				startsAt: iso(START - 60 * DAY_MS),
				isFinal: true,
			},
		],
	])
	const rosters = new Map([
		["11:100", ["501", "502"]],
		["12:100", ["511"]],
		["22:96", ["601"]],
		["23:96", ["611"]],
	])
	/** Posted games' lineups, by team */
	const lineups = new Map<string, Map<string, string[]>>([
		[
			"1",
			new Map([
				["11", ["501", "502"]],
				["12", ["511"]],
			]),
		],
		[
			"2",
			new Map([
				["22", ["601"]],
				["23", ["611"]],
			]),
		],
	])

	const fetches: string[] = []
	const stored = new Set<string>()
	const failing = new Set<string>()
	const unparseable = new Set<string>()
	const read = <T>(key: string, fetch: boolean, value: () => T): T => {
		if (isOfflineMode()) {
			if (!stored.has(key)) {
				throw new OfflineError(key)
			}
			return value()
		}
		if (fetch || !stored.has(key)) {
			if (failing.has(key)) {
				throw new FetchError("KHL 403", "GET", key, 403)
			}
			setSystemTime(Date.now() + fetchMs)
			if (!key.endsWith("#stats")) {
				fetches.push(key)
			}
			if (unparseable.has(key)) {
				throw new Error("can't parse")
			}
			stored.add(key)
		}
		return value()
	}
	const team = (id: string, seasonId: string) => ({
		id,
		name: `Team ${id}`,
		logoUrl: null,
		seasonId,
		goalsByPeriod: [],
		goals: null,
		shotsByPeriod: [],
		shots: null,
	})
	const lineup = (ids: string[]): KHLGameTeamStats => ({
		skaterColumns: ["G"],
		skaters: ids.map((id) => ({
			playerId: id,
			number: null,
			name: `Player ${id}`,
			stats: {G: "0"},
		})),
		goalieColumns: [],
		goalies: [],
	})

	const pages: KHLSyncerPages = {
		teams: async (seasonId, fetch) =>
			read(url({kind: "teams", seasonId}), fetch, () => {
				const season = SEASONS.find(
					(s) => s.id === (seasonId ?? "100"),
				)!
				return {
					season,
					seasons: SEASONS,
					divisions: [
						{id: "5", name: "Division 5", seasonId: season.id},
					],
					teams: (teamsBySeason.get(season.id) ?? []).map((id) => ({
						id,
						name: `Team ${id}`,
						seasonId: season.id,
						divisionId: "5",
						logoUrl: null,
					})),
				}
			}),
		schedule: async (teamId, seasonId, fetch) =>
			read(url({kind: "schedule", teamId, seasonId}), fetch, () =>
				[...games]
					.filter(
						([, g]) =>
							g.seasonId === seasonId &&
							(g.away === teamId || g.home === teamId),
					)
					.map(([id, g]): KHLGame => ({
						id,
						seasonId,
						team: {id: teamId, name: `Team ${teamId}`},
						opponent: {
							id: g.away === teamId ? g.home : g.away,
							name: "Opponent",
						},
						homeAway: g.away === teamId ? "away" : "home",
						localDate: "2026-10-18",
						localTime: "05:00",
						startsAt: g.startsAt,
						arena: null,
						result: null,
						score: null,
						isFinal: g.isFinal,
					})),
			),
		teamStats: async (teamId, seasonId, fetch) =>
			read(url({kind: "team-stats", teamId, seasonId}), fetch, () => ({
				teamId,
				seasonId,
				seasons: SEASONS,
				skaterColumns: ["GP"],
				skaters: (rosters.get(`${teamId}:${seasonId}`) ?? []).map(
					(id) => ({
						playerId: id,
						number: null,
						name: `Player ${id}`,
						stats: {GP: "1"},
					}),
				),
				goalieColumns: [],
				goalies: [],
			})),
		player: async (key, seasonId, fetch) =>
			read(
				url({kind: "player", registrationKey: key, seasonId}),
				fetch,
				() => ({
					...parseRegistrationKey(key),
					playerId: parseRegistrationKey(key).khlPlayerId,
					seasonId,
					name: "Player",
					number: null,
					position: null,
					teamLine: null,
					statSections: [],
					seasonTables: [],
				}),
			),
		boxScore: async (gameId, fetch) =>
			read(url({kind: "game", gameId}), fetch, () => {
				const g = games.get(gameId)!
				return {
					gameId,
					localDate: "2026-10-18",
					localTime: "05:00",
					startsAt: g.startsAt,
					arena: null,
					away: team(g.away, g.seasonId),
					home: team(g.home, g.seasonId),
					hasSummary: lineups.has(gameId),
					periods: [],
					goals: [],
					penalties: [],
				}
			}),
		gameStats: async (gameId, fetch) =>
			read(`${url({kind: "game", gameId})}#stats`, fetch, () => {
				const g = games.get(gameId)!
				const posted = lineups.get(gameId)
				return {
					gameId,
					away: lineup(posted?.get(g.away) ?? []),
					home: lineup(posted?.get(g.home) ?? []),
				}
			}),
	}

	const db = openDatabase(":memory:")
	const syncer = new KHLSyncer(db, pages)
	return {
		db,
		syncer,
		teamsBySeason,
		games,
		lineups,
		failing,
		unparseable,
		/** Seeds the queue, as starting does */
		seed: () => syncer.seed(),
		/** Syncs until nothing is due */
		syncAll: async () => {
			while (await syncer.syncNext()) {
				// keep going
			}
		},
		/** Fetches since the last call */
		takeFetches: () => fetches.splice(0),
	}
}

type League = ReturnType<typeof createLeague>

/** Adds a game for team 11, not yet final */
const addGame = (league: League, gameId: string, startsAt: number) => {
	league.games.set(gameId, {
		seasonId: "100",
		away: "11",
		home: "12",
		startsAt: iso(startsAt),
		isFinal: false,
	})
}

const page = {
	teams: (seasonId: string | null) => url({kind: "teams", seasonId}),
	schedule: (teamId: string, seasonId: string) =>
		url({kind: "schedule", teamId, seasonId}),
	stats: (teamId: string, seasonId: string) =>
		url({kind: "team-stats", teamId, seasonId}),
	player: (khlPlayerId: string, teamId: string, seasonId: string) =>
		url({
			kind: "player",
			registrationKey: toRegistrationKey({khlPlayerId, teamId}),
			seasonId,
		}),
	game: (gameId: string) => url({kind: "game", gameId}),
}

describe("KHLSyncer", () => {
	afterEach(() => {
		setSystemTime()
		setOfflineMode(false)
	})

	test("syncs everything once, past seasons' schedules and games aside, then nothing until due", async () => {
		setSystemTime(START)
		const league = createLeague()
		league.seed()
		await league.syncAll()
		const fetches = league.takeFetches()
		expect(fetches.sort()).toEqual(
			[
				page.teams(null),
				page.teams("100"),
				page.teams("96"),
				page.schedule("11", "100"),
				page.schedule("12", "100"),
				page.stats("11", "100"),
				page.stats("12", "100"),
				page.game("1"),
				page.player("501", "11", "100"),
				page.player("502", "11", "100"),
				page.player("511", "12", "100"),
				page.stats("22", "96"),
				page.stats("23", "96"),
				page.player("601", "22", "96"),
				page.player("611", "23", "96"),
			].sort(),
		)
		await league.syncAll()
		expect(league.takeFetches()).toEqual([])
	})

	test("the current season's pages come before past seasons'", async () => {
		setSystemTime(START)
		const league = createLeague()
		league.seed()
		const order: string[] = []
		while (await league.syncer.syncNext()) {
			order.push(...league.takeFetches())
		}
		expect(order[0]).toBe(page.teams(null))
		expect(order.indexOf(page.player("502", "11", "100"))).toBeLessThan(
			order.indexOf(page.stats("22", "96")),
		)
	})

	test("a game that's posted refreshes its team's stats and who dressed", async () => {
		setSystemTime(START)
		const league = createLeague()
		addGame(league, "3", START + HOUR_MS)
		league.seed()
		await league.syncAll()
		league.takeFetches()

		// It ends, settles, and is posted
		setSystemTime(START + 3 * HOUR_MS)
		league.games.get("3")!.isFinal = true
		league.lineups.set(
			"3",
			new Map([
				["11", ["501"]],
				["12", ["511"]],
			]),
		)
		await league.syncAll()
		// Both teams' schedules and stats, and only the players who dressed
		expect(league.takeFetches().sort()).toEqual(
			[
				page.schedule("11", "100"),
				page.schedule("12", "100"),
				page.game("3"),
				page.stats("11", "100"),
				page.stats("12", "100"),
				page.player("501", "11", "100"),
				page.player("511", "12", "100"),
			].sort(),
		)
	})

	test("stats and players wait for a game to be posted, not just to end", async () => {
		setSystemTime(START)
		const league = createLeague()
		addGame(league, "3", START + HOUR_MS)
		league.seed()
		await league.syncAll()
		league.takeFetches()

		// Over, but not posted
		setSystemTime(START + 3 * HOUR_MS)
		league.games.get("3")!.isFinal = true
		await league.syncAll()
		expect(league.takeFetches().sort()).toEqual(
			[
				page.schedule("11", "100"),
				page.schedule("12", "100"),
				page.game("3"),
			].sort(),
		)

		// Posted by the next look, 10 minutes later
		league.lineups.set(
			"3",
			new Map([
				["11", ["501"]],
				["12", ["511"]],
			]),
		)
		setSystemTime(START + 3 * HOUR_MS + 10 * MINUTE_MS)
		await league.syncAll()
		expect(league.takeFetches().sort()).toEqual(
			[
				page.game("3"),
				page.stats("11", "100"),
				page.stats("12", "100"),
				page.player("501", "11", "100"),
				page.player("511", "12", "100"),
			].sort(),
		)
	})

	test("a current-season game that ends during a past season's sync comes first", async () => {
		setSystemTime(START)
		// Every fetch takes 10 minutes, so the past season takes hours
		const league = createLeague({fetchMs: 10 * MINUTE_MS})
		league.teamsBySeason.set("96", ["22", "23", "24", "25", "26", "27"])
		addGame(league, "3", START)
		league.lineups.set(
			"3",
			new Map([
				["11", ["501"]],
				["12", ["511"]],
			]),
		)
		league.games.get("3")!.isFinal = true
		league.seed()
		const order: string[] = []
		while (await league.syncer.syncNext()) {
			order.push(...league.takeFetches())
		}
		expect(order.lastIndexOf(page.game("3"))).toBeLessThan(
			order.indexOf(page.stats("27", "96")),
		)
	})

	test("refreshes on each kind's interval: 6 hours for current schedules, 30 days for past seasons", async () => {
		setSystemTime(START)
		const league = createLeague()
		league.seed()
		await league.syncAll()
		await league.syncer.ensureSynced({
			kind: "schedule",
			teamId: "22",
			seasonId: "96",
		})
		await league.syncAll()
		league.takeFetches()

		setSystemTime(START + 6 * HOUR_MS)
		await league.syncAll()
		const sixHours = league.takeFetches()
		expect(sixHours).toContain(page.schedule("11", "100"))
		expect(sixHours).not.toContain(page.stats("11", "100"))
		expect(sixHours).not.toContain(page.schedule("22", "96"))

		setSystemTime(START + 30 * DAY_MS)
		await league.syncAll()
		expect(league.takeFetches()).toContain(page.schedule("22", "96"))
	})

	test("a past season's schedule is synced only when asked for, and then its games", async () => {
		setSystemTime(START)
		const league = createLeague()
		league.seed()
		await league.syncAll()
		league.takeFetches()

		await league.syncer.ensureSynced({
			kind: "schedule",
			teamId: "22",
			seasonId: "96",
		})
		await league.syncAll()
		expect(league.takeFetches()).toEqual([
			page.schedule("22", "96"),
			page.game("2"),
		])
	})

	test("a failed fetch is retried in 30 minutes, without stopping the rest", async () => {
		setSystemTime(START)
		const league = createLeague()
		league.failing.add(page.stats("11", "100"))
		league.seed()
		await league.syncAll()
		const fetches = league.takeFetches()
		expect(fetches).not.toContain(page.stats("11", "100"))
		expect(fetches).toContain(page.teams("96"))

		league.failing.delete(page.stats("11", "100"))
		setSystemTime(START + 10 * MINUTE_MS)
		await league.syncAll()
		expect(league.takeFetches()).not.toContain(page.stats("11", "100"))

		setSystemTime(START + 30 * MINUTE_MS)
		await league.syncAll()
		expect(league.takeFetches()).toContain(page.stats("11", "100"))
	})

	test("a page that doesn't parse waits for its next refresh", async () => {
		setSystemTime(START)
		const league = createLeague()
		league.unparseable.add(page.stats("11", "100"))
		league.seed()
		await league.syncAll()
		expect(league.takeFetches()).toContain(page.stats("11", "100"))

		setSystemTime(START + HOUR_MS)
		await league.syncAll()
		expect(league.takeFetches()).not.toContain(page.stats("11", "100"))

		setSystemTime(START + DAY_MS)
		await league.syncAll()
		expect(league.takeFetches()).toContain(page.stats("11", "100"))
	})

	test("a visitor's read syncs a page that never was, once", async () => {
		setSystemTime(START)
		const league = createLeague()
		const schedule: SyncPage = {
			kind: "schedule",
			teamId: "11",
			seasonId: "100",
		}
		await league.syncer.ensureSynced(schedule)
		await league.syncer.ensureSynced(schedule)
		expect(league.takeFetches()).toEqual([page.schedule("11", "100")])
		expect(league.db.league.getSchedule("11", "100")).toHaveLength(1)
		// Queued, so the syncer keeps it fresh from here
		expect(
			league.db.league.getQueueInfo(page.schedule("11", "100")),
		).not.toBeNull()
	})

	test("a visitor doesn't retry a page that's failing until it's due", async () => {
		setSystemTime(START)
		const league = createLeague()
		const schedule: SyncPage = {
			kind: "schedule",
			teamId: "11",
			seasonId: "100",
		}
		league.unparseable.add(page.schedule("11", "100"))
		await expect(league.syncer.ensureSynced(schedule)).rejects.toThrow()
		expect(await league.syncer.ensureSynced(schedule)).toBe(false)
		expect(league.takeFetches()).toEqual([page.schedule("11", "100")])
	})

	test("offline, a page that isn't stored is left unsynced, and syncs once back online", async () => {
		setSystemTime(START)
		const league = createLeague()
		const schedule: SyncPage = {
			kind: "schedule",
			teamId: "11",
			seasonId: "100",
		}
		setOfflineMode(true)
		await expect(league.syncer.ensureSynced(schedule)).rejects.toThrow(
			OfflineError,
		)
		expect(league.takeFetches()).toEqual([])

		// Not marked failed, so it isn't left waiting out a retry
		setOfflineMode(false)
		expect(await league.syncer.ensureSynced(schedule)).toBe(true)
		expect(league.takeFetches()).toEqual([page.schedule("11", "100")])
	})

	test("a visitor's request puts unsynced pages first, without fetching them", async () => {
		setSystemTime(START)
		const league = createLeague()
		league.seed()
		const game: SyncPage = {kind: "game", gameId: "2"}
		expect(league.syncer.requestSync([game])).toEqual([game])
		expect(league.takeFetches()).toEqual([])

		// Ahead of the teams page, though the game is from a past season
		expect(await league.syncer.syncNext()).toBe(true)
		expect(league.takeFetches()).toEqual([page.game("2")])
		expect(league.db.league.getGames(["2"]).has("2")).toBe(true)
		expect(league.syncer.requestSync([game])).toEqual([])

		// Once synced, it's back in its place
		await league.syncer.syncNext()
		expect(league.takeFetches()).toEqual([page.teams(null)])
	})

	test("a visitor's request doesn't bring forward a page that's failing", async () => {
		setSystemTime(START)
		const league = createLeague()
		const game: SyncPage = {kind: "game", gameId: "2"}
		league.failing.add(page.game("2"))
		expect(league.syncer.requestSync([game])).toEqual([game])
		expect(await league.syncer.syncNext()).toBe(true)
		expect(league.syncer.requestSync([game])).toEqual([])
		expect(await league.syncer.syncNext()).toBe(false)
	})

	test("pages an older processing built are processed again, without fetching", async () => {
		setSystemTime(START)
		const league = createLeague()
		league.seed()
		await league.syncAll()
		league.takeFetches()

		league.db.league.markSynced(page.schedule("11", "100"), {
			nextAt: START + DAY_MS,
			version: 0,
			now: START,
		})
		expect(await league.syncer.syncNext()).toBe(true)
		expect(league.takeFetches()).toEqual([])
		expect(league.db.league.takeOutdated(1)).toBeNull()
	})
})
