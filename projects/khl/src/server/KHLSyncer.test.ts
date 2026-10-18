import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import {afterEach, describe, expect, setSystemTime, test} from "bun:test"
import {ScheduleGame} from "./GameRecords.js"
import {KHLSyncer, KHLSyncerSource, SyncPage} from "./KHLSyncer.js"
import {recordPageLoad} from "./PageStore.js"
import {RegistrationKey, toRegistrationKey} from "../shared/ApiJson.js"
import {KHLSeason} from "../shared/KHLJson.js"
import {DAY_MS, HOUR_MS, MINUTE_MS} from "../shared/LeagueTime.js"

const START = new Date("2026-10-18T12:00:00Z").getTime()
const current: KHLSeason = {id: "100", name: "Fall 2026"}
const past: KHLSeason = {id: "96", name: "Summer 2026"}

const iso = (ms: number) => new Date(ms).toISOString()
const page = (p: SyncPage) => JSON.stringify(p)

/**
 * A league of one team per season, with one finished game each. "Fetching"
 * a page stamps the time and takes `fetchMs` of it; a page's hash is its
 * content, so refetching an unchanged page keeps it. Games are complete once
 * the league posts them, with the lineups given.
 */
const createLeague = ({fetchMs = 0}: {fetchMs?: number} = {}) => {
	// The league's own pages
	const teamsBySeason = new Map([
		["100", ["11"]],
		["96", ["22"]],
	])
	const schedules = new Map<string, ScheduleGame[]>([
		[
			"11:100",
			[{gameId: "1", startsAt: iso(START - 3 * HOUR_MS), isFinal: true}],
		],
		[
			"22:96",
			[{gameId: "2", startsAt: iso(START - 60 * DAY_MS), isFinal: true}],
		],
	])
	const rosters = new Map([
		["11:100", ["501", "502"]],
		["22:96", ["601"]],
	])
	/** Games the league has posted, with who dressed for which team */
	const posted = new Map<string, Map<string, string[]>>([
		["1", new Map([["11", ["501", "502"]]])],
		["2", new Map([["22", ["601"]]])],
	])

	// What's been stored and recorded
	const fetchedAt = new Map<string, number>()
	const hashes = new Map<string, string>()
	const processed = new Map<string, string>()
	const processCounts = new Map<string, number>()
	const recordedSchedules = new Map<string, ScheduleGame[]>()
	const games = new Map<
		string,
		{completedAt: number | null; lineups: Map<string, string[]>}
	>()
	const fetches: string[] = []
	const failing = new Set<string>()
	/** Pages that fetch fine but don't parse */
	const unparseable = new Set<string>()

	const contentOf = (p: SyncPage): string => {
		const content = {
			teams: () =>
				p.kind === "teams" ? teamsBySeason.get(p.seasonId) : null,
			schedule: () =>
				p.kind === "schedule"
					? schedules.get(`${p.teamId}:${p.seasonId}`)
					: null,
			"team-stats": () =>
				p.kind === "team-stats"
					? rosters.get(`${p.teamId}:${p.seasonId}`)
					: null,
			player: () => p,
			game: () =>
				p.kind === "game" ? [...(posted.get(p.gameId) ?? [])] : null,
		}[p.kind]()
		return JSON.stringify(content ?? null)
	}
	const fetch = (p: SyncPage) => {
		const key = page(p)
		if (failing.has(key)) {
			throw new FetchError("KHL 403", "GET", key, 403)
		}
		setSystemTime(Date.now() + fetchMs)
		if (unparseable.has(key)) {
			fetches.push(key)
			throw new Error("missing time")
		}
		fetchedAt.set(key, Date.now())
		hashes.set(key, contentOf(p))
		fetches.push(key)
		recordPageLoad({source: "fetched", key, ms: 0})
	}
	/** Reads a page, fetching it if `mustFetch` or never fetched, and processes it */
	const read = (p: SyncPage, mustFetch: boolean) => {
		if (mustFetch || !fetchedAt.has(page(p))) {
			fetch(p)
		}
		processed.set(page(p), hashes.get(page(p))!)
		processCounts.set(page(p), (processCounts.get(page(p)) ?? 0) + 1)
	}

	const source: KHLSyncerSource = {
		getSeasons: async () => ({current, seasons: [current, past]}),
		getFetchedAt: (p) => fetchedAt.get(page(p)) ?? null,
		needsProcessing: (p) =>
			p.kind !== "player" &&
			fetchedAt.has(page(p)) &&
			processed.get(page(p)) !== hashes.get(page(p)),
		syncTeams: async (seasonId, mustFetch) => {
			read({kind: "teams", seasonId}, mustFetch)
			return teamsBySeason.get(seasonId)!
		},
		syncSchedule: async (teamId, seasonId, mustFetch) => {
			read({kind: "schedule", teamId, seasonId}, mustFetch)
			recordedSchedules.set(`${teamId}:${seasonId}`, [
				...(schedules.get(`${teamId}:${seasonId}`) ?? []),
			])
		},
		syncTeamStats: async (teamId, seasonId, mustFetch) => {
			read({kind: "team-stats", teamId, seasonId}, mustFetch)
		},
		fetchPlayer: async (registrationKey, seasonId) => {
			fetch({kind: "player", registrationKey, seasonId})
		},
		syncGame: async (gameId, mustFetch) => {
			read({kind: "game", gameId}, mustFetch)
			const lineups = posted.get(gameId)
			const previous = games.get(gameId)
			games.set(gameId, {
				completedAt: lineups
					? (previous?.completedAt ?? Date.now())
					: null,
				lineups: lineups ?? new Map(),
			})
		},
		getSchedule: (teamId, seasonId) =>
			recordedSchedules.get(`${teamId}:${seasonId}`) ?? [],
		getSeasonSchedules: (seasonId) =>
			new Map(
				[...recordedSchedules]
					.filter(([key]) => key.endsWith(`:${seasonId}`))
					.map(([key, games]) => [key.split(":")[0]!, games]),
			),
		getGameStatus: (gameId) => {
			const game = games.get(gameId)
			return game ? {isComplete: game.completedAt !== null} : null
		},
		getTeamLatestCompletedGame: (teamId, seasonId) => {
			const completed = (
				recordedSchedules.get(`${teamId}:${seasonId}`) ?? []
			)
				.map((g) => games.get(g.gameId ?? "")?.completedAt ?? null)
				.filter((at): at is number => at !== null)
			return completed.length > 0 ? Math.max(...completed) : null
		},
		getTeamRegistrationKeys: (teamId, seasonId) =>
			(rosters.get(`${teamId}:${seasonId}`) ?? []).map((khlPlayerId) =>
				toRegistrationKey({khlPlayerId, teamId}),
			),
		getLatestCompletedGames: (keys) => {
			const latest = new Map<RegistrationKey, number>()
			for (const game of games.values()) {
				if (game.completedAt === null) {
					continue
				}
				for (const [teamId, ids] of game.lineups) {
					for (const khlPlayerId of ids) {
						const key = toRegistrationKey({khlPlayerId, teamId})
						if (keys.includes(key)) {
							latest.set(
								key,
								Math.max(
									latest.get(key) ?? 0,
									game.completedAt,
								),
							)
						}
					}
				}
			}
			return latest
		},
		buildPlayerList: async () => {},
		hasPlayerList: () => true,
	}
	return {
		syncer: new KHLSyncer(source),
		unparseable,
		/** A new syncer on the same pages and records, as after a deploy */
		restart: () => new KHLSyncer(source),
		failing,
		schedules,
		posted,
		teamsBySeason,
		processed,
		processCounts,
		/** Fetches since the last call */
		takeFetches: () => fetches.splice(0),
	}
}

