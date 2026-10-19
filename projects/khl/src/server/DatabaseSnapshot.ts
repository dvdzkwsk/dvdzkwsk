import {Logger} from "@dvdzkwsk/logger"
import {Database as SQLiteDatabase} from "bun:sqlite"

const logger = new Logger("DatabaseSnapshot")

/**
 * Replaces every table's rows with a snapshot's (e.g. production's), in one
 * transaction on the open connection, so whatever holds it keeps working.
 * The snapshot must be migrated to the same schema version first.
 */
export function replaceDatabaseContents(
	db: SQLiteDatabase,
	snapshotPath: string,
) {
	db.run("ATTACH DATABASE ? AS snapshot", [snapshotPath])
	try {
		const versions = {
			local: getUserVersion(db, "main"),
			snapshot: getUserVersion(db, "snapshot"),
		}
		if (versions.local !== versions.snapshot) {
			throw logger.newError(
				"replaceDatabaseContents",
				"snapshot is at a different schema version",
				{snapshotPath, ...versions},
			)
		}
		const tables = db
			.query<{name: string}, []>(
				`SELECT name FROM main.sqlite_master
				WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
			)
			.all()
		// Can't change inside a transaction, and rows go in table by table
		const {foreign_keys: foreignKeys} = db
			.query<{foreign_keys: number}, []>("PRAGMA foreign_keys")
			.get()!
		db.exec("PRAGMA foreign_keys = OFF")
		try {
			db.transaction(() => {
				for (const {name} of tables) {
					// By name, in case the files' columns differ in order
					const columns = db
						.query<{name: string}, []>(
							`PRAGMA main.table_info("${name}")`,
						)
						.all()
						.map((c) => `"${c.name}"`)
						.join(", ")
					db.exec(`DELETE FROM main."${name}"`)
					db.exec(
						`INSERT INTO main."${name}" (${columns})
						SELECT ${columns} FROM snapshot."${name}"`,
					)
				}
			})()
		} finally {
			db.exec(`PRAGMA foreign_keys = ${foreignKeys ? "ON" : "OFF"}`)
		}
		logger.info("replaceDatabaseContents", "replaced", {
			snapshotPath,
			tables: tables.length,
		})
	} finally {
		db.run("DETACH DATABASE snapshot")
	}
}

function getUserVersion(db: SQLiteDatabase, schema: string): number {
	return db
		.query<{user_version: number}, []>(`PRAGMA ${schema}.user_version`)
		.get()!.user_version
}
