/** League-local (Pacific) dates and times, shared by the server and client. */

import {zonedTimeToDate} from "@dvdzkwsk/util/DateUtil"
import {LEAGUE} from "./KHLConfig.js"

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
	timeZone: LEAGUE.TIME_ZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
})

const clockFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: LEAGUE.TIME_ZONE,
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
})

/** "yyyy-MM-dd" of the league-local day `date` falls on */
export function getLeagueDayKey(date: Date): string {
	return dayKeyFormat.format(date)
}

/** "2026-10-22", 3 -> "2026-10-25" */
export function addDaysToKey(day: string, count: number): string {
	const date = new Date(`${day}T00:00:00Z`)
	date.setUTCDate(date.getUTCDate() + count)
	return date.toISOString().slice(0, 10)
}

/** How many days "yyyy-MM-dd" `from` through `to` cover, both included */
export function getDaysBetween(from: string, to: string): number {
	return (
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
			DAY_MS +
		1
	)
}

/** "yyyy-MM-dd" and "HH:mm" in league time, as KHL pages give them */
export function getLeagueLocalTime(startsAt: string): {
	localDate: string
	localTime: string
} {
	const date = new Date(startsAt)
	return {
		localDate: getLeagueDayKey(date),
		localTime: clockFormat.format(date),
	}
}

/** "2026-10-14" + "22:35" in league time -> ISO instant */
export function toLeagueInstant(localDate: string, localTime: string): string {
	return zonedTimeToDate(localDate, localTime, LEAGUE.TIME_ZONE).toISOString()
}

/** When a game's ice slot ends; the schedule only lists start times. */
export function getGameEndsAt(game: {startsAt: string}): Date {
	return new Date(
		Date.parse(game.startsAt) + LEAGUE.GAME_DURATION_MINUTES * MINUTE_MS,
	)
}

/** Started, and still inside its ice slot */
export function isGameInProgress(game: {startsAt: string}, now: Date): boolean {
	return (
		Date.parse(game.startsAt) <= now.getTime() && now < getGameEndsAt(game)
	)
}

/**
 * Wall-clock time for `clockMs` of game clock in period `n` (1-based):
 * stop-time periods run longer than their clock, by an estimated factor
 */
function toWallMs(n: number, clockMs: number): number {
	return n >= LEAGUE.FIRST_STOP_TIME_PERIOD
		? clockMs * LEAGUE.STOP_TIME_FACTOR
		: clockMs
}

/** The parts of a game, in order, that getGamePhase estimates */
export type GamePhase = "warmup" | "1st" | "2nd" | "3rd" | "late"

/**
 * Roughly which part of a game is being played at `now`, or null outside its
 * ice slot. Walks forward from the scheduled start like getGameEventClockTime:
 * warmup until puck drop, then each period and the intermission after it.
 * "late" once the third should be over: overtime, a shootout, or a game
 * running long.
 */
export function getGamePhase(
	game: {startsAt: string},
	now: Date,
): GamePhase | null {
	if (!isGameInProgress(game, now)) {
		return null
	}
	const {PERIOD_MINUTES, WARMUP_MINUTES, INTERMISSION_MINUTES} = LEAGUE
	let at = Date.parse(game.startsAt) + WARMUP_MINUTES * MINUTE_MS
	if (now.getTime() < at) {
		return "warmup"
	}
	const periods = ["1st", "2nd", "3rd"] as const
	for (const [i, period] of periods.entries()) {
		at += toWallMs(i + 1, PERIOD_MINUTES * MINUTE_MS)
		at += INTERMISSION_MINUTES * MINUTE_MS
		if (now.getTime() < at) {
			return period
		}
	}
	return "late"
}

/** How far through its ice slot a game is at `now`, from 0 to 1 */
export function getGameProgress(game: {startsAt: string}, now: Date): number {
	const start = Date.parse(game.startsAt)
	const end = getGameEndsAt(game).getTime()
	return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)))
}

/**
 * Estimates when a scoresheet event (period, and clock time remaining)
 * happened, as a league-local date and time, or null for shootouts and
 * unparseable times.
 *
 * The league only publishes when a game was scheduled to start, and the
 * scoresheet only has game-clock times, so this walks forward from the
 * scheduled start: warmup until puck drop, then each earlier period and the
 * intermission after it, then the time elapsed in the event's own period.
 * Stop-time periods run longer than their clock, so their clock time is
 * scaled by an estimated stoppage factor. Overtime (whose length we don't
 * know) goes to its start. Rounded down to the minute.
 */
export function getGameEventClockTime(
	game: {startsAt: string},
	period: string,
	timeRemaining: string,
): {localDate: string; localTime: string} | null {
	const {PERIOD_MINUTES, WARMUP_MINUTES, INTERMISSION_MINUTES} = LEAGUE
	const clock = /^(\d+):(\d{2})$/.exec(timeRemaining)
	// "1st", "2nd", "3rd", then "OT"; a shootout has no clock
	const periodNumber = period === "OT" ? 4 : parseInt(period, 10)
	if (!clock || Number.isNaN(periodNumber)) {
		return null
	}

	// The league's scheduled start
	let at = Date.parse(game.startsAt)
	// Warmup, until puck drop
	at += WARMUP_MINUTES * MINUTE_MS
	// Each earlier period, then the intermission after it
	for (let n = 1; n < periodNumber; n++) {
		at += toWallMs(n, PERIOD_MINUTES * MINUTE_MS)
		at += INTERMISSION_MINUTES * MINUTE_MS
	}
	// Time elapsed in the event's own period: the clock counts down from the
	// period's length. Overtime's length is unknown, so it stays at its start.
	if (period !== "OT") {
		const remainingMs = (Number(clock[1]) * 60 + Number(clock[2])) * 1000
		const elapsedMs = Math.max(0, PERIOD_MINUTES * MINUTE_MS - remainingMs)
		at += toWallMs(periodNumber, elapsedMs)
	}
	return getLeagueLocalTime(new Date(at).toISOString())
}
