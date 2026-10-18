import {recordPageLoad, withPageReadPolicy} from "./PageStore.js"

export interface CacheEntry {
	expiresAt: number
	/** When `value` resolved; null while it's loading */
	loadedAt: number | null
	value: Promise<unknown>
	/** What loaded `value`, so a cache check can load it again to compare */
	load: () => Promise<unknown>
}

/**
 * Parsed KHL and LiveBarn data, in memory. The pages behind it are kept in
 * the page store (see PageStore), so after a restart, a load within an
 * entry's TTL parses the stored page again instead of fetching it.
 */
export class KHLCache {
	private entries = new Map<string, CacheEntry>()
	/**
	 * Invalidated keys, whose next load fetches instead of reading stored
	 * pages, and fails rather than fall back to them
	 */
	private mustFetch = new Set<string>()

	/**
	 * Memoizes `load` for `ttlMs`, reading stored pages up to `ttlMs` old, or
	 * older ones if fetching them fails. Concurrent callers share one
	 * in-flight request, and failures aren't cached.
	 */
	cached<T>(
		key: string,
		ttlMs: number,
		load: () => Promise<T>,
		/** Once loaded, how long to keep this value instead of `ttlMs` */
		getTtlMs?: (value: T) => number,
	): Promise<T> {
		const hit = this.entries.get(key)
		if (hit && hit.expiresAt > Date.now()) {
			recordPageLoad({source: "memory", key, ms: 0})
			return hit.value as Promise<T>
		}
		const policy = this.mustFetch.delete(key)
			? {maxAgeMs: 0, allowStale: false}
			: {maxAgeMs: ttlMs, allowStale: true}
		const value = withPageReadPolicy(policy, load)
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

	/** A loaded, unexpired entry; null if there isn't one */
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

	/**
	 * Drops an entry, so the next `cached(key, ...)` fetches it again, with
	 * no fallback to a stored page
	 */
	invalidate(key: string) {
		this.entries.delete(key)
		this.mustFetch.add(key)
	}
}
