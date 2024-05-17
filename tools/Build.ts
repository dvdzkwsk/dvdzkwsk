import * as fs from "fs"
import * as path from "path"
import * as esbuild from "esbuild"
import alias from "esbuild-plugin-alias"
import {Logger} from "@pkg/logger/Logger.js"
import {execScript} from "./CliUtil.js"
import {buildBlogIndex} from "./BlogUtil.js"

const logger = new Logger("Build")

async function buildCli() {
	const args = process.argv.slice(2)
	const target = args[0]

	if (path.basename(target) === "website") {
		await buildBlogIndex()
	}
	if (fs.existsSync(path.join(target, "Main.tsx"))) {
		await buildWebApp(target)
	} else if (fs.existsSync(path.join(target, "Main.ts"))) {
		await buildNodeApp(target)
	}
}

function hasDevFlag(args: string[]) {
	return args.includes("--dev")
}

async function buildWebApp(cwd: string) {
	const outdir = path.join(cwd, "dist")
	const staticdir = path.join(cwd, "static")

	const buildOptions: esbuild.BuildOptions = {
		entryPoints: [path.join(cwd, "Main.tsx")],
		outdir: path.join(outdir, "assets"),
		assetNames: "[name]",
		entryNames: "[name]",
		bundle: true,
		format: "esm",
		platform: "browser",
		target: "esnext",
		plugins: [await esbuildPluginPreact()],
		sourcemap: "linked",
		define: {
			"process.env.SSR": JSON.stringify(false),
			"process.env.NODE_ENV": JSON.stringify(
				process.env.NODE_ENV || hasDevFlag(process.argv)
					? "development"
					: "production",
			),
		},
	}

	if (fs.existsSync(outdir)) {
		fs.rmSync(outdir, {recursive: true, force: true})
	}

	if (hasDevFlag(process.argv)) {
		buildOptions.outdir = path.join(staticdir, "assets")
		const esbuildContext = await esbuild.context(buildOptions)
		const esbuildServeOptions: esbuild.ServeOptions = {
			port: 3000,
			servedir: staticdir,
			fallback: path.join(staticdir, "index.html"),
		}
		const server = await esbuildContext.serve(esbuildServeOptions)
		console.info(`server running at: http://localhost:${server.port}`)
	} else {
		buildOptions.minify = true
		buildOptions.splitting = true
		buildOptions.metafile = true
		buildOptions.assetNames = "[name]-[hash]"
		buildOptions.entryNames = "[name]-[hash]"

		const result = await esbuild.build(buildOptions)
		if (result.metafile) {
			const analysis = await esbuild.analyzeMetafile(result.metafile)
			console.info(analysis)
		}
		await fs.promises.cp(
			path.resolve(cwd, "static"),
			path.resolve(cwd, "dist"),
			{
				recursive: true,
			},
		)
		await updateHashedAssetPaths(cwd, result)

		const ssrEntry = path.join(cwd, "Main.ssr.tsx")
		if (fs.existsSync(ssrEntry)) {
			process.env.SSR = true as any
			const module = await import(ssrEntry)
			await module.ssr()
		}
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
			o.entryPoint?.endsWith("Main.ts") ||
			o.entryPoint?.endsWith("Main.tsx")
		)
	})!
	const mainCSSOutputFile =
		mainJS.cssBundle ||
		outputs.find((o) => {
			return o.entryPoint?.endsWith("Main.css")
		})?.outputFile!

	const htmlFiles = ["dist/index.html"]

	console.log({mainJS, mainCSSOutputFile})

	for (const htmlFile of htmlFiles) {
		let html = fs.readFileSync(path.resolve(cwd, htmlFile), "utf8")
		html = html.replace(
			"/assets/Main.js",
			mainJS.outputFile.split("dist")[1],
		)
		if (mainCSSOutputFile) {
			html = html.replace(
				"/assets/Main.css",
				mainCSSOutputFile.split("dist")[1],
			)
		}
		fs.writeFileSync(path.resolve(cwd, htmlFile), html, "utf8")
	}
}

async function buildNodeApp(cwd: string) {
	const mainFile = path.join(cwd, "Main.ts")
	const buildOptions: esbuild.BuildOptions = {
		entryPoints: [mainFile],
		outdir: path.resolve(cwd, "dist"),
		assetNames: "[name]",
		entryNames: "[name]",
		bundle: true,
		format: "esm",
		platform: "node",
		target: "esnext",
		sourcemap: "linked",
		define: {
			"process.env.NODE_ENV": JSON.stringify(
				process.env.NODE_ENV || hasDevFlag(process.argv)
					? "development"
					: "production",
			),
		},
	}
	if (buildOptions.outdir && fs.existsSync(buildOptions.outdir)) {
		fs.rmSync(buildOptions.outdir, {recursive: true, force: true})
	}
	if (hasDevFlag(process.argv)) {
		await import(mainFile)
	} else {
		buildOptions.minify = true
		buildOptions.metafile = true
		const result = await esbuild.build(buildOptions)
		if (result.metafile) {
			const analysis = await esbuild.analyzeMetafile(result.metafile)
			console.info(analysis)
		}
	}
}

async function esbuildPluginPreact() {
	async function resolve(module: string) {
		const path = await import.meta.resolve(module)
		return path.replace("file://", "")
	}
	return alias({
		react: await resolve("preact/compat"),
		"react-dom": await resolve("preact/compat"),
		"react-dom/client": await resolve("preact/compat/client"),
		"react/jsx-runtime": await resolve("preact/jsx-runtime"),
	})
}

execScript(import.meta, buildCli)
