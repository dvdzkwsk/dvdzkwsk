import {
	ConsoleTransport,
	LogMessage,
	Logger,
	LoggerTransport,
	setLoggerTransports,
} from "@dvdzkwsk/logger"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import {matchFn} from "@dvdzkwsk/util/MatchUtil"
import {History, Location} from "history"
import * as React from "react"
import {ClientLog, SEND_LOGS_ENDPOINT} from "../shared/ApiJson.js"
import {LEAGUE, URLS} from "../shared/KHLConfig.js"
import {
	addDaysToKey,
	DAY_MS,
	getLeagueDayKey,
	MINUTE_MS,
} from "../shared/LeagueTime.js"

// --- App context and routes

export interface AppContextValue {
	history: History
}

export const AppContext = React.createContext<AppContextValue>(null!)

export function createAppContext(history: History): AppContextValue {
	return {
		history,
	}
}

export interface Route {
	/** e.g. "/players/:playerId" */
	path: string
	title: string
	description?: string
	content: React.FC<RouteProps>
}

export interface RouteProps {
	params: Record<string, string>
	query: URLSearchParams
}

// --- Links

/** In-app links, matching the paths in Routes.tsx */
export function getPlayerHref(playerId: string): string {
	return `/players/${playerId}`
}

export function getAchievementsHref(): string {
	return "/achievements"
}

export function getApiHref(): string {
	return "/api"
}

export function getGameHref(gameId: string): string {
	return `/games/${gameId}`
}

/**
 * The league's filled-in scoresheet ("GAME SHEET" on its game summary); it
 * uses the same game id as /game/:id. /scoresheet/:id is the blank form.
 */
export function getScoresheetUrl(gameId: string): string {
	return new URL(
		`/scoresheet-complete/${encodeURIComponent(gameId)}`,
		URLS.KHL,
	).href
}

export function getRinkHref(arenaId: string): string {
	return `/rinks/${arenaId}`
}

export function getTeamHref(team: {id: string; seasonId: string}): string {
	return `/teams/${team.id}?${new URLSearchParams({season: team.seasonId})}`
}

export function getSearchHref(query: string): string {
	return `/search?${new URLSearchParams({q: query})}`
}

/** "Kraken Hockey League Fall/Winter 26/27" -> "Fall/Winter 26/27" */
export function getShortSeasonName(name: string): string {
	return name.replace(/^Kraken Hockey League\s+/i, "").trim()
}

// --- Formatting (league-local time)

const dateFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: LEAGUE.TIME_ZONE,
	weekday: "short",
	month: "short",
	day: "numeric",
})

const shortDateFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: LEAGUE.TIME_ZONE,
	month: "short",
	day: "numeric",
})

const dateWithYearFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: LEAGUE.TIME_ZONE,
	month: "short",
	day: "numeric",
	year: "numeric",
})

const yearFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: LEAGUE.TIME_ZONE,
	year: "numeric",
})

const timeFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: LEAGUE.TIME_ZONE,
	hour: "numeric",
	minute: "2-digit",
})

/** Whether the game falls in `now`'s league-time year, so its date can omit the year */
export function isInCurrentYear(startsAt: string, now: Date): boolean {
	return yearFormat.format(new Date(startsAt)) === yearFormat.format(now)
}

/** "Mon, Oct 19" in league time, or "Aug 28, 2024" outside the current year */
export function formatGameDate(startsAt: string, now: Date): string {
	const date = new Date(startsAt)
	return isInCurrentYear(startsAt, now)
		? dateFormat.format(date)
		: dateWithYearFormat.format(date)
}

/** "1st" -> "1st period"; "OT" and "SO" stay as they are */
export function formatPeriodName(period: string): string {
	return /^\d/.test(period) ? `${period} period` : period
}

/** What the scoresheet's goal types stand for */
export const GOAL_TYPES: Record<string, string> = {
	PPG: "Power-play goal",
	SHG: "Short-handed goal",
	ENG: "Empty-net goal",
}

