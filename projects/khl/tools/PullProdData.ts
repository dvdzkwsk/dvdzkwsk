import * as fs from "fs"
import * as path from "path"
import {Logger} from "@dvdzkwsk/logger"
import {createCliTool, runCommand} from "@dvdzkwsk/util/CliUtil"
import {doFetch} from "@dvdzkwsk/util/FetchUtil"
import {Database} from "bun:sqlite"
import {z} from "zod"

// Copies production's databases into data/, so dev has the whole league
// without fetching it from the KHL. Pair with offline mode (on /admin) to
// make sure dev never fetches at all.
//
//   bun tools/PullProdData.ts            the league tables and player ids
//   bun tools/PullProdData.ts --sources  also every stored page (1.5-3 GB),
//                                        to reprocess after a parser change
//
// Stop the dev server first. Each local file it replaces is kept beside it
// as *.bak. Uses your `fly auth login` session (or FLY_API_TOKEN).

const logger = new Logger("PullProdData")

const PROJECT_DIR = path.join(import.meta.dirname, "..")

const FlyTomlSchema = z.object({
	app: z.string(),
	env: z.object({
		KHL_DB_PATH: z.string(),
		KHL_SOURCES_DB_PATH: z.string(),
	}),
})

interface Pull {
	remotePath: string
	/** Where the server reads it locally; see Server.ts */
	localPath: string
}

async function main() {
	await assertDevServerStopped()
	const fly = readFlyToml()
	const pulls: Pull[] = [
		{
			remotePath: fly.env.KHL_DB_PATH,
			localPath:
				process.env.KHL_DB_PATH ??
				path.join(PROJECT_DIR, "data/khl.sqlite"),
		},
	]
	if (process.argv.includes("--sources")) {
		pulls.push({
			remotePath: fly.env.KHL_SOURCES_DB_PATH,
			localPath:
				process.env.KHL_SOURCES_DB_PATH ??
				path.join(PROJECT_DIR, "data/sources.sqlite"),
		})
	}
	for (const pull of pulls) {
		pullDatabase(fly.app, pull)
	}
}

/** The dev server holds the databases open, so they can't be swapped under it */
async function assertDevServerStopped() {
	const port = Number(process.env.KHL_API_PORT ?? 3001)
	const running = await doFetch({
		method: "GET",
		url: `http://localhost:${port}/api/health`,
		responseSchema: z.unknown(),
		timeoutMs: 2000,
	}).then(
		() => true,
		() => false,
	)
	if (running) {
		throw logger.newError(
			"assertDevServerStopped",
			"the dev server is running; stop it first",
			{port},
		)
	}
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

/**
 * Snapshots the database on the machine (VACUUM INTO, a consistent copy
 * while the server keeps writing), downloads it, and swaps it in
 */
function pullDatabase(app: string, {remotePath, localPath}: Pull) {
	const snapshotPath = `${remotePath}.snapshot`
	const downloadPath = `${localPath}.download`
	logger.info("pullDatabase", "snapshotting", {app, remotePath})
	runRemote(app, getSnapshotScript(remotePath, snapshotPath))
	try {
		fs.rmSync(downloadPath, {force: true})
		fs.mkdirSync(path.dirname(localPath), {recursive: true})
		logger.info("pullDatabase", "downloading", {snapshotPath, downloadPath})
		runCommand("fly", [
			"ssh",
			"sftp",
			"get",
			"--app",
			app,
			snapshotPath,
			downloadPath,
		])
	} finally {
		runRemote(
			app,
			`require("fs").rmSync(${JSON.stringify(snapshotPath)}, {force: true})`,
		)
	}
	assertIntact(downloadPath)
	backUp(localPath)
	fs.renameSync(downloadPath, localPath)
	logger.info("pullDatabase", "pulled", {
		localPath,
		mb: Math.round(fs.statSync(localPath).size / 1e6),
	})
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
function runRemote(app: string, script: string) {
	const encoded = Buffer.from(script).toString("base64")
	runCommand("fly", [
		"ssh",
		"console",
		"--app",
		app,
		"--command",
		`bun -e 'eval(atob("${encoded}"))'`,
	])
}

function assertIntact(filepath: string) {
	const db = new Database(filepath, {readonly: true})
	try {
		const row = db
			.query<{quick_check: string}, []>("PRAGMA quick_check")
			.get()
		if (row?.quick_check !== "ok") {
			throw logger.newError("assertIntact", "snapshot is corrupt", {
				filepath,
				check: row?.quick_check,
			})
		}
	} finally {
		db.close()
	}
}

/**
 * Moves the local database aside as *.bak, with its WAL and shared-memory
 * files (named for the database, so they follow it), replacing any older
 * backup
 */
function backUp(localPath: string) {
	if (!fs.existsSync(localPath)) {
		return
	}
	const backupPath = `${localPath}.bak`
	for (const suffix of ["", "-wal", "-shm"]) {
		fs.rmSync(backupPath + suffix, {force: true})
		if (fs.existsSync(localPath + suffix)) {
			fs.renameSync(localPath + suffix, backupPath + suffix)
		}
	}
	logger.info("backUp", "kept the old database", {backupPath})
}

createCliTool(import.meta, main)
