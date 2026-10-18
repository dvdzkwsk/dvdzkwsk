import {Logger} from "@dvdzkwsk/logger"
import {z} from "zod"
import {KHLDatabase} from "./Database.js"

const logger = new Logger("AppCache")

export interface AppCacheValue<T> {
	value: T
	/** Epoch milliseconds */
	computedAt: number
	/** When it's due to be computed again; it's still served until then */
	staleAt: number
}

/**
 * Values we compute from fetched pages (e.g. a season's player list), kept
 * in SQLite so they survive restarts, and in memory once read. Nothing here
 * expires: whatever computes a value replaces it, and readers get the last
 * one in the meantime.
 */
export class AppCache {
	private values = new Map<string, AppCacheValue<unknown>>()

	constructor(private db: KHLDatabase) {}

	/** Null if it was never computed, or no longer matches `schema` */
	get<T>(key: string, schema: z.ZodType<T>): AppCacheValue<T> | null {
		const memo = this.values.get(key)
		if (memo) {
			return memo as AppCacheValue<T>
		}
		const stored = this.db.getAppCacheEntry(key)
		if (!stored) {
			return null
		}
		let json: unknown
		try {
			json = JSON.parse(stored.value)
		} catch (error) {
			logger.warn("get", "stored value isn't JSON; leaving it out", {
				key,
				error,
			})
			return null
		}
		const result = schema.safeParse(json)
		if (!result.success) {
			// Expected after a deploy that changes the value's shape, until
			// it's computed again
			logger.warn("get", "stored value is out of date; leaving it out", {
				key,
				issues: z.prettifyError(result.error),
			})
			return null
		}
		const value: AppCacheValue<T> = {
			value: result.data,
			computedAt: stored.computedAt,
			staleAt: stored.staleAt,
		}
		this.values.set(key, value)
		return value
	}

	set<T>(key: string, value: T, staleAt: number) {
		const computedAt = Date.now()
		this.db.setAppCacheEntry({
			key,
			value: JSON.stringify(value),
			computedAt,
			staleAt,
		})
		this.values.set(key, {value, computedAt, staleAt})
	}
}