/** "Oct 19" in league time, or "Aug 28, 2024" outside the current year */
export function formatShortGameDate(startsAt: string, now: Date): string {
	const date = new Date(startsAt)
	return isInCurrentYear(startsAt, now)
		? shortDateFormat.format(date)
		: dateWithYearFormat.format(date)
}

/**
 * "4 – 2". Every score in the app goes through this (or formatKHLScore), so
 * they all read the same.
 */
export function formatScore(first: number, second: number): string {
	return `${first} – ${second}`
}

/** The league's own "4 - 2" (or "4-2"), via formatScore; anything else as is */
export function formatKHLScore(score: string): string {
	const match = score.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/)
	return match ? formatScore(Number(match[1]), Number(match[2])) : score
}

/** "9:05 PM" in league time */
export function formatGameTime(startsAt: string): string {
	return timeFormat.format(new Date(startsAt))
}

const fullDateFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: LEAGUE.TIME_ZONE,
	dateStyle: "full",
})

/** "Wednesday, October 14, 2026" in league time */
export function formatFullGameDate(startsAt: string): string {
	return fullDateFormat.format(new Date(startsAt))
}

/** "1.35s", from milliseconds */
export function formatSeconds(ms: number): string {
	return `${(ms / 1000).toFixed(2)}s`
}

const relativeFormat = new Intl.RelativeTimeFormat("en-US", {numeric: "auto"})

/** "in 5 days", "in 3 hours", "tomorrow" */
export function formatRelative(target: string, now: Date): string {
	const diffMinutes = (Date.parse(target) - now.getTime()) / MINUTE_MS
	if (Math.abs(diffMinutes) < 60) {
		// At least a minute either way: "1 minute ago", never "this minute"
		const minutes = Math.round(diffMinutes) || (diffMinutes > 0 ? 1 : -1)
		return relativeFormat.format(minutes, "minute")
	}
	if (Math.abs(diffMinutes) < 24 * 60) {
		return relativeFormat.format(Math.round(diffMinutes / 60), "hour")
	}
	return relativeFormat.format(Math.round(diffMinutes / (24 * 60)), "day")
}

/** "Today", "Tomorrow", or "Mon, Oct 19" in league time */
export function formatGameDay(startsAt: string, now: Date): string {
	const day = getLeagueDayKey(new Date(startsAt))
	if (day === getLeagueDayKey(now)) {
		return "Today"
	}
	const tomorrow = new Date(now.getTime() + DAY_MS)
	if (day === getLeagueDayKey(tomorrow)) {
		return "Tomorrow"
	}
	return formatGameDate(startsAt, now)
}

/** League-local day key of the last day of the 7 days starting today */
export function getEndOfWeekAheadDayKey(now: Date): string {
	return addDaysToKey(getLeagueDayKey(now), 6)
}

// --- Hooks

export type AsyncState<T> = (
	| {status: "loading"}
	| {status: "error"; error: Error}
	| {status: "success"; data: T}
) & {
	/** Runs `load` again, e.g. from a "Try again" button */
	reload: () => void
	/**
	 * Runs `load` again behind what's shown, which stays until the new
	 * result replaces it (or, if the load fails, stays)
	 */
	refresh: () => void
}

const asyncLogger = new Logger("useAsync")

/**
 * Runs `load` on mount and whenever `deps` change, ignoring stale results.
 * Failures are logged here, once per failed load.
 */
