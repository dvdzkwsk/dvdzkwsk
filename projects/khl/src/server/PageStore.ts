import {AsyncLocalStorage} from "async_hooks"
import * as fs from "fs"
import * as path from "path"
import {Logger} from "@dvdzkwsk/logger"
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

	/** Stores a fetched page; true if it differs from the stored copy */
	put(source: PageSource, url: string, body: string): boolean {
		const now = Date.now()
		const hash = Bun.hash(body).toString(16)
		const previous = this.db
			.query<{hash: string}, {url: string}>(
				`SELECT hash FROM ${PAGE_TABLES[source]} WHERE url = $url`,
			)
			.get({url})
		const changed = previous?.hash !== hash
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
		return changed
	}
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
}

const pageLoadLog = new AsyncLocalStorage<PageLoad[]>()

/** Runs `work`, recording each page it loads in `log` (see PageLoad) */
export function withPageLoadLog<T>(log: PageLoad[], work: () => T): T {
	return pageLoadLog.run(log, work)
}

/** Records a page load in the current request's log, if there is one */
export function recordPageLoad(load: PageLoad) {
	pageLoadLog.getStore()?.push(load)
}

/**
 * A page's body: the stored copy if it's recent enough (see
 * withPageReadPolicy), or else `fetchBody`'s, which is stored for next time.
 * If the fetch fails, the policy can fall back to the stored copy.
 */
export async function readPage(
	source: PageSource,
	url: string,
	fetchBody: () => Promise<string>,
): Promise<string> {
	const policy = pageReadPolicy.getStore() ?? FETCH_ONLY
	const stored = pageStore?.get(source, url)
	if (stored && Date.now() - stored.fetchedAt < policy.maxAgeMs) {
		recordPageLoad({source: "stored", key: url, ms: 0})
		return stored.body
	}
	const start = Date.now()
	let body: string
	try {
		body = await fetchBody()
	} catch (error) {
		if (!stored || !policy.allowStale) {
			throw error
		}
		logger.warn("readPage", "fetch failed; serving the stored copy", {
			source,
			url,
			fetchedAt: new Date(stored.fetchedAt).toISOString(),
			error,
		})
		recordPageLoad({source: "stale", key: url, ms: Date.now() - start})
		return stored.body
	}
	recordPageLoad({source: "fetched", key: url, ms: Date.now() - start})
	try {
		pageStore?.put(source, url, body)
	} catch (error) {
		logger.warn("readPage", "couldn't store page", {source, url, error})
	}
	return body
}
