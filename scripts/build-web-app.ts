import * as fs from "fs"
import * as path from "path"
import * as esbuild from "esbuild"
import {vanillaExtractPlugin} from "@vanilla-extract/esbuild-plugin"

type BuildMode = "development" | "production"

async function main(args: string[]) {
	const cwd = args.find((arg) => !arg.startsWith("-")) || process.cwd()
	const options = getDefaultBuildOptions(cwd)

	if (process.argv.includes("--dev")) {
		setBuildMode(options, "development")
		await startDevServer(cwd, options)
	} else {
		setBuildMode(options, "production")
		await buildToDisk(cwd, options)
	}
}

function getDefaultBuildOptions(cwd: string) {
	const entryPoints: string[] = []
	if (fs.existsSync(path.join(cwd, "src/main.ts"))) {
		entryPoints.push(path.join(cwd, "src/main.ts"))
	} else if (fs.existsSync(path.join(cwd, "src/main.tsx"))) {
		entryPoints.push(path.join(cwd, "src/main.tsx"))
	}
	if (fs.existsSync(path.join(cwd, "src/main.css"))) {
		entryPoints.push(path.join(cwd, "src/main.ts"))
	}

	const options: esbuild.BuildOptions = {
		entryPoints,
		outdir: path.join(cwd, "dist/assets"),
		bundle: true,
		format: "esm",
		platform: "browser",
		target: "esnext",
		pure: [],
		plugins: [vanillaExtractPlugin() as any],
		sourcemap: "linked",
		define: {},
	}
	return options
}

async function startDevServer(cwd: string, options: esbuild.BuildOptions) {
	options.outdir = path.join(cwd, "public/assets")
	const context = await esbuild.context(options)

	const serveOptions: esbuild.ServeOptions = {
		servedir: path.join(cwd, "public"),
		port: 3000,
	}
	const server = await context.serve(serveOptions)
	console.info("server running at http://localhost:%s", server.port)
}

async function buildToDisk(cwd: string, options: esbuild.BuildOptions) {
	await fs.promises.rm(path.join(cwd, "dist"), {
		force: true,
		recursive: true,
	})

	const result = await esbuild.build(options)
	if (result.metafile) {
		console.info(await esbuild.analyzeMetafile(result.metafile))
	}

	await fs.promises.cp(path.join(cwd, "public"), path.join(cwd, "dist"), {
		recursive: true,
	})
	await updateHashedAssetPaths(cwd, result)
}

function setBuildMode(options: esbuild.BuildOptions, mode: BuildMode) {
	switch (mode) {
		case "development":
			options.minify = false
			options.splitting = true
			options.write = false
			options.assetNames = "[name]"
			options.entryNames = "[name]"
			options.define = {
				...options.define,
				["process.env.NODE_ENV"]: JSON.stringify("development"),
			}
			break
		case "production":
			options.minify = true
			options.splitting = true
			options.metafile = true
			options.assetNames = "[name]-[hash]"
			options.entryNames = "[name]-[hash]"
			options.define = {
				...options.define,
				["process.env.NODE_ENV"]: JSON.stringify("production"),
			}
			break
	}
}

async function updateHashedAssetPaths(
	cwd: string,
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
			o.entryPoint?.endsWith("src/main.ts") ||
			o.entryPoint?.endsWith("src/main.tsx")
		)
	})!
	const mainCSSOutputFile =
		mainJS.cssBundle ||
		outputs.find((o) => {
			return o.entryPoint?.endsWith("src/main.css")
		})?.outputFile!

	const htmlFiles = ["dist/index.html"]
	for (const htmlFile of htmlFiles) {
		let html = fs.readFileSync(path.join(cwd, htmlFile), "utf8")
		html = html.replace(
			"/assets/main.js",
			mainJS.outputFile.replace("dist/website", ""),
		)
		html = html.replace(
			"/assets/main.css",
			mainCSSOutputFile.replace("dist/website", ""),
		)
		fs.writeFileSync(path.join(cwd, htmlFile), html, "utf8")
	}
}

main(process.argv.slice(2))