export function useAsync<T>(
	load: () => Promise<T>,
	deps: React.DependencyList,
): AsyncState<T> {
	type Result =
		| {status: "loading"}
		| {status: "error"; error: Error}
		| {status: "success"; data: T}
	const [result, setResult] = React.useState<Result>({status: "loading"})
	const [attempt, setAttempt] = React.useState(0)
	// Set by refresh for the load it starts; any other load shows loading
	const quiet = React.useRef(false)
	React.useEffect(() => {
		let current = true
		const isRefresh = quiet.current
		quiet.current = false
		if (!isRefresh) {
			setResult({status: "loading"})
		}
		;(IS_DEV ? withSimulatedLoading(load) : load()).then(
			(data) => current && setResult({status: "success", data}),
			(cause: unknown) => {
				const error = toError(cause)
				if (isRefresh) {
					asyncLogger.warn(
						"refresh",
						"refresh failed; kept what's shown",
						{
							error,
						},
					)
					return
				}
				asyncLogger.error("load", "load failed", {error})
				if (current) {
					setResult({status: "error", error})
				}
			},
		)
		return () => {
			current = false
		}
	}, [...deps, attempt])
	const reload = React.useCallback(() => setAttempt((n) => n + 1), [])
	const refresh = React.useCallback(() => {
		quiet.current = true
		setAttempt((n) => n + 1)
	}, [])
	return {...result, reload, refresh}
}

// --- Dev tools

/** True under the Vite dev server; dev-only code is dropped from builds. */
export const IS_DEV = import.meta.env.DEV

/** Set from the Admin page: makes every `useAsync` load slow, or never finish. */
export type SimulatedLoading = "off" | "slow" | "hang"

const SIMULATED_LOADING_KEY = "khl-dev-simulated-loading"
export const SIMULATED_LOADING_DELAY_MS = 3000

export function readSimulatedLoading(): SimulatedLoading {
	try {
		const value = sessionStorage.getItem(SIMULATED_LOADING_KEY)
		return value === "slow" || value === "hang" ? value : "off"
	} catch {
		return "off"
	}
}

export function writeSimulatedLoading(value: SimulatedLoading) {
	try {
		matchFn(value, {
			off: () => sessionStorage.removeItem(SIMULATED_LOADING_KEY),
			slow: (v) => sessionStorage.setItem(SIMULATED_LOADING_KEY, v),
			hang: (v) => sessionStorage.setItem(SIMULATED_LOADING_KEY, v),
		})
	} catch {
		// Not persisted; nothing to simulate
	}
}

function withSimulatedLoading<T>(load: () => Promise<T>): Promise<T> {
	return matchFn(readSimulatedLoading(), {
		off: () => load(),
		slow: () =>
			new Promise((resolve) =>
				setTimeout(resolve, SIMULATED_LOADING_DELAY_MS),
			).then(load),
		hang: () => new Promise<T>(() => {}),
	})
}

// --- Local storage: this browser's own preferences and history. Blocked
// or full storage (e.g. a private window) just means nothing is remembered.

