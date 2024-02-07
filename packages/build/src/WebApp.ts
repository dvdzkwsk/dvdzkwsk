import * as fs from "fs"
import * as path from "path"
import * as esbuild from "esbuild"
import {Logger} from "@dvdzkwsk/logger"
import {BuildOptions} from "./index.js"
import {finalizeBuildOptions} from "./BuildUtil.js"
import {EsbuildPluginPreact} from "./plugins/EsbuildPluginPreact.js"

const logger = new Logger("WebApp")

export async function buildWebApp(rawOptions: BuildOptions) {
	const buildOptions: BuildOptions = {
		...rawOptions,
		esbuild: {
			absWorkingDir: rawOptions.cwd,
			entryPoints: getEntrypoints(rawOptions.cwd),
			outdir: path.resolve(rawOptions.cwd, "dist/assets"),
			bundle: true,
			format: "esm",
			platform: "browser",
			target: "esnext",
			pure: [],
			plugins: [EsbuildPluginPreact()],
			sourcemap: "linked",
			define: {
				"process.env.SSR": JSON.stringify(false),
				"process.env.SUPABASE_PROJECT_URL": JSON.stringify(
					process.env.SUPABASE_PROJECT_URL || "",
				),
				"process.env.SUPABASE_PUBLIC_API_KEY": JSON.stringify(
					process.env.SUPABASE_PUBLIC_API_KEY || "",
				),
			},
			...rawOptions.esbuild,
		},
	}
	finalizeBuildOptions(buildOptions, {hashAssetsInProd: true})

	await rebuildBlogIndex(buildOptions.cwd)

	if (buildOptions.dev) {
		await startDevServer(buildOptions.cwd, buildOptions)
	} else {
		await buildToDisk(buildOptions.cwd, buildOptions)
		if (fs.existsSync(path.resolve(buildOptions.cwd, "src/main.ssr.tsx"))) {
			process.env.SSR = true as any
			import(path.resolve(buildOptions.cwd, "src/main.ssr.tsx"))
		}
	}
}

export async function rebuildBlogIndex(cwd: string) {
	if (!fs.existsSync(path.join(cwd, "src/blog"))) return

	logger.debug("rebuildBlogIndex", "rebuilding index...")

	const dst = path.join(cwd, "src/blog/index.registry.ts")
	await fs.promises.rm(dst, {force: true})

	const files = await fs.promises
		.readdir(path.join(cwd, "src/blog"))
		.then((files) => {
			return files.filter((file) => file.endsWith(".tsx"))
		})

	const posts = await Promise.all(
		files.map(async (file, idx) => {
			const post = await import(path.join(cwd, "src/blog", file)).then(
				(m) => m.default,
			)

			return {
				path: `${file.replace(path.extname(file), ".js")}`,
				title: post.title,
				moduleName: post.title.replace(/[\s()]/g, ""),
			}
		}),
	)

	let content = ""
	content += "// THIS IS A GENERATED FILE. DO NOT EDIT IT DIRECTLY."
	content += "\n"
	content += "// See `rebuildBlogIndex` in ./scripts/build-website.ts"
	content += "\n"
	for (const post of posts) {
		content += "\n"
		content += `import ${post.moduleName} from "./${post.path}"`
	}
	content += "\n\n"
	content += "export default ["
	for (const post of posts) {
		content += "\n"
		content += `\t${post.moduleName},`
	}
	content += "\n]\n"

	logger.debug("rebuildBlogIndex", "write index", {dst})
	await fs.promises.writeFile(dst, content, "utf8")
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

async function startDevServer(cwd: string, buildOptions: BuildOptions) {
	buildOptions.esbuild.outdir = path.resolve(cwd, "public/assets")
	const context = await esbuild.context(buildOptions.esbuild)

	const serveOptions: esbuild.ServeOptions = {
		servedir: path.resolve(cwd, "public"),
		port: 3000,
		fallback: path.resolve(cwd, "public/index.html"),
	}
	const server = await context.serve(serveOptions)
	logger.info(
		"startDevServer",
		`server running at: http://localhost:${server.port}`,
	)
}

async function buildToDisk(cwd: string, buildOptions: BuildOptions) {
	await fs.promises.rm(path.resolve(cwd, "dist"), {
		force: true,
		recursive: true,
	})

	const result = await esbuild.build(buildOptions.esbuild)
	if (result.metafile) {
		logger.info("buildToDisk", "finished esbuild")
		logger.debug(
			"buildToDisk",
			"analyze esbuild metafile\n" +
				(await esbuild.analyzeMetafile(result.metafile)),
		)
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

function applyBuildMode(
	buildOptions: BuildOptions,
	mode: BuildOptions["mode"],
) {
	logger.debug("applyBuildMode", "set build mode", {mode})
	switch (mode) {
		case "development":
			buildOptions.esbuild.minify = false
			buildOptions.esbuild.splitting = true
			buildOptions.esbuild.write = false
			buildOptions.esbuild.assetNames = "[name]"
			buildOptions.esbuild.entryNames = "[name]"
			buildOptions.esbuild.define = {
				...buildOptions.esbuild.define,
				["process.env.NODE_ENV"]: JSON.stringify("development"),
			}
			break
		case "production":
			buildOptions.esbuild.minify = true
			buildOptions.esbuild.splitting = true
			buildOptions.esbuild.metafile = true
			buildOptions.esbuild.assetNames = "[name]-[hash]"
			buildOptions.esbuild.entryNames = "[name]-[hash]"
			buildOptions.esbuild.define = {
				...buildOptions.esbuild.define,
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
			mainJS.outputFile.replace("dist/assets", "/assets"),
		)
		if (mainCSSOutputFile) {
			html = html.replace(
				"/assets/main.css",
				mainCSSOutputFile.replace("dist/assets", "/assets"),
			)
		}
		fs.writeFileSync(path.resolve(cwd, htmlFile), html, "utf8")
	}
}
