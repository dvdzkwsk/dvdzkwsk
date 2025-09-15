import * as fs from "fs"
import * as path from "path"
import crossSpawn from "cross-spawn"
import {Logger} from "../src/util/Logger.js"
import {execScript, getEnvVar} from "./CliUtil.js"

const logger = new Logger("Build")

const REPO_ROOT = path.join(import.meta.dirname, "..")

async function build() {
	const args = process.argv.slice(2)
	const target = args[0]

	switch (target) {
		case "website":
			await buildWebsite()
			break
		default:
			throw logger.newError("build", "unknown build target", {target})
	}
}

async function buildWebsite() {
	const srcdir = path.join(REPO_ROOT, "src/website")
	const outdir = path.join(REPO_ROOT, "dist/website")

	if (hasDevFlag()) {
		crossSpawn(
			"vite",
			["dev", "--config", path.join(srcdir, "vite.config.js")],
			{
				stdio: "inherit",
			},
		)
		return
	}
	if (process.argv.includes("--build")) {
		fs.rmSync(outdir, {
			recursive: true,
			force: true,
		})
		crossSpawn.sync(
			"vite",
			["build", "--config", path.join(srcdir, "vite.config.js")],
			{
				stdio: "inherit",
			},
		)
	}

	if (process.argv.includes("--deploy")) {
		if (!fs.existsSync(outdir)) {
			throw logger.newError(
				"buildWebsite",
				"website output directory does not exist, there is nothing to deploy",
				{outdir},
			)
		}
		const projectId = getEnvVar("WEBSITE_NETLIFY_PROJECT_ID")
		crossSpawn.sync(
			"netlify",
			[
				"deploy",
				"--dir",
				outdir,
				"--site",
				projectId,
				"--no-build",
				"--prod",
			],
			{
				stdio: "inherit",
				env: {
					NETLIFY_AUTH_TOKEN: getEnvVar("NETLIFY_AUTH_TOKEN"),
					...process.env,
				},
			},
		)
	}
}

function hasDevFlag() {
	return process.argv.includes("--dev")
}

execScript(import.meta, build)