export function readStorage(key: string): string | null {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

export function writeStorage(key: string, value: string | null) {
	try {
		if (value === null) {
			localStorage.removeItem(key)
		} else {
			localStorage.setItem(key, value)
		}
	} catch {
		// Not persisted; it still applies until the page reloads
	}
}

/** Whether a CSS media query matches, re-rendering whenever that changes. */
export function useMediaQuery(query: string): boolean {
	return React.useSyncExternalStore(
		(onChange) => {
			const list = window.matchMedia(query)
			list.addEventListener("change", onChange)
			return () => list.removeEventListener("change", onChange)
		},
		() => window.matchMedia(query).matches,
	)
}

/** The current location, re-rendering whenever it changes. */
export function useLocation(): Location {
	const {history} = React.useContext(AppContext)
	const [location, setLocation] = React.useState(history.location)
	React.useEffect(() => {
		const unlisten = history.listen((update) =>
			setLocation(update.location),
		)
		// The URL may have changed between render and subscribing; catch up
		setLocation(history.location)
		return unlisten
	}, [history])
	return location
}

/** League-wide pages' filters: which season, and which of its divisions. */
export interface SeasonFilterValues {
	/** KHL season id; null for the current season */
	season: string | null
	/** Division names, e.g. "Division 4B"; empty means every division */
	divisions: string[]
}

/**
 * Season filters, kept in the URL so they survive reloads and can be shared.
 * Changes replace the history entry so filter tweaks don't fill it up.
 */
export function useSeasonFilters(
	query: URLSearchParams,
): [SeasonFilterValues, (changes: Partial<SeasonFilterValues>) => void] {
	const {history} = React.useContext(AppContext)
	const filters: SeasonFilterValues = {
		season: query.get("season"),
		divisions: query.get("divisions")?.split(",").filter(Boolean) ?? [],
	}
	const setFilters = (changes: Partial<SeasonFilterValues>) => {
		const next = {...filters, ...changes}
		// Keeps any other params, e.g. the Teams page's grouping
		const search = new URLSearchParams(history.location.search)
		search.delete("season")
		search.delete("divisions")
		if (next.season) {
			search.set("season", next.season)
		}
		if (next.divisions.length > 0) {
			search.set("divisions", next.divisions.join(","))
		}
		history.replace({
			pathname: history.location.pathname,
			search: search.size > 0 ? `?${search}` : "",
		})
	}
	return [filters, setFilters]
}

/**
 * Sets one query param, or removes it when `value` is null (e.g. a default),
 * keeping the rest. Replaces the history entry, like the filters above.
 */
export function replaceQueryParam(
	history: History,
	name: string,
	value: string | null,
) {
	const search = new URLSearchParams(history.location.search)
	if (value === null) {
		search.delete(name)
	} else {
		search.set(name, value)
	}
	history.replace({
		pathname: history.location.pathname,
		search: search.size > 0 ? `?${search}` : "",
	})
}

/**
 * The selected divisions that exist in `divisions`, or all of `divisions` when
 * none do: a season's division names differ (e.g. "40+ Fall 26"), so a filter
 * carried over from another season may match nothing.
 */
export function getVisibleDivisions(
	divisions: string[],
	selected: string[],
): Set<string> {
	const matching = divisions.filter((d) => selected.includes(d))
	return new Set(matching.length > 0 ? matching : divisions)
}

/** The current time, updated every `intervalMs`. */
export function useNow(intervalMs = 30_000): Date {
	const [now, setNow] = React.useState(() => new Date())
	React.useEffect(() => {
		const id = setInterval(() => setNow(new Date()), intervalMs)
		return () => clearInterval(id)
	}, [intervalMs])
	return now
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = React.useState(value)
	React.useEffect(() => {
		const id = setTimeout(() => setDebounced(value), delayMs)
		return () => clearTimeout(id)
	}, [value, delayMs])
	return debounced
}

// --- Logging
//
// Every client log goes to the console and, batched, to the server
// (SEND_LOGS_ENDPOINT), which writes them to its own log output.

const LOG_FLUSH_INTERVAL_MS = 5_000
const LOG_MAX_RETRY_INTERVAL_MS = 60_000
const LOG_BATCH_SIZE = 20
/** Logs kept while the server is unreachable; the oldest are dropped first */
const LOG_MAX_BUFFERED = 200
const LOG_MAX_PER_REQUEST = 100

/**
 * Buffers log messages and sends them in batches. Its own failures go to
 * console.warn, never through the logger, so an outage can't feed itself.
 */
class BatchingLogTransport implements LoggerTransport {
	private buffer: ClientLog[] = []
	private timer: ReturnType<typeof setTimeout> | null = null
	private sending = false
	private retryIntervalMs = LOG_FLUSH_INTERVAL_MS

	constructor(private sessionId: string) {}

	log(message: LogMessage) {
		this.buffer.push(toClientLog(message))
		if (this.buffer.length > LOG_MAX_BUFFERED) {
			this.buffer.splice(0, this.buffer.length - LOG_MAX_BUFFERED)
		}
		if (this.buffer.length >= LOG_BATCH_SIZE) {
			void this.flush()
		} else {
			this.schedule(LOG_FLUSH_INTERVAL_MS)
		}
	}

	/** Sends what's buffered now; `keepalive` lets it finish as the page closes. */
	async flush(options: {keepalive?: boolean} = {}) {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
		if (this.sending || this.buffer.length === 0) {
			return
		}
		const batch = this.buffer.splice(0, LOG_MAX_PER_REQUEST)
		this.sending = true
		try {
			await doRequest(
				SEND_LOGS_ENDPOINT,
				{
					sessionId: this.sessionId,
					userAgent: navigator.userAgent,
					logs: batch,
				},
				options,
			)
			this.retryIntervalMs = LOG_FLUSH_INTERVAL_MS
		} catch (error) {
			console.warn(
				"[logging] couldn't send logs to the server; will retry",
				error,
			)
			this.buffer.unshift(...batch)
			this.buffer.splice(
				0,
				Math.max(0, this.buffer.length - LOG_MAX_BUFFERED),
			)
			this.retryIntervalMs = Math.min(
				this.retryIntervalMs * 2,
				LOG_MAX_RETRY_INTERVAL_MS,
			)
		} finally {
			this.sending = false
		}
		if (this.buffer.length > 0) {
			this.schedule(this.retryIntervalMs)
		}
	}

	private schedule(delayMs: number) {
		this.timer ??= setTimeout(() => void this.flush(), delayMs)
	}
}

function toClientLog(message: LogMessage): ClientLog {
	return {
		timestamp: message.timestamp.toISOString(),
		level: message.level,
		context: message.context,
		subcontext: message.subcontext,
		message: message.message,
		aux: message.aux ? toJsonSafe(message.aux) : null,
		url: location.href,
	}
}

/** Flattens Errors (which serialize to {}) and anything else JSON can't hold. */
function toJsonSafe(aux: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(aux)) {
		if (value instanceof Error) {
			out[key] = serializeError(value)
			continue
		}
		try {
			out[key] = JSON.parse(JSON.stringify(value) ?? "null")
		} catch {
			out[key] = String(value)
		}
	}
	return out
}

