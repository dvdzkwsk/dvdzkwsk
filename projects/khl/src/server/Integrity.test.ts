import {describe, expect, test} from "bun:test"
import {Registration} from "./Database.js"
import {
	compareRegistration,
	diffJson,
	reconcileRegistration,
	toIntegrityRecord,
} from "./Integrity.js"
import {KHLPlayer, KHLPlayerSearchResult} from "../shared/KHLJson.js"

const ours: Registration = {
	khlPlayerId: "428254",
	playerId: "47ce843b-aa32-41ea-b1e6-8ec250126d98",
	name: "Brandon Smith",
	position: "Skater",
	teamId: "3452",
	teamName: "Bullets",
	teamLogoUrl: "https://example.com/bullets.png",
	seasonIds: ["96", "100"],
	updatedAt: "2026-10-15T00:00:00.000Z",
}

const searchRow = (seasonId: string): KHLPlayerSearchResult => {
	return {
		playerId: ours.khlPlayerId,
		name: ours.name,
		position: ours.position,
		teamId: ours.teamId,
		teamName: ours.teamName,
		teamLogoUrl: ours.teamLogoUrl,
		seasonId,
	}
}

const profile = (
	seasons: {seasonId: string; teamId?: string; teamName?: string}[],
	overrides: Partial<KHLPlayer> = {},
): KHLPlayer => {
	return {
		playerId: ours.khlPlayerId,
		teamId: ours.teamId,
		seasonId: "100",
		name: ours.name,
		number: "20",
		position: "Skater",
		teamLine: "Bullets - Division 5B",
		statSections: [],
		seasonTables: [
			{
				title: "Regular Season",
				columns: [],
				rows: seasons.map((s) => ({
					seasonId: s.seasonId,
					seasonName: s.seasonId,
					teamId: s.teamId ?? ours.teamId,
					teamName: s.teamName ?? ours.teamName,
					stats: {},
				})),
			},
		],
		...overrides,
	}
}

describe("compareRegistration", () => {
	test("matching pages have no mismatches", () => {
		expect(
			compareRegistration(
				ours,
				[searchRow("96"), searchRow("100")],
				profile([{seasonId: "96"}, {seasonId: "100"}]),
			),
		).toEqual([])
	})

	test("reports seasons missing from ours and not on the KHL", () => {
		const [mismatch] = compareRegistration(
			ours,
			null,
			profile([{seasonId: "93"}, {seasonId: "96"}]),
		)
		expect(mismatch).toEqual({
			source: "profile",
			field: "seasons",
			ours: "96, 100",
			khl: "93, 96",
			detail: "Missing from ours: 93. Not on the KHL: 100",
		})
	})

	test("reports an id missing from the search", () => {
		expect(compareRegistration(ours, [], null)).toEqual([
			expect.objectContaining({source: "search", field: "listed"}),
		])
	})

	test("compares the latest search row's fields", () => {
		const renamed = {...searchRow("100"), teamName: "Bullets II"}
		expect(
			compareRegistration(ours, [searchRow("96"), renamed], null),
		).toEqual([
			expect.objectContaining({
				source: "search",
				field: "team name",
				ours: "Bullets",
				khl: "Bullets II",
			}),
		])
	})

	test("ignores a search row without a position or logo", () => {
		const row = {...searchRow("100"), position: null, teamLogoUrl: null}
		expect(compareRegistration(ours, [searchRow("96"), row], null)).toEqual(
			[],
		)
	})

	test("compares the profile's name, position, and team line", () => {
		const mismatches = compareRegistration(
			{...ours, position: null},
			null,
			profile([{seasonId: "96"}, {seasonId: "100"}], {
				name: "BRANDON SMITH",
				teamLine: "Seagulls - Division 4C",
			}),
		)
		expect(mismatches.map((m) => [m.field, m.ours, m.khl])).toEqual([
			["name", "Brandon Smith", "BRANDON SMITH"],
			["position", null, "Skater"],
			["team name", "Bullets", "Seagulls"],
		])
	})

	test("ignores seasons on the id's other teams", () => {
		expect(
			compareRegistration(
				ours,
				null,
				profile([
					{seasonId: "96"},
					{seasonId: "100"},
					{seasonId: "100", teamId: "11264", teamName: "Seagulls"},
				]),
			),
		).toEqual([])
	})
})

