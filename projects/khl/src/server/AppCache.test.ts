import {describe, expect, test} from "bun:test"
import {z} from "zod"
import {AppCache} from "./AppCache.js"
import {openDatabase} from "./Database.js"

const Schema = z.object({name: z.string()})

describe("AppCache", () => {
	test("a new process reads a value back from SQLite", () => {
		const db = openDatabase(":memory:")
		new AppCache(db).set("k", {name: "Bullets"}, 123)
		const read = new AppCache(db).get("k", Schema)
		expect(read?.value).toEqual({name: "Bullets"})
		expect(read?.staleAt).toBe(123)
	})

	test("a value that no longer matches its schema is left out", () => {
		const db = openDatabase(":memory:")
		new AppCache(db).set("k", {id: 1}, 123)
		expect(new AppCache(db).get("k", Schema)).toBeNull()
	})

	test("a value never computed is null", () => {
		expect(
			new AppCache(openDatabase(":memory:")).get("k", Schema),
		).toBeNull()
	})
})
