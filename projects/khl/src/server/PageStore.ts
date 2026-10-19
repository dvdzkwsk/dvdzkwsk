import {AsyncLocalStorage} from "async_hooks"
import * as fs from "fs"
import * as path from "path"
import {Logger} from "@dvdzkwsk/logger"
import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import {Database as SQLiteDatabase} from "bun:sqlite"

const logger = new Logger("PageStore")

/** Where a stored page came from; each has its own table */
export type PageSource = "khl" | "livebarn"

const PAGE_TABLES: Record<PageSource, string> = {
	khl: "khl_pages",
	livebarn: "livebarn_responses",
}

/** Schema changes, applied in order. Append only; never edit a shipped one. */
const MIGRATIONS = [
	`
	CREATE TABLE khl_pages (
		url TEXT PRIMARY KEY,
		body BLOB NOT NULL,
		hash TEXT NOT NULL,
		fetched_at INTEGER NOT NULL,
		changed_at INTEGER NOT NULL
	);
	CREATE TABLE livebarn_responses (
		url TEXT PRIMARY KEY,
		body BLOB NOT NULL,
		hash TEXT NOT NULL,
		fetched_at INTEGER NOT NULL,
		changed_at INTEGER NOT NULL
	);
	`,
	`
	-- A fetched page that didn't parse, kept apart so it doesn't replace the
	-- last good copy, and so a parser fix can be checked against it
	CREATE TABLE failed_pages (
		source TEXT NOT NULL,
		url TEXT NOT NULL,
		body BLOB NOT NULL,
		error TEXT NOT NULL,
		failed_at INTEGER NOT NULL,
		PRIMARY KEY (source, url)
	);
	`,
]

/** A stored page; times are epoch milliseconds */
export interface StoredPage {
	/** As fetched: HTML from the KHL, JSON from LiveBarn */
	body: string
	hash: string
	fetchedAt: number
	/** When `body` last differed from the copy before it */
	changedAt: number
}

interface PageRow {
	body: Uint8Array<ArrayBuffer>
	hash: string
	fetched_at: number
	changed_at: number
}

/**
 * Every page fetched from the KHL and LiveBarn, as fetched (gzipped), in its
 * own SQLite file. It's a copy of the sources rather than a cache: nothing
 * expires, a refetch replaces a page, and everything we derive from it can
 * be rebuilt by parsing it again, with no fetches.
 */
export class PageStore {
	constructor(private db: SQLiteDatabase) {}

	get(source: PageSource, url: string): StoredPage | null {
		const row = this.db
			.query<PageRow, {url: string}>(
				`SELECT body, hash, fetched_at, changed_at FROM ${PAGE_TABLES[source]}
				WHERE url = $url`,
			)
			.get({url})
		if (!row) {
			return null
		}
		return {
			body: new TextDecoder().decode(Bun.gunzipSync(row.body)),
			hash: row.hash,
			fetchedAt: row.fetched_at,
			changedAt: row.changed_at,
		}
	}

	/** When the page was last fetched and its hash, without reading it */
	getInfo(
		source: PageSource,
		url: string,
	): {fetchedAt: number; hash: string} | null {
		const row = this.db
			.query<{fetched_at: number; hash: string}, {url: string}>(
				`SELECT fetched_at, hash FROM ${PAGE_TABLES[source]} WHERE url = $url`,
			)
			.get({url})
		return row ? {fetchedAt: row.fetched_at, hash: row.hash} : null
	}

	/**
	 * When the page was last fetched, whether it parsed or not (see
	 * putFailed); null if never
	 */
	getLastFetchedAt(source: PageSource, url: string): number | null {
		const row = this.db
			.query<{at: number | null}, {source: string; url: string}>(
				// A scalar max() with a NULL argument is NULL, so each side
				// defaults to 0
				`SELECT max(
					coalesce(
						(SELECT fetched_at FROM ${PAGE_TABLES[source]} WHERE url = $url),
						0
					),
					coalesce(
						(SELECT failed_at FROM failed_pages
							WHERE source = $source AND url = $url),
						0
					)
				) AS at`,
			)
			.get({source, url})
		return row?.at || null
	}

