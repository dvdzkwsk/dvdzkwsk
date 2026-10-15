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
