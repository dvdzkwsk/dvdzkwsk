import {describe, expect, test} from "bun:test"
import {z} from "zod"
import {KHLCache} from "./Cache.js"
import {openDatabase} from "./Database.js"

const Schema = z.object({name: z.string()})

describe("KHLCache", () => {
	test("a new process reads entries back from SQLite", async () => {
		const db = openDatabase(":memory:")
		await new KHLCache(db).cached("k", 60_000, Schema, async () => ({
			name: "Bullets",
		}))
		let loads = 0
		const value = await new KHLCache(db).cached(
			"k",
			60_000,
			Schema,
			async () => {
				loads++
				return {name: "reloaded"}
			},
		)
		expect(value).toEqual({name: "Bullets"})
		expect(loads).toBe(0)
	})

	test("a stored entry that no longer matches its schema is reloaded", async () => {
		const db = openDatabase(":memory:")
		await new KHLCache(db).cached(
			"k",
			60_000,
			z.object({id: z.number()}),
			async () => ({
				id: 1,
			}),
		)
		const value = await new KHLCache(db).cached(
			"k",
			60_000,
			Schema,
			async () => ({
				name: "Bullets",
			}),
		)
		expect(value).toEqual({name: "Bullets"})
	})

	test("a failed refresh keeps the cached value", async () => {
		const cache = new KHLCache(openDatabase(":memory:"))
		await cache.refresh("k", 60_000, async () => ({name: "Bullets"}))
		const failing = cache.refresh("k", 60_000, async () => {
			throw new Error("KHL 403")
		})
		expect(failing).rejects.toThrow("KHL 403")
		await failing.catch(() => {})
		expect(await cache.getValue("k", Schema)).toEqual({name: "Bullets"})
	})

	test("an invalidated entry is gone from SQLite too", async () => {
		const db = openDatabase(":memory:")
		const cache = new KHLCache(db)
		await cache.refresh("k", 60_000, async () => ({name: "Bullets"}))
		cache.invalidate("k")
		expect(new KHLCache(db).getValue("k", Schema)).toBeNull()
	})
})