function serializeError(error: Error): Record<string, unknown> {
	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
		...(error instanceof FetchError && {
			status: error.status,
			url: error.url,
			method: error.method,
			serverMessage: error.serverMessage,
		}),
	}
}

/**
 * Sends client logs to the console and the server, and logs anything that
 * escapes: uncaught exceptions and unhandled promise rejections. Call once,
 * before rendering.
 */
export function initClientLogging() {
	const transport = new BatchingLogTransport(crypto.randomUUID())
	setLoggerTransports([new ConsoleTransport({verbose: true}), transport])

	const logger = new Logger("window")
	window.addEventListener("error", (event) => {
		logger.error("onerror", "uncaught error", {
			error: event.error instanceof Error ? event.error : event.message,
			source: `${event.filename}:${event.lineno}:${event.colno}`,
		})
	})
	window.addEventListener("unhandledrejection", (event) => {
		logger.error("onunhandledrejection", "unhandled promise rejection", {
			error:
				event.reason instanceof Error
					? event.reason
					: String(event.reason),
		})
	})
	// Don't lose the last batch when the tab is closed or backgrounded
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") {
			void transport.flush({keepalive: true})
		}
	})
}

/** A short, human explanation of what went wrong, for error messages. */
export function describeError(error: Error): string {
	if (error instanceof FetchError) {
		if (error.status === null) {
			return "Couldn't reach the server. Check your connection and try again."
		}
		if (error.status === 404) {
			return "We couldn't find that. It may have been moved or removed."
		}
		if (error.status === 503) {
			return "This is still loading for the first time. Try again in a few minutes."
		}
		if (error.status >= 500) {
			return `The server ran into a problem (${error.status}). This is usually temporary.`
		}
		return `The request was rejected (${error.status}).`
	}
	return "Something unexpected went wrong."
}
