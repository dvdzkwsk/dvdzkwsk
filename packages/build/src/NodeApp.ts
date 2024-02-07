import * as fs from "fs"
import * as path from "path"
import * as esbuild from "esbuild"
import {BuildOptions} from "./index.js"
import {Logger} from "@dvdzkwsk/logger"
import {finalizeBuildOptions} from "./BuildUtil.js"

const logger = new Logger("NodeApp")

export async function buildNodeApp(rawOptions: BuildOptions) {
	const entrypoint = getEntrypoint(rawOptions.cwd)
	const buildOptions: BuildOptions = {
		...rawOptions,
		esbuild: {
			absWorkingDir: rawOptions.cwd,
			entryPoints: [entrypoint],
			outdir: path.resolve(rawOptions.cwd, "dist"),
			bundle: true,
			format: "esm",
			platform: "node",
			target: "esnext",
			pure: [],
			plugins: [],
			sourcemap: "linked",
			...rawOptions.esbuild,
		},
	}
	finalizeBuildOptions(buildOptions, {hashAssetsInProd: false})

	if (buildOptions.dev) {
		import(entrypoint)
	} else {
		await buildToDisk(buildOptions)
	}
}

async function buildToDisk(options: BuildOptions) {
	const result = await esbuild.build(options.esbuild)
	if (result.metafile) {
		const analysis = await esbuild.analyzeMetafile(result.metafile)
		logger.info("buildToDisk", analysis)
	}
}

function getEntrypoint(cwd: string): string {
	if (fs.existsSync(path.join(cwd, "src/main.ts"))) {
		return path.join(cwd, "src/main.ts")
	} else if (fs.existsSync(path.join(cwd, "src/main.tsx"))) {
		return path.join(cwd, "src/main.tsx")
	}
	throw logger.newError("getEntrypoint", "no entrypoints found")
}
