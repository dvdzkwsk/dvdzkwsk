import * as fs from "fs"
import * as path from "path"
import * as esbuild from "esbuild"
import {Logger} from "@pkg/logger/Logger.js"
import {EsbuildPluginPreact} from "./plugins/EsbuildPluginPreact.js"

const logger = new Logger("Build")

type EnvVars = Record<string, string>

export interface BuildContext {
	buildOptions: BuildOptions
}
export function context(buildOptions: BuildOptions): BuildContext {
	buildOptions = structuredClone(buildOptions)
	buildOptions.env["NODE_ENV"] ??= process.env.NODE_ENV ?? buildOptions.mode
	return {
		buildOptions,
	}
}

export interface BuildOptions {
	workdir: string
	target: "node" | "browser"
	mode: "development" | "production"
	dst: string
	publicdir?: string
	entrypoints: string[]
	env: EnvVars
}

export async function buildToDisk(context: BuildContext) {
	const {buildOptions} = context
	if (fs.existsSync(buildOptions.dst)) {
		logger.debug("rmdir", "destination exists; removing it.", {
			path: buildOptions.dst,
		})
		await fs.promises.rm(buildOptions.dst, {
			recursive: true,
			force: true,
		})
	}
	const esbuildBuildOptions = buildEsbuildOptions(buildOptions)
	const result = await esbuild.build(esbuildBuildOptions)
	logger.info("buildToDisk", "finished esbuild")
	if (result.metafile) {
		logger.debug(
			"buildToDisk",
			"analyze esbuild metafile\n" +
				(await esbuild.analyzeMetafile(result.metafile)),
		)
	}
	if (buildOptions.publicdir) {
		await fs.promises.cp(
			path.resolve(buildOptions.publicdir),
			buildOptions.dst,
			{
				recursive: true,
			},
		)
	}
}

function buildEsbuildOptions(
	buildOptions: BuildOptions,
	options?: {
		hashAssets?: boolean
	},
): esbuild.BuildOptions {
	let esbuildBuildOptions: esbuild.BuildOptions = {}
	switch (buildOptions.target) {
		case "browser":
			esbuildBuildOptions = {
				entryPoints: buildOptions.entrypoints,
				outdir: path.resolve(buildOptions.dst, "assets"),
				assetNames: "[name]",
				entryNames: "[name]",
				bundle: true,
				format: "esm",
				platform: "browser",
				target: "esnext",
				pure: [],
				plugins: [EsbuildPluginPreact(buildOptions.workdir)],
				sourcemap: "linked",
				define: stringifyEnvVars(buildOptions.env),
			}
		case "node":
	}
	switch (buildOptions.mode) {
		case "development":
			esbuildBuildOptions.minify = false
			// TODO(david): figure out a way to get esbuild to roll up very many tiny chunks into one
			// before enabling this. It can be worse for perf if we have to make many network requests
			// for extremely small amounts of code.
			esbuildBuildOptions.splitting = false
			esbuildBuildOptions.write = false
			break
		case "production":
			esbuildBuildOptions.minify = true
			// TODO(david): figure out a way to get esbuild to roll up very many tiny chunks into one
			// before enabling this. It can be worse for perf if we have to make many network requests
			// for extremely small amounts of code.
			esbuildBuildOptions.splitting = false
			esbuildBuildOptions.metafile = true
			break
	}
	if (options?.hashAssets) {
		esbuildBuildOptions.assetNames = "[name]-[hash]"
		esbuildBuildOptions.entryNames = "[name]-[hash]"
	}
	return esbuildBuildOptions
}

interface ServeOptions {
	port?: number
}
export async function serve(context: BuildContext, options?: ServeOptions) {
	const {publicdir} = context.buildOptions
	if (!publicdir) {
		throw logger.newError("serve", "missing publicdir in build options")
	}
	const esbuildBuildOptions = buildEsbuildOptions(context.buildOptions)
	esbuildBuildOptions.outdir = path.resolve(publicdir, "assets")
	const esbuildContext = await esbuild.context(esbuildBuildOptions)
	const esbuildServeOptions: esbuild.ServeOptions = {
		port: options?.port ?? 3000,
		servedir: publicdir,
		fallback: path.join(publicdir, "index.html"),
	}
	const server = await esbuildContext.serve(esbuildServeOptions)
	logger.info("serve", `server running at: http://localhost:${server.port}`)
}

export async function loadEnvFile(
	filepath: string,
	options?: {
		only?: string[]
	},
): Promise<Record<string, string>> {
	const env: Record<string, string> = {}
	const txt = await fs.promises.readFile(filepath, "utf8")
	for (const line of txt.split("\n")) {
		if (line.trim().startsWith("#")) {
			continue
		}
		const [key, value] = line
			.trim()
			.split("=")
			.map((v) => v.trim())

		if (options?.only && !options.only.includes(key)) {
			continue
		}
		if (key && value) {
			env[key] = value
		}
	}
	return env
}

function stringifyEnvVars(env: EnvVars): EnvVars {
	const result: EnvVars = {}
	for (const key of Object.keys(env)) {
		result[`process.env.${key}`] = JSON.stringify(env[key] ?? "")
	}
	return result
}
