import {describe, expect, test} from "bun:test"
import {z} from "zod"
import {AppCache} from "./AppCache.js"
import {openDatabase} from "./Database.js"

const Schema = z.object({name: z.string()})

describe("AppCache", () => {
	test("a new process reads a value back from SQLite", () => {
		const db = openDatabase(":memory:")
		new AppCache(db).set("k", {name: "Bullets"})
		const read = new AppCache(db).get("k", Schema)
		expect(read?.value).toEqual({name: "Bullets"})
	})

	test("a value that no longer matches its schema is left out", () => {
		const db = openDatabase(":memory:")
		new AppCache(db).set("k", {id: 1})
		expect(new AppCache(db).get("k", Schema)).toBeNull()
	})

	test("knows what was computed without reading it", () => {
		const db = openDatabase(":memory:")
		new AppCache(db).set("k", {name: "Bullets"})
		expect(new AppCache(db).has("k")).toBe(true)
		expect(new AppCache(db).has("other")).toBe(false)
	})

	test("a value never computed is null", () => {
		expect(
			new AppCache(openDatabase(":memory:")).get("k", Schema),
		).toBeNull()
	})
})
