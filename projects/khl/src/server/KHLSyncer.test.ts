import {afterEach, describe, expect, setSystemTime, test} from "bun:test"
import {KHLSyncer, KHLSyncerSource, SyncGame, SyncPage} from "./KHLSyncer.js"
import {recordPageLoad} from "./PageStore.js"
import {RegistrationKey, toRegistrationKey} from "../shared/ApiJson.js"
import {KHLSeason} from "../shared/KHLJson.js"
import {DAY_MS, HOUR_MS, MINUTE_MS} from "../shared/LeagueTime.js"

const START = new Date("2026-10-18T12:00:00Z").getTime()
const current: KHLSeason = {id: "100", name: "Fall 2026"}
const past: KHLSeason = {id: "96", name: "Summer 2026"}

/**
 * A league of one team per season, with one game each, where each player
 * dressed for every game. Pages are "fetched" by stamping the time.
 */
const createLeague = () => {
	const fetchedAt = new Map<string, number>()
	const fetches: string[] = []
	const failing = new Set<string>()
	const saved = new Set<string>()
	const schedules = new Map<string, SyncGame[]>([
		[
			"11:100",
			[{gameId: "1", startsAt: iso(START - 3 * HOUR_MS), isFinal: true}],
		],
		[
			"22:96",
			[{gameId: "2", startsAt: iso(START - 60 * DAY_MS), isFinal: true}],
		],
	])
	const lineups = new Map<string, string[]>([
		["1", ["501", "502"]],
		["2", ["601"]],
	])
	const teamsBySeason = new Map([
		["100", "11"],
		["96", "22"],
	])
	const rosters = new Map([
		["11:100", ["501", "502"]],
		["22:96", ["601"]],
	])

	const fetch = (page: SyncPage) => {
		const key = JSON.stringify(page)
		if (failing.has(key)) {
			throw new Error("KHL 403")
		}
		fetchedAt.set(key, Date.now())
		fetches.push(key)
		recordPageLoad({source: "fetched", key, ms: 0})
	}
	const read = (page: SyncPage, mustFetch: boolean) => {
		if (mustFetch || !fetchedAt.has(JSON.stringify(page))) {
			fetch(page)
		}
	}
	const source: KHLSyncerSource = {
		getSeasons: async () => ({current, seasons: [current, past]}),
		getFetchedAt: (page) => fetchedAt.get(JSON.stringify(page)) ?? null,
		readTeams: async (seasonId, mustFetch) => {
			read({kind: "teams", seasonId}, mustFetch)
			return [teamsBySeason.get(seasonId)!]
		},
		readSchedule: async (teamId, seasonId, mustFetch) => {
			read({kind: "schedule", teamId, seasonId}, mustFetch)
			return schedules.get(`${teamId}:${seasonId}`) ?? []
		},
		fetchTeamStats: async (teamId, seasonId) => {
			fetch({kind: "team-stats", teamId, seasonId})
		},
		fetchPlayer: async (registrationKey, seasonId) => {
			fetch({kind: "player", registrationKey, seasonId})
		},
		readGame: async (gameId, mustFetch) => {
			read({kind: "game", gameId}, mustFetch)
			saved.add(gameId)
		},
		getGameStatus: (gameId) =>
			saved.has(gameId) ? {isComplete: true} : null,
		getTeamRegistrationKeys: (teamId, seasonId) =>
			(rosters.get(`${teamId}:${seasonId}`) ?? []).map((khlPlayerId) =>
				toRegistrationKey({khlPlayerId, teamId}),
			),
		getLatestDressedGameStarts: (keys) => {
			const latest = new Map<RegistrationKey, string>()
			for (const [teamSeason, games] of schedules) {
				const teamId = teamSeason.split(":")[0]!
				for (const game of games) {
					for (const khlPlayerId of lineups.get(game.gameId!) ?? []) {
						const key = toRegistrationKey({khlPlayerId, teamId})
						if (saved.has(game.gameId!) && keys.includes(key)) {
							const prev = latest.get(key)
							if (!prev || prev < game.startsAt) {
								latest.set(key, game.startsAt)
							}
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
		fetches,
		failing,
		schedules,
		lineups,
		/** Fetches since the last call */
		takeFetches: () => fetches.splice(0),
	}
}

const iso = (ms: number) => new Date(ms).toISOString()
const page = (p: SyncPage) => JSON.stringify(p)

describe("KHLSyncer", () => {
	afterEach(() => {
		setSystemTime()
	})

	test("fetches every page once, current season first", async () => {
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

	test("after a game, fetches the team, its game, and who dressed", async () => {
		setSystemTime(START)
		const league = createLeague()
		const startsAt = iso(START + HOUR_MS)
		league.schedules.set("11:100", [
			...league.schedules.get("11:100")!,
			{gameId: "3", startsAt, isFinal: false},
		])
		league.lineups.set("3", ["501"])
		await league.syncer.syncOnce()
		league.takeFetches()

		// The game ends, settles, and the league marks it final
		setSystemTime(START + 3 * HOUR_MS)
		league.schedules.set(
			"11:100",
			league.schedules
				.get("11:100")!
				.map((g) => (g.gameId === "3" ? {...g, isFinal: true} : g)),
		)
		await league.syncer.syncOnce()
		expect(league.takeFetches().sort()).toEqual(
			[
				page({kind: "schedule", teamId: "11", seasonId: "100"}),
				page({kind: "team-stats", teamId: "11", seasonId: "100"}),
				page({kind: "game", gameId: "3"}),
				page({
					kind: "player",
					registrationKey: toRegistrationKey({
						khlPlayerId: "501",
						teamId: "11",
					}),
					seasonId: "100",
				}),
			].sort(),
		)
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
})
