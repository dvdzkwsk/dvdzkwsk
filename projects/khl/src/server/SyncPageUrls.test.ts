import {afterEach, describe, expect, test} from "bun:test"
import {
	getKHLBoxScore,
	getKHLGameStats,
	getKHLPlayer,
	getKHLTeamSchedule,
	getKHLTeamsPage,
	getKHLTeamStats,
} from "./KHL.js"
import {getSyncPageUrl, SyncPage} from "./KHLSyncer.js"
import {toRegistrationKey} from "../shared/ApiJson.js"

const realFetch = globalThis.fetch

/** The URL `load` fetches, from a stubbed fetch that then fails */
const getFetchedUrl = async (load: () => Promise<unknown>) => {
	const urls: string[] = []
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		urls.push(input.toString())
		return new Response("unavailable", {status: 500})
	}) as typeof fetch
	await load().catch(() => {})
	return urls[0]
}

/**
 * The syncer decides whether a page is due by the URL it's stored under, so
 * each page's URL must be the one its getter fetches. If they drifted, every
 * walk would refetch every page.
 */
describe("getSyncPageUrl", () => {
	afterEach(() => {
		globalThis.fetch = realFetch
	})

	const registrationKey = toRegistrationKey({
		khlPlayerId: "428254",
		teamId: "3452",
	})
	const cases: [SyncPage, () => Promise<unknown>][] = [
		[{kind: "teams", seasonId: "2143"}, () => getKHLTeamsPage("2143")],
		[
			{kind: "schedule", teamId: "3452", seasonId: "2143"},
			() => getKHLTeamSchedule("3452", "2143"),
		],
		[
			{kind: "team-stats", teamId: "3452", seasonId: "2143"},
			() => getKHLTeamStats("3452", "2143"),
		],
		[
			{kind: "player", registrationKey, seasonId: "2143"},
			() => getKHLPlayer(registrationKey, "2143"),
		],
		[{kind: "game", gameId: "56994"}, () => getKHLBoxScore("56994")],
	]
	for (const [page, load] of cases) {
		test(`a ${page.kind} page is stored under the URL it's fetched from`, async () => {
			expect(await getFetchedUrl(load)).toBe(getSyncPageUrl(page))
		})
	}

	test("a game's stats page is fetched from its own URL", async () => {
		expect(await getFetchedUrl(() => getKHLGameStats("56994"))).toBe(
			"https://krakenhockeyleague.com/game/56994/team-stats",
		)
	})
})
