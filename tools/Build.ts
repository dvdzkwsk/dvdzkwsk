import * as fs from "fs"
import * as path from "path"
import {search} from "@inquirer/prompts"
import crossSpawn from "cross-spawn"
import {createCliTool, getEnvVar} from "../pkg/util/CliUtil.js"
import {Logger} from "../pkg/util/Logger.js"

const logger = new Logger("Build")

const REPO_ROOT = path.join(import.meta.dirname, "..")

interface BuildOptions {
	dev: boolean
}

const targets: Record<string, (options: BuildOptions) => Promise<void>> = {
	website: buildWebsite,
}

async function main() {
	const targetName = await promptTarget()

	const builder = targets[targetName]
	if (!builder) {
		throw logger.newError("main", "unknown build target", {
			target: targetName,
		})
	}

	await builder({dev: process.argv.includes("--dev")})
}

async function promptTarget(): Promise<string> {
	const names = Object.keys(targets)
	return search({
		message: "Select a build target",
		source: (input) => {
			const query = input?.toLowerCase() ?? ""
			return names
				.filter((name) => name.toLowerCase().includes(query))
				.map((name) => ({value: name}))
		},
	})
}

async function buildWebsite(options: BuildOptions) {
	const srcdir = path.join(REPO_ROOT, "pkg/website")
	const outdir = path.join(REPO_ROOT, "dist/website")

	if (options.dev) {
		crossSpawn(
			"vite",
			["dev", "--config", path.join(srcdir, "vite.config.js")],
			{
				stdio: "inherit",
			},
		)
		return
	}

	fs.rmSync(outdir, {recursive: true, force: true})
	crossSpawn.sync(
		"vite",
		["build", "--config", path.join(srcdir, "vite.config.js")],
		{stdio: "inherit"},
	)

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

createCliTool(import.meta, main)