describe("reconcileRegistration", () => {
	test("returns null when nothing would change", () => {
		expect(
			reconcileRegistration(
				ours,
				[searchRow("96"), searchRow("100")],
				profile([{seasonId: "96"}, {seasonId: "100"}]),
			),
		).toBeNull()
	})

	test("adds a season only the profile page lists", () => {
		const reconciled = reconcileRegistration(
			ours,
			[searchRow("96"), searchRow("100")],
			profile([{seasonId: "93"}, {seasonId: "96"}, {seasonId: "100"}]),
		)
		expect(reconciled?.seasonIds).toEqual(["93", "96", "100"])
		// As the report shows it: stored against expected
		expect(diffJson(toIntegrityRecord(ours), reconciled!)).toEqual([
			{path: "seasonIds", ours: '["96","100"]', khl: '["93","96","100"]'},
		])
	})

	test("drops a season neither page lists when both loaded", () => {
		const reconciled = reconcileRegistration(
			ours,
			[searchRow("100")],
			profile([{seasonId: "100"}]),
		)
		expect(reconciled?.seasonIds).toEqual(["100"])
	})

	test("keeps stored seasons when a page failed", () => {
		expect(reconcileRegistration(ours, [searchRow("100")], null)).toBeNull()
		expect(
			reconcileRegistration(ours, null, profile([{seasonId: "100"}])),
		).toBeNull()
	})

	test("keeps stored seasons when the search doesn't list the id", () => {
		expect(
			reconcileRegistration(ours, [], profile([{seasonId: "100"}])),
		).toBeNull()
	})

	test("takes fields from the latest search row", () => {
		const renamed = {...searchRow("100"), teamName: "Bullets II"}
		expect(
			reconcileRegistration(ours, [searchRow("96"), renamed], null),
		).toMatchObject({teamId: ours.teamId, teamName: "Bullets II"})
	})

	test("keeps seasons on the id's other teams out", () => {
		expect(
			reconcileRegistration(
				ours,
				[searchRow("96"), searchRow("100")],
				profile([
					{seasonId: "96"},
					{seasonId: "100"},
					{seasonId: "93", teamId: "11264", teamName: "Seagulls"},
				]),
			),
		).toBeNull()
	})

	test("keeps our position and logo when the KHL has none", () => {
		const row = {...searchRow("100"), position: null, teamLogoUrl: null}
		expect(
			reconcileRegistration(ours, [searchRow("96"), row], null),
		).toBeNull()
	})

	test("ignores the profile page's position", () => {
		const row = (seasonId: string) => {
			return {...searchRow(seasonId), position: null}
		}
		expect(
			reconcileRegistration(
				{...ours, position: null},
				[row("96"), row("100")],
				profile([{seasonId: "96"}, {seasonId: "100"}], {
					position: "Skater|",
				}),
			),
		).toBeNull()
	})
})

describe("diffJson", () => {
	test("equal values have no differences", () => {
		const value = {games: [{id: "1", score: "2-1"}], name: "Bullets"}
		expect(diffJson(value, structuredClone(value))).toEqual([])
	})

	test("reports changed values by path", () => {
		expect(
			diffJson(
				{games: [{id: "1", score: "2-1"}]},
				{games: [{id: "1", score: "3-1"}]},
			),
		).toEqual([{path: "games[0].score", ours: '"2-1"', khl: '"3-1"'}])
	})

	test("reports added and removed keys and items", () => {
		expect(
			diffJson({a: 1, list: [{id: 1}]}, {b: 2, list: [{id: 1}, {id: 2}]}),
		).toEqual([
			{path: "a", ours: "1", khl: null},
			{path: "list (length)", ours: "1", khl: "2"},
			{path: "list[1]", ours: null, khl: '{"id":2}'},
			{path: "b", ours: null, khl: "2"},
		])
	})

	test("reports a list of plain values whole", () => {
		expect(
			diffJson({ids: ["96", "100"]}, {ids: ["93", "96", "100"]}),
		).toEqual([
			{path: "ids", ours: '["96","100"]', khl: '["93","96","100"]'},
		])
	})

	test("shortens long values", () => {
		const [difference] = diffJson("a".repeat(500), "b")
		expect(difference!.ours!.length).toBe(120)
		expect(difference!.ours!.endsWith("…")).toBe(true)
	})
})
