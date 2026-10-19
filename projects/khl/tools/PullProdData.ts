import * as fs from "fs"
import * as path from "path"
import {Logger} from "@dvdzkwsk/logger"
import {runCommandAsync} from "@dvdzkwsk/util/CliUtil"
import {z} from "zod"

// Downloads snapshots of production's databases, for dev to replace its own
// with (see PULL_PROD_DATA_ENDPOINT, run from /admin). Uses your
// `fly auth login` session (or FLY_API_TOKEN).

const logger = new Logger("PullProdData")

const PROJECT_DIR = path.join(import.meta.dirname, "..")

const FlyTomlSchema = z.object({
	app: z.string(),
	env: z.object({
		KHL_DB_PATH: z.string(),
		KHL_SOURCES_DB_PATH: z.string(),
	}),
})

/** Production's databases: the league tables and player ids, and the pages */
export type ProdDatabase = "khl" | "sources"

/**
 * Snapshots each database on the machine (VACUUM INTO, a consistent copy
 * while the server keeps writing), and downloads it into `dir`. Returns the
 * downloaded files' paths, which the caller deletes once it's done.
 */
export async function downloadProdSnapshots(
	databases: ProdDatabase[],
	dir: string,
): Promise<Record<ProdDatabase, string | null>> {
	const fly = readFlyToml()
	const remotePaths: Record<ProdDatabase, string> = {
		khl: fly.env.KHL_DB_PATH,
		sources: fly.env.KHL_SOURCES_DB_PATH,
	}
	const downloaded: Record<ProdDatabase, string | null> = {
		khl: null,
		sources: null,
	}
	fs.mkdirSync(dir, {recursive: true})
	for (const database of databases) {
		const remotePath = remotePaths[database]
		const downloadPath = path.join(dir, `${database}.sqlite.download`)
		await downloadSnapshot(fly.app, remotePath, downloadPath)
		downloaded[database] = downloadPath
	}
	return downloaded
}

function readFlyToml(): z.infer<typeof FlyTomlSchema> {
	const filepath = path.join(PROJECT_DIR, "fly.toml")
	const result = FlyTomlSchema.safeParse(
		Bun.TOML.parse(fs.readFileSync(filepath, "utf8")),
	)
	if (!result.success) {
		throw logger.newError("readFlyToml", "fly.toml is missing settings", {
			filepath,
			issues: z.prettifyError(result.error),
		})
	}
	return result.data
}

async function downloadSnapshot(
	app: string,
	remotePath: string,
	downloadPath: string,
) {
	const snapshotPath = `${remotePath}.snapshot`
	logger.info("downloadSnapshot", "snapshotting", {app, remotePath})
	await runRemote(app, getSnapshotScript(remotePath, snapshotPath))
	try {
		fs.rmSync(downloadPath, {force: true})
		logger.info("downloadSnapshot", "downloading", {
			snapshotPath,
			downloadPath,
		})
		await runCommandAsync("fly", [
			"ssh",
			"sftp",
			"get",
			"--app",
			app,
			snapshotPath,
			downloadPath,
		])
	} finally {
		await runRemote(
			app,
			`require("fs").rmSync(${JSON.stringify(snapshotPath)}, {force: true})`,
		)
	}
}

/**
 * Bun code that writes a snapshot of `dbPath` to `snapshotPath`, failing
 * first if the volume hasn't room for it
 */
function getSnapshotScript(dbPath: string, snapshotPath: string): string {
	const db = JSON.stringify(dbPath)
	const snapshot = JSON.stringify(snapshotPath)
	return `
		const fs = require("fs")
		const {Database} = require("bun:sqlite")
		fs.rmSync(${snapshot}, {force: true})
		const {bavail, bsize} = fs.statfsSync(require("path").dirname(${db}))
		const needed = fs.statSync(${db}).size
		if (bavail * bsize < needed * 1.1) {
			throw new Error("not enough room on the volume for a snapshot of " + ${db})
		}
		new Database(${db}).run("VACUUM INTO ?", [${snapshot}])
	`
}

/**
 * Runs Bun code on the app's machine. Passed base64-encoded, so it needs no
 * quoting through `fly ssh console`.
 */
function runRemote(app: string, script: string): Promise<void> {
	const encoded = Buffer.from(script).toString("base64")
	return runCommandAsync("fly", [
		"ssh",
		"console",
		"--app",
		app,
		"--command",
		`bun -e 'eval(atob("${encoded}"))'`,
	])
}
