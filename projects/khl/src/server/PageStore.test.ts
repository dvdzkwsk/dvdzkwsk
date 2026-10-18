import {describe, expect, test} from "bun:test"
import {
	openPageStore,
	PageLoad,
	readPage,
	setPageStore,
	withPageLoadLog,
	withPageReadPolicy,
} from "./PageStore.js"

const URL = "https://krakenhockeyleague.com/team/1/stats/?season=2143"

describe("PageStore", () => {
	test("stores a page gzipped and reads it back as fetched", () => {
		const store = openPageStore(":memory:")
		expect(store.put("khl", URL, "<html>Bullets</html>")).toBe(true)
		expect(store.get("khl", URL)?.body).toBe("<html>Bullets</html>")
		expect(store.get("livebarn", URL)).toBeNull()
	})

	test("tells a changed page from a refetched copy", () => {
		const store = openPageStore(":memory:")
		store.put("khl", URL, "<html>v1</html>")
		const firstChange = store.get("khl", URL)!.changedAt
		expect(store.put("khl", URL, "<html>v1</html>")).toBe(false)
		expect(store.get("khl", URL)!.changedAt).toBe(firstChange)
		expect(store.put("khl", URL, "<html>v2</html>")).toBe(true)
	})
})

describe("readPage", () => {
	const fetchCounter = () => {
		let fetches = 0
		return {
			fetch: async () => `<html>${++fetches}</html>`,
			count: () => fetches,
		}
	}

	test("reads a stored page within the max age instead of fetching", async () => {
		setPageStore(openPageStore(":memory:"))
		const counter = fetchCounter()
		await readPage("khl", URL, counter.fetch)
		const body = await withPageReadPolicy(
			{maxAgeMs: 60_000, allowStale: false},
			() => readPage("khl", URL, counter.fetch),
		)
		expect(body).toBe("<html>1</html>")
		expect(counter.count()).toBe(1)
	})

	test("fetches outside of a max age, and stores what it fetched", async () => {
		const store = openPageStore(":memory:")
		setPageStore(store)
		const counter = fetchCounter()
		await readPage("khl", URL, counter.fetch)
		expect(await readPage("khl", URL, counter.fetch)).toBe("<html>2</html>")
		expect(store.get("khl", URL)?.body).toBe("<html>2</html>")
	})

	const failing = async (): Promise<string> => {
		throw new Error("KHL 403")
	}

	test("serves the stored copy when a fetch fails, if allowed", async () => {
		setPageStore(openPageStore(":memory:"))
		await readPage("khl", URL, async () => "<html>old</html>")
		const log: PageLoad[] = []
		const body = await withPageLoadLog(log, () =>
			withPageReadPolicy({maxAgeMs: 0, allowStale: true}, () =>
				readPage("khl", URL, failing),
			),
		)
		expect(body).toBe("<html>old</html>")
		expect(log.map((l) => l.source)).toEqual(["stale"])
	})

	test("fails without a stale fallback", async () => {
		setPageStore(openPageStore(":memory:"))
		await readPage("khl", URL, async () => "<html>old</html>")
		expect(readPage("khl", URL, failing)).rejects.toThrow("KHL 403")
	})

	test("logs where each page came from", async () => {
		setPageStore(openPageStore(":memory:"))
		const log: PageLoad[] = []
		await withPageLoadLog(log, async () => {
			await readPage("khl", URL, async () => "<html></html>")
			await withPageReadPolicy({maxAgeMs: 60_000, allowStale: true}, () =>
				readPage("khl", URL, failing),
			)
		})
		expect(log.map((l) => [l.source, l.key])).toEqual([
			["fetched", URL],
			["stored", URL],
		])
	})
})
