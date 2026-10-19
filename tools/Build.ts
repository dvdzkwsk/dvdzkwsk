import * as fs from "fs"
import * as path from "path"
import {search} from "@inquirer/prompts"
import crossSpawn from "cross-spawn"
import {z} from "zod"
import {Cloudflare} from "./Cloudflare.js"
import {Logger} from "../pkg/logger/Logger.js"
import {createCliTool, getEnvVar} from "../pkg/util/CliUtil.js"
import {getGitRevision} from "../pkg/util/GitUtil.js"
import {matchFn, matchField} from "../pkg/util/MatchUtil.js"

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
		deploy: {type: "fly", domain: "khl.dvdzkwsk.com"},
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
	/**
	 * A container running `server`, configured by the project's fly.toml.
	 * `domain` is served through the Cloudflare proxy (see ensureFlyDomain).
	 */
	| {type: "fly"; domain?: string}

/** Run with --dev to start dev servers, --deploy to build and publish. */
async function main() {
	const project = await promptBuildTarget()
	return matchFn(project.type, {
		webapp: () => {
			if (process.argv.includes("--dev")) {
				return devWebApp(project)
			}
			if (process.argv.includes("--deploy")) {
				return deployWebApp(project)
			}
			return buildWebApp(project)
		},
	})
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
	return matchField(project.deploy, "type", {
		netlify: (deploy) => deployToNetlify(project, deploy.siteIdEnvVar),
		fly: (deploy) => deployToFly(project, deploy.domain),
	})
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
async function deployToFly(project: Project, domain?: string) {
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
	// After the deploy, since a new app has no IP addresses until then
	if (domain) {
		await ensureFlyDomain(config, domain)
	}
}

/**
 * Serves `domain` from the app through the Cloudflare proxy: a Fly
 * certificate, proxied DNS records, an unproxied _acme-challenge CNAME so Fly
 * can renew the certificate behind the proxy, and a Configuration Rule that
 * makes Cloudflare connect over HTTPS (with Flexible SSL, fly.toml's
 * force_https redirects forever).
 */
async function ensureFlyDomain(config: FlyConfig, domain: string) {
	const token = getEnvVar("CLOUDFLARE_API_TOKEN", false)
	if (!token) {
		logger.warn("ensureFlyDomain", "skipping DNS and certificate setup", {
			domain,
		})
		return
	}

	const certs =
		captureJson(
			"fly",
			["certs", "list", "--app", config.app, "--json"],
			z.array(z.object({hostname: z.string()})),
		) ?? []
	if (!certs.some((c) => c.hostname === domain)) {
		logger.info("ensureFlyDomain", "adding Fly certificate", {domain})
		run("fly", ["certs", "add", domain, "--app", config.app])
	}
	const cert = readFlyCert(config, domain)
	const {a, aaaa, acme_challenge} = cert.dns_requirements

	const cloudflare = new Cloudflare(token)
	const zone = await cloudflare.findZone(domain)
	await cloudflare.syncDnsRecords(zone, domain, [
		...a.map((ip) => ({type: "A" as const, content: ip, proxied: true})),
		...aaaa.map((ip) => ({
			type: "AAAA" as const,
			content: ip,
			proxied: true,
		})),
	])
	await cloudflare.syncDnsRecords(zone, acme_challenge.name, [
		{type: "CNAME", content: acme_challenge.target, proxied: false},
	])
	await cloudflare.upsertConfigRule(zone, {
		ref: `ssl_strict_${domain.replaceAll(/[^a-z0-9]/gi, "_")}`,
		description: `Full (strict) SSL for ${domain}, set by tools/Build.ts`,
		expression: `(http.host eq "${domain}")`,
		action: "set_config",
		action_parameters: {ssl: "strict"},
		enabled: true,
	})

	// Showing the certificate also has Fly recheck its DNS validation
	logger.info("ensureFlyDomain", "domain configured", {
		domain,
		certificate: readFlyCert(config, domain).status,
	})
}

const FlyCertSchema = z.object({
	status: z.string(),
	dns_requirements: z.object({
		a: z.array(z.string()),
		aaaa: z.array(z.string()),
		acme_challenge: z.object({name: z.string(), target: z.string()}),
	}),
})

function readFlyCert(config: FlyConfig, domain: string) {
	const cert = captureJson(
		"fly",
		["certs", "show", domain, "--app", config.app, "--json"],
		FlyCertSchema,
	)
	if (!cert) {
		throw logger.newError("readFlyCert", "can't read Fly certificate", {
			app: config.app,
			domain,
		})
	}
	return cert
}

interface FlyConfig {
	app: string
	region: string
	volume: {name: string; sizeGb: number} | null
}

const FlyTomlSchema = z.object({
	app: z.string().min(1),
	primary_region: z.string().min(1),
	mounts: z
		.array(
			z.object({
				source: z.string().min(1),
				initial_size: z.string().optional(),
			}),
		)
		.optional(),
})

/** The parts of the project's fly.toml needed to provision it. */
function readFlyConfig(project: Project): FlyConfig {
	const filepath = path.join(project.path, "fly.toml")
	const result = FlyTomlSchema.safeParse(
		Bun.TOML.parse(fs.readFileSync(filepath, "utf8")),
	)
	if (!result.success) {
		throw logger.newError("readFlyConfig", "fly.toml is missing settings", {
			filepath,
			issues: z.prettifyError(result.error),
		})
	}
	const toml = result.data
	const mount = toml.mounts?.[0]
	return {
		app: toml.app,
		region: toml.primary_region,
		volume: mount
			? {
					name: mount.source,
					sizeGb: Number.parseInt(mount.initial_size ?? "1", 10) || 1,
				}
			: null,
	}
}

/**
 * Creates the app and its volume if they don't exist, and grows the volume
 * to fly.toml's size if it's smaller, so deploying is the same command the
 * first time as every time after. Volumes can't shrink.
 */
function ensureFlyResources(config: FlyConfig) {
	if (capture("fly", ["auth", "whoami"]) === null) {
		throw logger.newError(
			"ensureFlyResources",
			"not logged in to Fly; run `fly auth login` (or set FLY_API_TOKEN)",
		)
	}

	// flyctl's JSON casing differs between commands; accept either
	const NamedListSchema = z.array(
		z.object({Name: z.string().optional(), name: z.string().optional()}),
	)
	const nameOf = (item: {Name?: string; name?: string}) =>
		item.Name ?? item.name
	const apps =
		captureJson("fly", ["apps", "list", "--json"], NamedListSchema) ?? []
	if (!apps.some((a) => nameOf(a) === config.app)) {
		logger.info("ensureFlyResources", "creating Fly app", {app: config.app})
		run("fly", ["apps", "create", config.app, "--org", "personal"])
	}

	if (config.volume) {
		const VolumeListSchema = z.array(
			z.object({id: z.string(), name: z.string(), size_gb: z.number()}),
		)
		const volumes =
			captureJson(
				"fly",
				["volumes", "list", "--app", config.app, "--json"],
				VolumeListSchema,
			) ?? []
		const existing = volumes.find((v) => v.name === config.volume!.name)
		if (existing && existing.size_gb < config.volume.sizeGb) {
			logger.info("ensureFlyResources", "growing Fly volume", {
				app: config.app,
				volumeId: existing.id,
				fromGb: existing.size_gb,
				toGb: config.volume.sizeGb,
			})
			run("fly", [
				"volumes",
				"extend",
				existing.id,
				"--app",
				config.app,
				"--size",
				String(config.volume.sizeGb),
				"--yes",
			])
		}
		if (!existing) {
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

/**
 * Runs a command and parses its stdout as JSON matching `schema`, or returns
 * null if the command fails. Throws if the output doesn't match.
 */
function captureJson<T>(
	command: string,
	args: string[],
	schema: z.ZodType<T>,
): T | null {
	const stdout = capture(command, args)
	if (stdout === null) {
		return null
	}
	let json: unknown
	try {
		json = JSON.parse(stdout)
	} catch (error) {
		throw logger.newError("captureJson", "command printed invalid JSON", {
			command: [command, ...args].join(" "),
			error,
		})
	}
	const result = schema.safeParse(json)
	if (!result.success) {
		throw logger.newError("captureJson", "unexpected command output", {
			command: [command, ...args].join(" "),
			issues: z.prettifyError(result.error),
		})
	}
	return result.data
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
