import * as fs from "fs"
import * as path from "path"
import * as esbuild from "esbuild"
import {Logger} from "@dvdzkwsk/logger"
import {EsbuildPluginPreact} from "./plugins/EsbuildPluginPreact.js"

const logger = new Logger("Build")

type EnvVars = Record<string, string>

export interface BuildContext {
	buildOptions: BuildOptions
}
export function context(buildOptions: BuildOptions): BuildContext {
	buildOptions = structuredClone(buildOptions)
	buildOptions.env["NODE_ENV"] ??= process.env.NODE_ENV ?? buildOptions.mode
	buildOptions.env["NODE_ENV"] = "asdadsada"
	return {
		buildOptions,
	}
}

export interface BuildOptions {
	target: "node" | "browser"
	mode: "development" | "production"
	src: string
	dst: string
	servedir?: string
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
	await fs.promises.cp(
		path.resolve(buildOptions.src, "public"),
		buildOptions.dst,
		{
			recursive: true,
		},
	)
	// await updateHashedAssetPaths(buildOptions.src, result)
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
				absWorkingDir: buildOptions.src,
				entryPoints: buildOptions.entrypoints,
				outdir: path.resolve(buildOptions.dst, "assets"),
				assetNames: "[name]",
				entryNames: "[name]",
				bundle: true,
				format: "esm",
				platform: "browser",
				target: "esnext",
				pure: [],
				plugins: [EsbuildPluginPreact()],
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
	const {servedir} = context.buildOptions
	if (!servedir) {
		throw logger.newError("serve", "missing servedir in build options")
	}
	const esbuildBuildOptions = buildEsbuildOptions(context.buildOptions)
	esbuildBuildOptions.outdir = path.resolve(servedir, "assets")
	const esbuildContext = await esbuild.context(esbuildBuildOptions)
	const esbuildServeOptions: esbuild.ServeOptions = {
		port: options?.port ?? 3000,
		servedir: servedir,
		fallback: path.join(servedir, "index.html"),
	}
	console.log({
		context,
		esbuildBuildOptions,
		env: context.buildOptions.env,
		esbuildServeOptions,
	})
	const server = await esbuildContext.serve(esbuildServeOptions)
	logger.info("serve", `server running at: http://localhost:${server.port}`)
}

async function updateHashedAssetPaths(
	src: string,
	result: esbuild.BuildResult,
) {
	const outputs = Object.entries(result.metafile!.outputs).map((o) => {
		return {
			outputFile: o[0],
			...o[1],
		}
	})
	const mainJS = outputs.find((o) => {
		return (
			o.entryPoint?.endsWith("main.ts") ||
			o.entryPoint?.endsWith("main.tsx")
		)
	})!
	const mainCSSOutputFile =
		mainJS.cssBundle ||
		outputs.find((o) => {
			return o.entryPoint?.endsWith("main.css")
		})?.outputFile!

	const htmlFiles = ["dist/index.html"]

	for (const htmlFile of htmlFiles) {
		let html = fs.readFileSync(path.resolve(src, htmlFile), "utf8")
		html = html.replace(
			"/assets/main.js",
			mainJS.outputFile.replace("dist/assets", "/assets"),
		)
		if (mainCSSOutputFile) {
			html = html.replace(
				"/assets/main.css",
				mainCSSOutputFile.replace("dist/assets", "/assets"),
			)
		}
		await fs.promises.writeFile(path.resolve(cwd, htmlFile), html, "utf8")
	}
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
