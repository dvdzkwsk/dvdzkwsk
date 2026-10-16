import {describe, expect, test} from "bun:test"
import {
	addDaysToKey,
	getDaysBetween,
	getGameEventClockTime,
	getGamePhase,
	getGameProgress,
} from "./LeagueTime.js"

describe("day keys", () => {
	test("adding days crosses months and years", () => {
		expect(addDaysToKey("2026-10-30", 3)).toBe("2026-11-02")
		expect(addDaysToKey("2027-01-01", -1)).toBe("2026-12-31")
	})

	test("a range counts both ends, across a DST change", () => {
		expect(getDaysBetween("2026-10-11", "2026-10-11")).toBe(1)
		// Pacific time falls back on Nov 1; day keys aren't affected
		expect(getDaysBetween("2026-10-25", "2026-11-07")).toBe(14)
	})
})

// Scheduled for 11:05 PM Pacific (PDT) on Oct 13. With LEAGUE's settings,
// the puck drops 3 minutes later, and each 18-minute period is followed by
// a 1-minute intermission. From the 3rd period on, the clock is stop time:
// each clock minute takes 1.25 minutes.
const game = {startsAt: "2026-10-14T06:05:00.000Z"}

const at = (period: string, timeRemaining: string) => {
	return getGameEventClockTime(game, period, timeRemaining)
}

describe("getGameEventClockTime", () => {
	test("the 1st period starts after warmup", () => {
		expect(at("1st", "18:00")).toEqual({
			localDate: "2026-10-13",
			localTime: "23:08",
		})
	})

	test("adds the time elapsed on the clock, rounded down to the minute", () => {
		// 1:44 elapsed: 23:09:44
		expect(at("1st", "16:16")).toEqual({
			localDate: "2026-10-13",
			localTime: "23:09",
		})
	})

	test("each later period adds a period and an intermission", () => {
		// 3 + 18 + 1
		expect(at("2nd", "18:00")?.localTime).toBe("23:27")
		// 3 + 2 * (18 + 1) = 41
		expect(at("3rd", "18:00")?.localTime).toBe("23:46")
	})

	test("stop-time clock time is scaled up for stoppages", () => {
		// 8:05 elapsed on the clock takes 10:06.25: 23:56:06
		expect(at("3rd", "9:55")?.localTime).toBe("23:56")
	})

	test("overtime goes to its start, whatever its clock says", () => {
		// 3 + 2 * (18 + 1) + (18 * 1.25 + 1) = 64.5, past midnight: 00:09:30
		const start = {localDate: "2026-10-14", localTime: "00:09"}
		expect(at("OT", "5:00")).toEqual(start)
		expect(at("OT", "0:12")).toEqual(start)
	})

	test("an event the clock can't place is null", () => {
		expect(at("SO", "")).toBeNull()
		expect(at("1st", "")).toBeNull()
		expect(at("1st", "16")).toBeNull()
	})
})

/** `minutes` after the same game's scheduled start */
const after = (minutes: number) => {
	return new Date(Date.parse(game.startsAt) + minutes * 60_000)
}

describe("getGamePhase", () => {
	test("warmup until puck drop", () => {
		expect(getGamePhase(game, after(0))).toBe("warmup")
		expect(getGamePhase(game, after(2.9))).toBe("warmup")
	})

	test("each period runs through the intermission after it", () => {
		expect(getGamePhase(game, after(3))).toBe("1st")
		// 3 + 18 + 1
		expect(getGamePhase(game, after(21.9))).toBe("1st")
		expect(getGamePhase(game, after(22))).toBe("2nd")
		expect(getGamePhase(game, after(41))).toBe("3rd")
	})

	test("late once the stop-time 3rd should be over", () => {
		// 41 + 18 * 1.25 + 1 = 64.5
		expect(getGamePhase(game, after(64.4))).toBe("3rd")
		expect(getGamePhase(game, after(64.5))).toBe("late")
	})

	test("null outside the ice slot", () => {
		expect(getGamePhase(game, after(-1))).toBeNull()
		expect(getGamePhase(game, after(75))).toBeNull()
	})
})

describe("getGameProgress", () => {
	test("the share of the 75-minute slot that's gone by, kept in range", () => {
		expect(getGameProgress(game, after(-10))).toBe(0)
		expect(getGameProgress(game, after(30))).toBe(0.4)
		expect(getGameProgress(game, after(90))).toBe(1)
	})
})
