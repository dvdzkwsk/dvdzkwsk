import {describe, expect, test} from "bun:test"
import {openDatabase} from "./Database.js"
import {KHLPlayerSearchResult} from "../shared/KHLJson.js"

const row = (
	playerId: string,
	teamId: string,
	seasonId = "2143",
): KHLPlayerSearchResult => {
	return {
		playerId,
		name: "Brandon Smith",
		position: "Skater",
		teamId,
		teamName: `Team ${teamId}`,
		teamLogoUrl: null,
		seasonId,
	}
}

/** Two KHL ids with the same name, both on one profile by name match */
function setup() {
	const db = openDatabase(":memory:")
	const ids = db.recordRegistrations([row("100", "1"), row("200", "2")])
	const playerId = ids.get("100")!
	expect(ids.get("200")).toBe(playerId)
	return {db, playerId}
}

describe("moveKHLPlayerId", () => {
	test("moves an id to a new profile", () => {
		const {db, playerId} = setup()
		const move = db.moveKHLPlayerId("200", null)
		expect(move).toMatchObject({
			fromPlayerId: playerId,
			deletedPlayerId: null,
		})
		expect(move.toPlayerId).not.toBe(playerId)
		expect(db.getPlayer(move.toPlayerId)?.name).toBe("Brandon Smith")
		expect(db.getRegistrations(playerId).map((r) => r.khlPlayerId)).toEqual(
			["100"],
		)
		expect(
			db.getRegistrations(move.toPlayerId).map((r) => r.khlPlayerId),
		).toEqual(["200"])
	})

	test("moves every team under the id together", () => {
		const {db} = setup()
		db.recordRegistrations([row("200", "3")])
		const {toPlayerId} = db.moveKHLPlayerId("200", null)
		expect(
			db
				.getRegistrations(toPlayerId)
				.map((r) => r.teamId)
				.sort(),
		).toEqual(["2", "3"])
	})

	test("sticks when the search records the id again", () => {
		const {db, playerId} = setup()
		const {toPlayerId} = db.moveKHLPlayerId("200", null)
		db.recordRegistrations([
			row("100", "1"),
			row("200", "2"),
			row("200", "4"),
		])
		expect(db.findPlayerIdForRegistration("200")).toBe(toPlayerId)
		expect(db.getRegistrations(playerId)).toHaveLength(1)
		expect(db.getRegistrations(toPlayerId)).toHaveLength(2)
	})

	test("gives a new id its own profile once the name is split", () => {
		const {db, playerId} = setup()
		const {toPlayerId} = db.moveKHLPlayerId("200", null)
		const ids = db.recordRegistrations([row("300", "5")])
		expect([playerId, toPlayerId]).not.toContain(ids.get("300"))
	})

	test("deletes the profile it empties", () => {
		const {db, playerId} = setup()
		const {toPlayerId} = db.moveKHLPlayerId("200", null)
		const move = db.moveKHLPlayerId("200", playerId)
		expect(move.deletedPlayerId).toBe(toPlayerId)
		expect(db.getPlayer(toPlayerId)).toBeNull()
		expect(db.getRegistrations(playerId)).toHaveLength(2)
	})
})

describe("getNamesakes", () => {
	test("lists other profiles with the same name", () => {
		const {db, playerId} = setup()
		db.recordRegistrations([{...row("900", "9"), name: "Someone Else"}])
		const {toPlayerId} = db.moveKHLPlayerId("200", null)
		expect(db.getNamesakes(playerId)).toEqual([
			{
				playerId: toPlayerId,
				createdAt: expect.any(String),
				registrationCount: 1,
				teamNames: ["Team 2"],
			},
		])
		expect(db.getNamesakes(toPlayerId).map((n) => n.playerId)).toEqual([
			playerId,
		])
	})
})
