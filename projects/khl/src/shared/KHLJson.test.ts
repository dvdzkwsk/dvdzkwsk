import {describe, expect, test} from "bun:test"
import {getLineupAttendance, KHLGameTeamStats, KHLRosterRow} from "./KHLJson.js"

const row = (playerId: string): KHLRosterRow => {
	return {playerId, number: null, name: playerId, stats: {}}
}

const lineup = (
	skaters: string[],
	goalies: string[] = [],
): KHLGameTeamStats => {
	return {
		skaterColumns: [],
		skaters: skaters.map(row),
		goalieColumns: [],
		goalies: goalies.map(row),
	}
}

// One player, registered on two teams under two KHL player ids
const player = new Set(["101", "202"])

describe("getLineupAttendance", () => {
	test("played as a skater, under either id", () => {
		expect(getLineupAttendance(player, lineup(["1", "202"]))).toBe("played")
	})

	test("played in goal", () => {
		expect(getLineupAttendance(player, lineup(["1"], ["101"]))).toBe(
			"played",
		)
	})

	test("skipped a posted lineup", () => {
		expect(getLineupAttendance(player, lineup(["1", "2"], ["3"]))).toBe(
			"skipped",
		)
	})

	test("unknown until the lineup is posted", () => {
		expect(getLineupAttendance(player, lineup([]))).toBeNull()
	})
})