	/**
	 * Stores a fetched page that parsed, replacing the last copy, and clears
	 * any failure recorded for it
	 */
	put(source: PageSource, url: string, body: string): {hash: string} {
		const now = Date.now()
		const hash = toPageHash(body)
		this.db.transaction(() => {
			this.db
				.query(
					`INSERT INTO ${PAGE_TABLES[source]}
					(url, body, hash, fetched_at, changed_at)
				VALUES ($url, $body, $hash, $now, $now)
				ON CONFLICT (url) DO UPDATE SET body = excluded.body,
					hash = excluded.hash, fetched_at = excluded.fetched_at,
					changed_at = CASE WHEN hash = excluded.hash
						THEN changed_at ELSE excluded.changed_at END`,
				)
				.run({url, body: Bun.gzipSync(body), hash, now})
			this.db
				.query(
					"DELETE FROM failed_pages WHERE source = $source AND url = $url",
				)
				.run({source, url})
		})()
		return {hash}
	}

	/** Keeps a fetched page that didn't parse, leaving the last good copy */
	putFailed(source: PageSource, url: string, body: string, error: unknown) {
		this.db
			.query(
				`INSERT INTO failed_pages (source, url, body, error, failed_at)
				VALUES ($source, $url, $body, $error, $now)
				ON CONFLICT (source, url) DO UPDATE SET body = excluded.body,
					error = excluded.error, failed_at = excluded.failed_at`,
			)
			.run({
				source,
				url,
				body: Bun.gzipSync(body),
				error: error instanceof Error ? error.message : String(error),
				now: Date.now(),
			})
	}
}

function toPageHash(body: string): string {
	return Bun.hash(body).toString(16)
}

export function openPageStore(filepath: string): PageStore {
	fs.mkdirSync(path.dirname(filepath), {recursive: true})
	const db = new SQLiteDatabase(filepath, {create: true, strict: true})
	db.exec("PRAGMA journal_mode = WAL")
	const {user_version: version} = db
		.query<{user_version: number}, []>("PRAGMA user_version")
		.get()!
	for (let i = version; i < MIGRATIONS.length; i++) {
		db.transaction(() => {
			db.exec(MIGRATIONS[i]!)
			db.exec(`PRAGMA user_version = ${i + 1}`)
		})()
		logger.info("openPageStore", "applied migration", {version: i + 1})
	}
	return new PageStore(db)
}

let pageStore: PageStore | null = null

/** Where fetched pages are stored; until it's set, they're only fetched */
export function setPageStore(store: PageStore) {
	pageStore = store
}

/** When a page was last fetched and its hash; null if never, or no store */
export function getPageInfo(
	source: PageSource,
	url: string,
): {fetchedAt: number; hash: string} | null {
	return pageStore?.getInfo(source, url) ?? null
}

/**
 * When a page was last fetched, whether it parsed or not; null if never, or
 * nothing is stored
 */
export function getPageLastFetchedAt(
	source: PageSource,
	url: string,
): number | null {
	return pageStore?.getLastFetchedAt(source, url) ?? null
}

let offline = false

/**
 * In offline mode nothing is fetched: a read gets the stored copy however
 * old it is, and fails with an OfflineError if there isn't one. For dev, so
 * working on the site doesn't load the KHL.
 */
export function setOfflineMode(value: boolean) {
	offline = value
}

export function isOfflineMode(): boolean {
	return offline
}

/**
 * A read in offline mode of a page that isn't stored. A FetchError, so it's
 * handled like the site being down (a 502, or an extra left out), though the
 * syncer doesn't count it as a failure (see KHLSyncer.syncPage).
 */
export class OfflineError extends FetchError {
	constructor(url: string) {
		super("offline mode: page isn't stored", "GET", url, null)
		this.name = "OfflineError"
	}
}

/** How a read uses stored pages */
export interface PageReadPolicy {
	/** Read a stored page up to this old instead of fetching it */
	maxAgeMs: number
	/** If the fetch fails, serve the stored page however old it is */
	allowStale: boolean
}

const pageReadPolicy = new AsyncLocalStorage<PageReadPolicy>()

/** Outside of withPageReadPolicy, every read fetches, and a failure fails */
const FETCH_ONLY: PageReadPolicy = {maxAgeMs: 0, allowStale: false}

export function withPageReadPolicy<T>(
	policy: PageReadPolicy,
	work: () => Promise<T>,
): Promise<T> {
	return pageReadPolicy.run(policy, work)
}

/** Where one page or cached value a request used came from */
export type PageLoadSource =
	/** A parsed value already in memory (KHLCache), by its cache key */
	| "memory"
	/** A stored page recent enough to use */
	| "stored"
	| "fetched"
	/** A stored page served because its fetch failed */
	| "stale"

