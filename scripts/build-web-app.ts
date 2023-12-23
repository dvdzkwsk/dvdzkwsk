import * as fs from "fs"
import * as path from "path"
import * as esbuild from "esbuild"

type BuildMode = "development" | "production"

async function main(args: string[]) {
	const cwd = args.find((arg) => !arg.startsWith("-")) || process.cwd()
	const options = getDefaultBuildOptions(cwd)

	if (process.argv.includes("--ssr")) {
		process.env.SSR = true as any
		import(path.resolve(cwd, "src/main.tsx"))
	} else if (process.argv.includes("--dev")) {
		setBuildMode(options, "development")
		await startDevServer(cwd, options)
	} else {
		setBuildMode(options, "production")
		await buildToDisk(cwd, options)
	}
}

interface BuildOptions {
	esbuild: esbuild.BuildOptions
}
function getDefaultBuildOptions(cwd: string) {
	const options: BuildOptions = {
		esbuild: {
			entryPoints: getEntrypoints(cwd),
			outdir: path.resolve(cwd, "dist/assets"),
			bundle: true,
			format: "esm",
			platform: "browser",
			target: "esnext",
			pure: [],
			plugins: [],
			sourcemap: "linked",
			define: {
				"process.env.SSR": JSON.stringify(false),
			},
		},
	}
	return options
}

function getEntrypoints(cwd: string): string[] {
	const entryPoints: string[] = []

	const htmlEntry = path.resolve(cwd, "src/index.html")
	if (fs.existsSync(htmlEntry)) {
		// TODO
	}

	if (fs.existsSync(path.resolve(cwd, "src/main.ts"))) {
		entryPoints.push(path.resolve(cwd, "src/main.ts"))
	} else if (fs.existsSync(path.resolve(cwd, "src/main.tsx"))) {
		entryPoints.push(path.resolve(cwd, "src/main.tsx"))
	}
	if (fs.existsSync(path.resolve(cwd, "src/main.css"))) {
		entryPoints.push(path.resolve(cwd, "src/main.css"))
	}
	return entryPoints
}

async function startDevServer(cwd: string, options: BuildOptions) {
	options.esbuild.outdir = path.resolve(cwd, "public/assets")
	const context = await esbuild.context(options.esbuild)

	const serveOptions: esbuild.ServeOptions = {
		servedir: path.resolve(cwd, "public"),
		port: 3000,
	}
	const server = await context.serve(serveOptions)
	console.info("server running at http://localhost:%s", server.port)
}

async function buildToDisk(cwd: string, options: BuildOptions) {
	await fs.promises.rm(path.resolve(cwd, "dist"), {
		force: true,
		recursive: true,
	})

	const result = await esbuild.build(options.esbuild)
	if (result.metafile) {
		console.info(await esbuild.analyzeMetafile(result.metafile))
	}

	await fs.promises.cp(
		path.resolve(cwd, "public"),
		path.resolve(cwd, "dist"),
		{
			recursive: true,
		},
	)
	await updateHashedAssetPaths(cwd, result)
}

function setBuildMode(options: BuildOptions, mode: BuildMode) {
	switch (mode) {
		case "development":
			options.esbuild.minify = false
			options.esbuild.splitting = true
			options.esbuild.write = false
			options.esbuild.assetNames = "[name]"
			options.esbuild.entryNames = "[name]"
			options.esbuild.define = {
				...options.esbuild.define,
				["process.env.NODE_ENV"]: JSON.stringify("development"),
			}
			break
		case "production":
			options.esbuild.minify = true
			options.esbuild.splitting = true
			options.esbuild.metafile = true
			options.esbuild.assetNames = "[name]-[hash]"
			options.esbuild.entryNames = "[name]-[hash]"
			options.esbuild.define = {
				...options.esbuild.define,
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
		let html = fs.readFileSync(path.resolve(cwd, htmlFile), "utf8")
		html = html.replace(
			"/assets/main.js",
			mainJS.outputFile.replace("dist/website", ""),
		)
		if (mainCSSOutputFile) {
			html = html.replace(
				"/assets/main.css",
				mainCSSOutputFile.replace("dist/website", ""),
			)
		}
		fs.writeFileSync(path.resolve(cwd, htmlFile), html, "utf8")
	}
}

main(process.argv.slice(2))
