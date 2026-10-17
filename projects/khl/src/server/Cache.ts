import {Logger} from "@dvdzkwsk/logger"
import {z} from "zod"
import {KHLDatabase} from "./Database.js"

const logger = new Logger("Cache")

export interface CacheEntry {
	expiresAt: number
	/** When `value` resolved; null while it's loading */
	loadedAt: number | null
	value: Promise<unknown>
	/**
	 * What loaded `value`, so a cache check can load it again to compare. Null
	 * for an entry read back from SQLite by `getValue`, until it's reloaded.
	 */
	load: (() => Promise<unknown>) | null
}

/**
 * Loaded KHL and LiveBarn data. Entries are kept in memory, where concurrent
 * callers share one in-flight load, and written through to SQLite, so a
 * restart or deploy picks up where the last process left off instead of
 * reloading everything from the KHL. A stored entry is read back through the
 * caller's schema, and one that no longer matches it is loaded again.
 */
export class KHLCache {
	private entries = new Map<string, CacheEntry>()

	constructor(private db: KHLDatabase) {}

	/**
	 * Memoizes `load` for `ttlMs`. Concurrent callers share one in-flight
	 * request, and failures aren't cached.
	 */
	cached<T>(
		key: string,
		ttlMs: number,
		schema: z.ZodType<T>,
		load: () => Promise<T>,
		/** Once loaded, how long to keep this value instead of `ttlMs` */
		getTtlMs?: (value: T) => number,
	): Promise<T> {
		const hit = this.entries.get(key) ?? this.restore(key, schema, load)
		if (hit && hit.expiresAt > Date.now()) {
			return hit.value as Promise<T>
		}
		const value = load()
		const entry: CacheEntry = {
			expiresAt: Date.now() + ttlMs,
			loadedAt: null,
			value,
			load,
		}
		this.entries.set(key, entry)
		void value.then(
			(loaded) => {
				entry.loadedAt = Date.now()
				if (getTtlMs) {
					entry.expiresAt = Date.now() + getTtlMs(loaded)
				}
				if (this.entries.get(key) === entry) {
					this.store(key, loaded, entry)
				}
			},
			() => {},
		)
		value.catch(() => {
			if (this.entries.get(key)?.value === value) {
				this.entries.delete(key)
			}
		})
		return value
	}

	/**
	 * Loads `key` again, replacing the cached value only once the new one
	 * loads, so readers keep the old one meanwhile and after a failure
	 */
	async refresh<T>(
		key: string,
		ttlMs: number,
		load: () => Promise<T>,
		/** Once loaded, how long to keep this value instead of `ttlMs` */
		getTtlMs?: (value: T) => number,
	): Promise<T> {
		const value = await load()
		const entry: CacheEntry = {
			expiresAt: Date.now() + (getTtlMs?.(value) ?? ttlMs),
			loadedAt: Date.now(),
			value: Promise.resolve(value),
			load,
		}
		this.entries.set(key, entry)
		this.store(key, value, entry)
		return value
	}

	/** A loaded, unexpired value, without loading it; null if there isn't one */
	getValue<T>(key: string, schema: z.ZodType<T>): Promise<T> | null {
		const entry = this.entries.get(key) ?? this.restore(key, schema, null)
		if (!entry?.loadedAt || entry.expiresAt <= Date.now()) {
			return null
		}
		return entry.value as Promise<T>
	}

	/**
	 * A loaded, unexpired entry in memory; null if there isn't one. Entries
	 * only in SQLite are left out until a `cached` call reads them back.
	 */
	getLoadedEntry(key: string): (CacheEntry & {loadedAt: number}) | null {
		const entry = this.entries.get(key)
		if (!entry?.loadedAt || entry.expiresAt <= Date.now()) {
			return null
		}
		return entry as CacheEntry & {loadedAt: number}
	}

	/** When a loaded, unexpired entry was cached; null if there isn't one */
	getInfo(key: string): {cachedAt: string; expiresAt: string} | null {
		const entry = this.getLoadedEntry(key)
		if (!entry) {
			return null
		}
		return {
			cachedAt: new Date(entry.loadedAt).toISOString(),
			expiresAt: new Date(entry.expiresAt).toISOString(),
		}
	}

	/** Drops an entry, so the next `cached(key, ...)` loads it again */
	invalidate(key: string) {
		this.entries.delete(key)
		this.db.deleteCacheEntry(key)
	}

	/** Drops expired entries from SQLite */
	prune() {
		this.db.pruneCacheEntries(Date.now())
	}

	private store(key: string, value: unknown, entry: CacheEntry) {
		try {
			this.db.setCacheEntry({
				key,
				value: JSON.stringify(value),
				loadedAt: entry.loadedAt!,
				expiresAt: entry.expiresAt,
			})
		} catch (error) {
			logger.warn("store", "couldn't store cache entry; memory only", {
				key,
				error,
			})
		}
	}

	/** Reads an unexpired entry back from SQLite into memory */
	private restore<T>(
		key: string,
		schema: z.ZodType<T>,
		load: (() => Promise<T>) | null,
	): CacheEntry | null {
		const stored = this.db.getCacheEntry(key, Date.now())
		if (!stored) {
			return null
		}
		let json: unknown
		try {
			json = JSON.parse(stored.value)
		} catch (error) {
			logger.warn("restore", "stored cache entry isn't JSON; reloading", {
				key,
				error,
			})
			return null
		}
		const result = schema.safeParse(json)
		if (!result.success) {
			// Expected after a deploy that changes a scraped shape
			logger.warn("restore", "stored cache entry is stale; reloading", {
				key,
				error: z.prettifyError(result.error),
			})
			return null
		}
		const entry: CacheEntry = {
			expiresAt: stored.expiresAt,
			loadedAt: stored.loadedAt,
			value: Promise.resolve(result.data),
			load,
		}
		this.entries.set(key, entry)
		return entry
	}
}