export interface PageLoad {
	source: PageLoadSource
	/** A cache key for "memory", else the page's URL */
	key: string
	/** Time spent fetching; 0 unless fetched */
	ms: number
	/** The parsed page's hash; null for "memory", or a page not stored */
	hash?: string | null
}

const pageLoadLogs = new AsyncLocalStorage<PageLoad[][]>()

/**
 * Runs `work`, recording each page it loads in `log` (see PageLoad). Logs
 * nest: a load is recorded in every log around it.
 */
export function withPageLoadLog<T>(log: PageLoad[], work: () => T): T {
	return pageLoadLogs.run([...(pageLoadLogs.getStore() ?? []), log], work)
}

/** Records a page load in each log around it, if there are any */
export function recordPageLoad(load: PageLoad) {
	for (const log of pageLoadLogs.getStore() ?? []) {
		log.push(load)
	}
}

/** Fetches in flight, so concurrent reads of one page share a request */
const fetching = new Map<string, Promise<string>>()

function fetchShared(
	source: PageSource,
	url: string,
	fetchBody: () => Promise<string>,
): Promise<string> {
	const key = `${source} ${url}`
	const inFlight = fetching.get(key)
	if (inFlight) {
		return inFlight
	}
	const body = fetchBody().finally(() => fetching.delete(key))
	fetching.set(key, body)
	return body
}

export interface ReadPageOptions {
	/**
	 * False for pages not worth keeping, like one-off searches: they're
	 * always fetched, and never stored
	 */
	store?: boolean
}

/**
 * A page, parsed: the stored copy if it's recent enough (see
 * withPageReadPolicy), or else `fetchBody`'s. A fetched page replaces the
 * stored copy only once it parses; one that doesn't is kept apart (see
 * putFailed). If the fetch fails, or what it fetched doesn't parse, the
 * policy can fall back to the stored copy.
 */
export async function readPage<T>(
	source: PageSource,
	url: string,
	fetchBody: () => Promise<string>,
	parse: (body: string) => T,
	{store = true}: ReadPageOptions = {},
): Promise<T> {
	const pages = store ? pageStore : null
	const policy = pageReadPolicy.getStore() ?? FETCH_ONLY
	// The stored copy, parsed; null if there isn't one, or it doesn't parse
	// (e.g. after a parser change), in which case the page is fetched
	const readStored = (): {
		value: T
		hash: string
		fetchedAt: number
	} | null => {
		const stored = pages?.get(source, url)
		if (!stored) {
			return null
		}
		try {
			return {
				value: parse(stored.body),
				hash: stored.hash,
				fetchedAt: stored.fetchedAt,
			}
		} catch (error) {
			logger.warn("readPage", "stored page doesn't parse", {
				source,
				url,
				error,
			})
			return null
		}
	}
	const info = pages?.getInfo(source, url) ?? null
	if (offline) {
		const stored = readStored()
		if (!stored) {
			throw new OfflineError(url)
		}
		recordPageLoad({source: "stored", key: url, ms: 0, hash: stored.hash})
		return stored.value
	}
	if (pages && info && Date.now() - info.fetchedAt < policy.maxAgeMs) {
		const stored = readStored()
		if (stored) {
			recordPageLoad({
				source: "stored",
				key: url,
				ms: 0,
				hash: stored.hash,
			})
			return stored.value
		}
	}

	// The stored copy, parsed, in place of a failed fetch or parse
	const fallBack = (error: unknown): T => {
		const stored = policy.allowStale ? readStored() : null
		if (!stored) {
			throw error
		}
		logger.warn("readPage", "serving the stored copy", {
			source,
			url,
			fetchedAt: new Date(stored.fetchedAt).toISOString(),
			error,
		})
		recordPageLoad({source: "stale", key: url, ms: 0, hash: stored.hash})
		return stored.value
	}

	const start = Date.now()
	let body: string
	try {
		body = await fetchShared(source, url, fetchBody)
	} catch (error) {
		return fallBack(error)
	}
	let value: T
	try {
		value = parse(body)
	} catch (error) {
		try {
			pages?.putFailed(source, url, body, error)
		} catch (storeError) {
			logger.warn("readPage", "couldn't keep the failed page", {
				source,
				url,
				error: storeError,
			})
		}
		return fallBack(error)
	}
	let hash: string | null = null
	try {
		hash = pages?.put(source, url, body).hash ?? null
	} catch (error) {
		logger.warn("readPage", "couldn't store page", {source, url, error})
	}
	recordPageLoad({source: "fetched", key: url, ms: Date.now() - start, hash})
	return value
}
