import {afterEach, beforeEach, describe, expect, test} from "bun:test"
import {
	OfflineError,
	openPageStore,
	PageLoad,
	PageStore,
	readPage,
	setOfflineMode,
	setPageStore,
	withPageLoadLog,
	withPageReadPolicy,
} from "./PageStore.js"

const URL = "https://krakenhockeyleague.com/team/1/stats/?season=2143"

/** Parses "<page N>", and fails on anything else */
const parse = (body: string): string => {
	if (!/^<page \d+>$/.test(body)) {
		throw new Error(`can't parse ${body}`)
	}
	return body
}

const READ_STORED = {maxAgeMs: 60_000, allowStale: false}
const STALE_OK = {maxAgeMs: 0, allowStale: true}

describe("PageStore", () => {
	test("stores a page gzipped and reads it back as fetched", () => {
		const store = openPageStore(":memory:")
		store.put("khl", URL, "<page 1>")
		expect(store.get("khl", URL)?.body).toBe("<page 1>")
		expect(store.get("livebarn", URL)).toBeNull()
	})

	test("a page that didn't parse still counts as fetched", () => {
		const store = openPageStore(":memory:")
		expect(store.getLastFetchedAt("khl", URL)).toBeNull()
		store.putFailed("khl", URL, "<maintenance>", new Error("can't parse"))
		expect(store.getLastFetchedAt("khl", URL)).not.toBeNull()
		expect(store.get("khl", URL)).toBeNull()
	})

	test("tells a changed page from a refetched copy", () => {
		const store = openPageStore(":memory:")
		const first = store.put("khl", URL, "<page 1>")
		const changedAt = store.get("khl", URL)!.changedAt
		expect(store.put("khl", URL, "<page 1>").hash).toBe(first.hash)
		expect(store.get("khl", URL)!.changedAt).toBe(changedAt)
		expect(store.put("khl", URL, "<page 2>").hash).not.toBe(first.hash)
	})
})

describe("readPage", () => {
	let store: PageStore
	let fetches: number
	const fetchNext = async () => `<page ${++fetches}>`

	beforeEach(() => {
		store = openPageStore(":memory:")
		setPageStore(store)
		fetches = 0
	})

	afterEach(() => {
		setOfflineMode(false)
	})

	test("offline, serves the stored copy however old, and fetches nothing", async () => {
		await readPage("khl", URL, fetchNext, parse)
		setOfflineMode(true)
		const log: PageLoad[] = []
		const page = await withPageLoadLog(log, () =>
			readPage("khl", URL, fetchNext, parse),
		)
		expect(page).toBe("<page 1>")
		expect(log.map((l) => l.source)).toEqual(["stored"])
		expect(fetches).toBe(1)
	})

	test("offline, a page that isn't stored fails without fetching", async () => {
		setOfflineMode(true)
		await expect(readPage("khl", URL, fetchNext, parse)).rejects.toThrow(
			OfflineError,
		)
		await expect(
			readPage("khl", URL, fetchNext, parse, {store: false}),
		).rejects.toThrow(OfflineError)
		expect(fetches).toBe(0)
	})

	test("reads a stored page within the max age instead of fetching", async () => {
		await readPage("khl", URL, fetchNext, parse)
		const page = await withPageReadPolicy(READ_STORED, () =>
			readPage("khl", URL, fetchNext, parse),
		)
		expect(page).toBe("<page 1>")
		expect(fetches).toBe(1)
	})

	test("fetches outside of a max age, and stores what it fetched", async () => {
		await readPage("khl", URL, fetchNext, parse)
		expect(await readPage("khl", URL, fetchNext, parse)).toBe("<page 2>")
		expect(store.get("khl", URL)?.body).toBe("<page 2>")
	})

	test("a fetched page that doesn't parse leaves the last good copy", async () => {
		await readPage("khl", URL, fetchNext, parse)
		const broken = async () => "<maintenance>"
		await expect(readPage("khl", URL, broken, parse)).rejects.toThrow(
			"can't parse",
		)
		expect(store.get("khl", URL)?.body).toBe("<page 1>")
		// A stale fallback serves the good copy instead
		const page = await withPageReadPolicy(STALE_OK, () =>
			readPage("khl", URL, broken, parse),
		)
		expect(page).toBe("<page 1>")
	})

	test("serves the stored copy when a fetch fails, if allowed", async () => {
		await readPage("khl", URL, fetchNext, parse)
		const failing = async (): Promise<string> => {
			throw new Error("KHL 403")
		}
		const log: PageLoad[] = []
		const page = await withPageLoadLog(log, () =>
			withPageReadPolicy(STALE_OK, () =>
				readPage("khl", URL, failing, parse),
			),
		)
		expect(page).toBe("<page 1>")
		expect(log.map((l) => l.source)).toEqual(["stale"])
		await expect(readPage("khl", URL, failing, parse)).rejects.toThrow(
			"KHL 403",
		)
	})

	test("a page that isn't stored is always fetched, and left out", async () => {
		await readPage("khl", URL, fetchNext, parse, {store: false})
		const page = await withPageReadPolicy(READ_STORED, () =>
			readPage("khl", URL, fetchNext, parse, {store: false}),
		)
		expect(page).toBe("<page 2>")
		expect(store.get("khl", URL)).toBeNull()
	})

	test("concurrent reads of one page share a fetch", async () => {
		const pages = await Promise.all([
			readPage("khl", URL, fetchNext, parse),
			readPage("khl", URL, fetchNext, parse),
		])
		expect(pages).toEqual(["<page 1>", "<page 1>"])
		expect(fetches).toBe(1)
	})

	test("logs each page's source and hash, in every log around it", async () => {
		const outer: PageLoad[] = []
		const inner: PageLoad[] = []
		await withPageLoadLog(outer, async () => {
			await readPage("khl", URL, fetchNext, parse)
			await withPageLoadLog(inner, () =>
				withPageReadPolicy(READ_STORED, () =>
					readPage("khl", URL, fetchNext, parse),
				),
			)
		})
		const hash = store.getInfo("khl", URL)!.hash
		expect(outer.map((l) => [l.source, l.hash])).toEqual([
			["fetched", hash],
			["stored", hash],
		])
		expect(inner.map((l) => l.source)).toEqual(["stored"])
	})
})
