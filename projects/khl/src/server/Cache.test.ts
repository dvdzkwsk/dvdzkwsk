import {describe, expect, test} from "bun:test"
import {KHLCache} from "./Cache.js"
import {openPageStore, readPage, setPageStore} from "./PageStore.js"

const URL = "https://krakenhockeyleague.com/arena/30"

describe("KHLCache", () => {
	test("a new process parses a stored page within the TTL", async () => {
		setPageStore(openPageStore(":memory:"))
		let fetches = 0
		const load = () =>
			readPage(
				"khl",
				URL,
				async () => `page ${++fetches}`,
				(body) => body,
			)
		await new KHLCache().cached("arena-page:30", 60_000, load)
		expect(await new KHLCache().cached("arena-page:30", 60_000, load)).toBe(
			"page 1",
		)
		expect(fetches).toBe(1)
	})

	test("an invalidated entry fetches again", async () => {
		setPageStore(openPageStore(":memory:"))
		let fetches = 0
		const load = () =>
			readPage(
				"khl",
				URL,
				async () => `page ${++fetches}`,
				(body) => body,
			)
		const cache = new KHLCache()
		await cache.cached("arena-page:30", 60_000, load)
		cache.invalidate("arena-page:30")
		expect(await cache.cached("arena-page:30", 60_000, load)).toBe("page 2")
	})

	test("concurrent callers share one load, and failures aren't kept", async () => {
		const cache = new KHLCache()
		let loads = 0
		const failing = async () => {
			loads++
			throw new Error("KHL 403")
		}
		const results = await Promise.allSettled([
			cache.cached("k", 60_000, failing),
			cache.cached("k", 60_000, failing),
		])
		expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"])
		expect(loads).toBe(1)
		expect(await cache.cached("k", 60_000, async () => "ok")).toBe("ok")
	})
})
