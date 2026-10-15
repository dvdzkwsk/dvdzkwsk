import * as fs from "fs"
import * as path from "path"
import {search} from "@inquirer/prompts"
import crossSpawn from "cross-spawn"
import {Logger} from "../pkg/logger/Logger.js"
import {createCliTool, getEnvVar} from "../pkg/util/CliUtil.js"
import {getGitRevision} from "../pkg/util/GitUtil.js"

const logger = new Logger("Build")

const REPO_ROOT = path.join(import.meta.dirname, "..")

const PROJECTS: Project[] = [
	{
		path: path.join(REPO_ROOT, "projects/website"),
		type: "webapp",
		deploy: {type: "netlify", siteIdEnvVar: "WEBSITE_NETLIFY_PROJECT_ID"},
	},
	{
		path: path.join(REPO_ROOT, "projects/khl"),
		type: "webapp",
		server: "src/server/Server.ts",
		// The server serves the app and /api from one process (see fly.toml)
		deploy: {type: "fly"},
	},
]

interface Project {
	path: string
	type: "webapp"
	/** API server entry, relative to `path`. Run with --watch in dev. */
	server?: string
	deploy: DeployTarget
}

type DeployTarget =
	/** Static hosting; `siteIdEnvVar` names the env var with the site id */
	| {type: "netlify"; siteIdEnvVar: string}
	/** A container running `server`, configured by the project's fly.toml */
	| {type: "fly"}

/** Run with --dev to start dev servers, --deploy to build and publish. */
async function main() {
	const project = await promptBuildTarget()
	switch (project.type) {
		case "webapp":
			if (process.argv.includes("--dev")) {
				return devWebApp(project)
			}
			if (process.argv.includes("--deploy")) {
				return deployWebApp(project)
			}
			return buildWebApp(project)
	}
}

async function promptBuildTarget(): Promise<Project> {
	// Package scripts run from the project's directory, so skip the prompt.
	const cwdProject = PROJECTS.find((p) => p.path === process.cwd())
	if (cwdProject) {
		return cwdProject
	}
	return search<Project>({
		message: "Select a build target",
		source: (input) => {
			const query = input?.toLowerCase() ?? ""
			return PROJECTS.filter((p) =>
				p.path.toLowerCase().includes(query),
			).map((p) => {
				return {
					name: p.path,
					value: p,
				}
			})
		},
	})
}

function devWebApp(project: Project) {
	const children = [
		crossSpawn(
			"vite",
			["dev", "--config", path.join(project.path, "vite.config.js")],
			{
				stdio: "inherit",
			},
		),
	]
	if (project.server) {
		// Restarts the server whenever it or anything it imports changes.
		children.push(
			crossSpawn("bun", ["--watch", project.server], {
				cwd: project.path,
				stdio: "inherit",
			}),
		)
	}
	// If either process exits, stop the other so nothing is left running.
	for (const child of children) {
		child.on("exit", (code) => {
			for (const other of children) {
				other.kill()
			}
			process.exitCode = code ?? 0
		})
	}
	// Ctrl-C signals the whole process group, but a plain `kill` of this
	// process doesn't reach the children; forward it so they aren't orphaned.
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.on(signal, () => {
			for (const child of children) {
				child.kill(signal)
			}
		})
	}
}

/** Builds into `<project>/dist/website` and returns that directory. */
function buildWebApp(project: Project): string {
	const outdir = path.join(project.path, "dist/website")
	fs.rmSync(outdir, {recursive: true, force: true})
	run("vite", [
		"build",
		"--config",
		path.join(project.path, "vite.config.js"),
	])
	if (!fs.existsSync(path.join(outdir, "index.html"))) {
		throw logger.newError("buildWebApp", "build produced no index.html", {
			outdir,
		})
	}
	return outdir
}

function deployWebApp(project: Project) {
	switch (project.deploy.type) {
		case "netlify":
			return deployToNetlify(project, project.deploy.siteIdEnvVar)
		case "fly":
			return deployToFly(project)
	}
}

/**
 * Publishes the static build. Netlify only serves files, so client-side
 * routes (e.g. /players/:id) fall back to index.html.
 */
function deployToNetlify(project: Project, siteIdEnvVar: string) {
	if (project.server) {
		throw logger.newError(
			"deployToNetlify",
			"Netlify can't run this project's server; deploy it to Fly instead",
			{project: project.path},
		)
	}
	// Read config up front so a missing variable fails before the build
	const authToken = getEnvVar("NETLIFY_AUTH_TOKEN")
	const siteId = getEnvVar(siteIdEnvVar)
	const outdir = buildWebApp(project)
	fs.writeFileSync(path.join(outdir, "_redirects"), "/*  /index.html  200\n")
	run(
		"netlify",
		["deploy", "--dir", outdir, "--site", siteId, "--no-build", "--prod"],
		{env: {NETLIFY_AUTH_TOKEN: authToken}},
	)
}

