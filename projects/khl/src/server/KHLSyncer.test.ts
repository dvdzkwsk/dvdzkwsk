import {describe, expect, test} from "bun:test"
import {KHLCache} from "./Cache.js"
import {openDatabase} from "./Database.js"
import {getPlayersCacheKey, KHLSyncer} from "./KHLSyncer.js"
import {PlayersResponse, PlayersResponseSchema} from "../shared/ApiJson.js"
import {KHLSeason} from "../shared/KHLJson.js"

const current: KHLSeason = {id: "100", name: "Fall 2026"}
const past: KHLSeason = {id: "96", name: "Summer 2026"}
const older: KHLSeason = {id: "92", name: "Spring 2026"}
const seasons = [current, past, older]

const toPlayers = (season: KHLSeason): PlayersResponse => {
	return {
		season,
		seasons,
		teams: [],
		skaters: [],
		goalies: [],
		unavailableTeams: [],
	}
}

const createSyncer = (loadPlayers = async (s: KHLSeason) => toPlayers(s)) => {
	const loaded: string[] = []
	const cache = new KHLCache(openDatabase(":memory:"))
	const syncer = new KHLSyncer(cache, {
		getSeasons: async () => ({current, seasons}),
		loadPlayers: async (season) => {
			loaded.push(season.id)
			return loadPlayers(season)
		},
	})
	const getCachedPlayers = (season: KHLSeason) => {
		return cache.getValue(
			getPlayersCacheKey(season.id),
			PlayersResponseSchema,
		)
	}
	return {syncer, loaded, getCachedPlayers}
}

/** Syncs until no season is due */
const syncAll = async (syncer: KHLSyncer) => {
	let synced = true
	while (synced) {
		synced = await syncer.syncNext()
	}
}

describe("KHLSyncer", () => {
	test("caches the current season first, then the rest in order", async () => {
		const {syncer, loaded, getCachedPlayers} = createSyncer()
		await syncAll(syncer)
		expect(loaded).toEqual(["100", "96", "92"])
		expect(await getCachedPlayers(current)).toEqual(toPlayers(current))
	})

	test("leaves a fresh list alone", async () => {
		const {syncer, loaded} = createSyncer()
		await syncAll(syncer)
		expect(await syncer.syncNext()).toBe(false)
		expect(loaded).toHaveLength(3)
	})

	test("a failed season waits to retry instead of blocking the rest", async () => {
		const {syncer, loaded, getCachedPlayers} = createSyncer(
			async (season) => {
				if (season.id === past.id) {
					throw new Error("KHL 500")
				}
				return toPlayers(season)
			},
		)
		await syncAll(syncer)
		expect(loaded).toEqual(["100", "96", "92"])
		expect(getCachedPlayers(past)).toBeNull()
		expect(await getCachedPlayers(older)).toEqual(toPlayers(older))
	})
})
