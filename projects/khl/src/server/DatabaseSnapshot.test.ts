import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {Database as SQLiteDatabase} from "bun:sqlite"
import {afterEach, describe, expect, test} from "bun:test"
import {replaceDatabaseContents} from "./DatabaseSnapshot.js"

const dirs: string[] = []

/** A database file with one table and these rows, at this schema version */
const createDatabase = (rows: [number, string][], version = 1) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-test-"))
	dirs.push(dir)
	const filepath = path.join(dir, "db.sqlite")
	const db = new SQLiteDatabase(filepath, {create: true, strict: true})
	db.exec("CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT)")
	db.exec(`PRAGMA user_version = ${version}`)
	for (const [id, name] of rows) {
		db.run("INSERT INTO players (id, name) VALUES (?, ?)", [id, name])
	}
	return {db, filepath}
}

const readNames = (db: SQLiteDatabase) =>
	db
		.query<{name: string}, []>("SELECT name FROM players ORDER BY id")
		.all()
		.map((r) => r.name)

describe("replaceDatabaseContents", () => {
	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			fs.rmSync(dir, {recursive: true, force: true})
		}
	})

	test("replaces every row on the open connection", () => {
		const local = createDatabase([[1, "Dev"]])
		const snapshot = createDatabase([
			[1, "Prod A"],
			[2, "Prod B"],
		])
		snapshot.db.close()
		replaceDatabaseContents(local.db, snapshot.filepath)
		expect(readNames(local.db)).toEqual(["Prod A", "Prod B"])
	})

	test("refuses a snapshot at a different schema version", () => {
		const local = createDatabase([[1, "Dev"]])
		const snapshot = createDatabase([[1, "Prod"]], 2)
		snapshot.db.close()
		expect(() =>
			replaceDatabaseContents(local.db, snapshot.filepath),
		).toThrow("different schema version")
		expect(readNames(local.db)).toEqual(["Dev"])
	})
})