type League = ReturnType<typeof createLeague>

/** Adds a game to team 11's schedule */
const addGame = (league: League, game: ScheduleGame) => {
	league.schedules.set("11:100", [...league.schedules.get("11:100")!, game])
}

/** Marks a game on team 11's schedule final */
const markFinal = (league: League, gameId: string) => {
	league.schedules.set(
		"11:100",
		league.schedules
			.get("11:100")!
			.map((g) => (g.gameId === gameId ? {...g, isFinal: true} : g)),
	)
}

const key501 = toRegistrationKey({khlPlayerId: "501", teamId: "11"})

describe("KHLSyncer", () => {
	afterEach(() => {
		setSystemTime()
	})

	test("fetches every page once, current season first, then nothing", async () => {
		setSystemTime(START)
		const league = createLeague()
		expect(await league.syncer.syncOnce()).toBe(11)
		const fetches = league.takeFetches()
		expect(fetches[0]).toBe(page({kind: "teams", seasonId: "100"}))
		expect(fetches.indexOf(page({kind: "game", gameId: "1"}))).toBeLessThan(
			fetches.indexOf(page({kind: "teams", seasonId: "96"})),
		)
		expect(await league.syncer.syncOnce()).toBe(0)
	})

	test("after a game completes, fetches its team, its pages, and who dressed", async () => {
		setSystemTime(START)
		const league = createLeague()
		addGame(league, {
			gameId: "3",
			startsAt: iso(START + HOUR_MS),
			isFinal: false,
		})
		await league.syncer.syncOnce()
		league.takeFetches()

		setSystemTime(START + 3 * HOUR_MS)
		markFinal(league, "3")
		league.posted.set("3", new Map([["11", ["501"]]]))
		await league.syncer.syncOnce()
		expect(league.takeFetches().sort()).toEqual(
			[
				page({kind: "schedule", teamId: "11", seasonId: "100"}),
				page({kind: "game", gameId: "3"}),
				page({kind: "team-stats", teamId: "11", seasonId: "100"}),
				page({
					kind: "player",
					registrationKey: key501,
					seasonId: "100",
				}),
			].sort(),
		)
	})

	test("stats and players wait for the game to complete, not just end", async () => {
		setSystemTime(START)
		const league = createLeague()
		addGame(league, {
			gameId: "3",
			startsAt: iso(START + HOUR_MS),
			isFinal: false,
		})
		await league.syncer.syncOnce()
		league.takeFetches()

		// Ended, but the league hasn't posted it
		setSystemTime(START + 3 * HOUR_MS)
		markFinal(league, "3")
		await league.syncer.syncOnce()
		expect(league.takeFetches().sort()).toEqual(
			[
				page({kind: "schedule", teamId: "11", seasonId: "100"}),
				page({kind: "game", gameId: "3"}),
			].sort(),
		)

		// Posted by the next look, 10 minutes later
		league.posted.set("3", new Map([["11", ["501"]]]))
		setSystemTime(START + 3 * HOUR_MS + 10 * MINUTE_MS)
		await league.syncer.syncOnce()
		expect(league.takeFetches().sort()).toEqual(
			[
				page({kind: "game", gameId: "3"}),
				page({kind: "team-stats", teamId: "11", seasonId: "100"}),
				page({
					kind: "player",
					registrationKey: key501,
					seasonId: "100",
				}),
			].sort(),
		)
	})

	test("a game that finishes during a long walk is refreshed before the walk ends", async () => {
		setSystemTime(START)
		// Every fetch takes 10 minutes, so walking 6 teams takes hours
		const league = createLeague({fetchMs: 10 * MINUTE_MS})
		league.teamsBySeason.set("96", ["22", "23", "24", "25", "26", "27"])
		addGame(league, {gameId: "3", startsAt: iso(START), isFinal: true})
		league.posted.set("3", new Map([["11", ["501"]]]))
		await league.syncer.syncOnce()
		const fetches = league.takeFetches()
		const gameFetch = fetches.lastIndexOf(page({kind: "game", gameId: "3"}))
		expect(gameFetch).toBeGreaterThan(-1)
		expect(gameFetch).toBeLessThan(
			fetches.indexOf(
				page({kind: "schedule", teamId: "27", seasonId: "96"}),
			),
		)
	})

	test("the same holds during the current season's own walk", async () => {
		setSystemTime(START)
		const league = createLeague({fetchMs: 10 * MINUTE_MS})
		league.teamsBySeason.set("100", ["11", "12", "13", "14", "15", "16"])
		addGame(league, {gameId: "3", startsAt: iso(START), isFinal: true})
		league.posted.set("3", new Map([["11", ["501"]]]))
		await league.syncer.syncOnce()
		const fetches = league.takeFetches()
		expect(
			fetches.lastIndexOf(page({kind: "game", gameId: "3"})),
		).toBeLessThan(
			fetches.indexOf(
				page({kind: "schedule", teamId: "16", seasonId: "100"}),
			),
		)
	})

	test("a recheck found between the teams of a walk still happens once idle", async () => {
		setSystemTime(START)
		const league = createLeague({fetchMs: 10 * MINUTE_MS})
		league.teamsBySeason.set("96", ["22", "23", "24", "25", "26", "27"])
		// Ends mid-walk, but isn't posted, so it needs another look
		addGame(league, {gameId: "3", startsAt: iso(START), isFinal: true})
		await league.syncer.syncOnce()
		league.takeFetches()

		league.posted.set("3", new Map([["11", ["501"]]]))
		setSystemTime(Date.now() + 10 * MINUTE_MS)
		await league.syncer.syncOnce()
		expect(league.takeFetches()).toContain(
			page({kind: "game", gameId: "3"}),
		)
	})

	test("after a restart, a stored page whose rows are out of date is processed again, without fetching", async () => {
		setSystemTime(START)
		const league = createLeague()
		await league.syncer.syncOnce()
		// e.g. the records were restored from an older backup
		const stats = page({kind: "team-stats", teamId: "11", seasonId: "100"})
		league.processed.delete(stats)

		setSystemTime(START + MINUTE_MS)
		const before = league.processCounts.get(stats)!
		expect(await league.restart().syncOnce()).toBe(0)
		expect(league.processCounts.get(stats)).toBe(before + 1)
	})

	test("refreshes the current season every 6 hours, past ones every 30 days", async () => {
		setSystemTime(START)
		const league = createLeague()
		await league.syncer.syncOnce()
		league.takeFetches()

		setSystemTime(START + 6 * HOUR_MS)
		await league.syncer.syncOnce()
		const sixHours = league.takeFetches()
		expect(sixHours).toContain(page({kind: "teams", seasonId: "100"}))
		expect(sixHours).not.toContain(page({kind: "teams", seasonId: "96"}))

		setSystemTime(START + 30 * DAY_MS)
		await league.syncer.syncOnce()
		expect(league.takeFetches()).toContain(
			page({kind: "teams", seasonId: "96"}),
		)
	})

	test("a failed page waits to retry, and doesn't stop the walk", async () => {
		setSystemTime(START)
		const league = createLeague()
		const stats = page({kind: "team-stats", teamId: "11", seasonId: "100"})
		league.failing.add(stats)
		await league.syncer.syncOnce()
		const fetches = league.takeFetches()
		expect(fetches).not.toContain(stats)
		expect(fetches).toContain(page({kind: "teams", seasonId: "96"}))

		league.failing.delete(stats)
		setSystemTime(START + 10 * MINUTE_MS)
		await league.syncer.syncOnce()
		expect(league.takeFetches()).toEqual([])

		setSystemTime(START + 30 * MINUTE_MS)
		await league.syncer.syncOnce()
		expect(league.takeFetches()).toEqual([stats])
	})

	test("a page that doesn't parse waits for its next refresh, not a retry", async () => {
		setSystemTime(START)
		const league = createLeague()
		const stats = page({kind: "team-stats", teamId: "11", seasonId: "100"})
		league.unparseable.add(stats)
		await league.syncer.syncOnce()
		expect(league.takeFetches()).toContain(stats)

		setSystemTime(START + HOUR_MS)
		await league.syncer.syncOnce()
		expect(league.takeFetches()).not.toContain(stats)

		setSystemTime(START + 6 * HOUR_MS)
		await league.syncer.syncOnce()
		expect(league.takeFetches()).toContain(stats)
	})
})