/**
 * Builds the frontend, bundles the server and its dependencies into
 * dist/server.js, and ships both in the image described by the project's
 * Dockerfile. Uses your `fly auth login` session, or FLY_API_TOKEN if set.
 */
function deployToFly(project: Project) {
	if (!project.server) {
		throw logger.newError("deployToFly", "project has no server to run", {
			project: project.path,
		})
	}
	// Fail on config/auth problems before spending time on the build
	const config = readFlyConfig(project)
	ensureFlyResources(config)

	buildWebApp(project)
	run(
		"bun",
		[
			"build",
			project.server,
			"--target",
			"bun",
			"--outfile",
			"dist/server.js",
		],
		{cwd: project.path},
	)
	// The server reports these on /api/health and the status page. The
	// project and the shared packages are what go into the build.
	const revision = getGitRevision(project.path, [".", "../../pkg"])
	if (!revision) {
		throw logger.newError("deployToFly", "can't read the git commit", {
			project: project.path,
		})
	}
	run(
		"fly",
		[
			"deploy",
			"--app",
			config.app,
			"--env",
			`KHL_COMMIT_SHA=${revision.commit}`,
			"--env",
			`KHL_COMMIT_DIRTY=${revision.dirty}`,
			"--env",
			`KHL_DEPLOYED_AT=${new Date().toISOString()}`,
		],
		{cwd: project.path},
	)
}

interface FlyConfig {
	app: string
	region: string
	volume: {name: string; sizeGb: number} | null
}

/** The parts of the project's fly.toml needed to provision it. */
function readFlyConfig(project: Project): FlyConfig {
	const filepath = path.join(project.path, "fly.toml")
	const toml = Bun.TOML.parse(fs.readFileSync(filepath, "utf8")) as {
		app?: string
		primary_region?: string
		mounts?: {source?: string; initial_size?: string}[]
	}
	const mount = toml.mounts?.[0]
	if (!toml.app || !toml.primary_region || (mount && !mount.source)) {
		throw logger.newError("readFlyConfig", "fly.toml is missing settings", {
			filepath,
			required: ["app", "primary_region", "mounts.source"],
		})
	}
	return {
		app: toml.app,
		region: toml.primary_region,
		volume: mount
			? {
					name: mount.source!,
					sizeGb: Number.parseInt(mount.initial_size ?? "1", 10) || 1,
				}
			: null,
	}
}

/**
 * Creates the app and its volume if they don't exist, so deploying is the
 * same command the first time as every time after.
 */
function ensureFlyResources(config: FlyConfig) {
	if (capture("fly", ["auth", "whoami"]) === null) {
		throw logger.newError(
			"ensureFlyResources",
			"not logged in to Fly; run `fly auth login` (or set FLY_API_TOKEN)",
		)
	}

	// flyctl's JSON casing differs between commands; accept either
	const nameOf = (item: {Name?: string; name?: string}) =>
		item.Name ?? item.name
	const apps = JSON.parse(
		capture("fly", ["apps", "list", "--json"]) ?? "[]",
	) as {Name?: string; name?: string}[]
	if (!apps.some((a) => nameOf(a) === config.app)) {
		logger.info("ensureFlyResources", "creating Fly app", {app: config.app})
		run("fly", ["apps", "create", config.app, "--org", "personal"])
	}

	if (config.volume) {
		const volumes = JSON.parse(
			capture("fly", [
				"volumes",
				"list",
				"--app",
				config.app,
				"--json",
			]) ?? "[]",
		) as {Name?: string; name?: string}[]
		if (!volumes.some((v) => nameOf(v) === config.volume!.name)) {
			logger.info("ensureFlyResources", "creating Fly volume", {
				app: config.app,
				...config.volume,
			})
			run("fly", [
				"volumes",
				"create",
				config.volume.name,
				"--app",
				config.app,
				"--region",
				config.region,
				"--size",
				String(config.volume.sizeGb),
				"--yes",
			])
		}
	}
}

/** Runs a command and returns its stdout, or null if it fails. */
function capture(command: string, args: string[]): string | null {
	const result = crossSpawn.sync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		// Bun doesn't pass runtime process.env changes (e.g. from .env) to
		// children unless env is given explicitly
		env: process.env,
	})
	return result.status === 0 ? result.stdout : null
}

/** Runs a command to completion, throwing if it fails. */
function run(
	command: string,
	args: string[],
	options: {cwd?: string; env?: Record<string, string>} = {},
) {
	const result = crossSpawn.sync(command, args, {
		stdio: "inherit",
		cwd: options.cwd,
		env: {...process.env, ...options.env},
	})
	if (result.error || result.status !== 0) {
		throw logger.newError("run", "command failed", {
			command: [command, ...args].join(" "),
			status: result.status,
			error: result.error,
		})
	}
}

createCliTool(import.meta, main)
