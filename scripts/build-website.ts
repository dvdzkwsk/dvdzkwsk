import * as fs from "fs"
import * as path from "path"
import * as esbuild from "esbuild"
import htmlMinify from "html-minifier-terser"
import {Logger} from "@dvdzkwsk/logger"
import {execScript} from "./_util.js"
import {WebsiteConfig, getWebsiteConfig} from "./_config.js"

const logger = new Logger("BuildWebsite")

type BuildMode = "development" | "production"

export async function buildWebsite(config: WebsiteConfig = getWebsiteConfig()) {
	const options = getDefaultBuildOptions(config.dir)

	await rebuildBlogIndex(config)

	if (process.argv.includes("--dev")) {
		setBuildMode(options, "development")
		await startDevServer(config.dir, options)
		return
	}

	setBuildMode(options, "production")
	await buildToDisk(config.dir, options)

	process.env.SSR = true as any
	import(path.resolve(config.dir, "src/main.ssr.tsx"))
}

interface BuildOptions {
	esbuild: esbuild.BuildOptions
}
function getDefaultBuildOptions(cwd: string) {
	const options: BuildOptions = {
		esbuild: {
			absWorkingDir: cwd,
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

async function rebuildBlogIndex(config: WebsiteConfig) {
	if (!fs.existsSync(path.join(config.dir, "src/blog"))) return

	logger.debug("rebuildBlogIndex", "rebuilding index...")

	const dst = path.join(config.dir, "src/blog/index.registry.ts")

	const files = await fs.promises
		.readdir(path.join(config.dir, "src/blog"))
		.then((files) => {
			return files.filter((file) => file.endsWith(".tsx"))
		})

	const posts = await Promise.all(
		files.map(async (file) => {
			const post = await import(
				path.join(config.dir, "src/blog", file)
			).then((m) => m.default)

			return {
				path: `${file.replace(path.extname(file), ".js")}`,
				title: post.title,
				moduleName: post.title.replace(/\s/g, ""),
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

async function startDevServer(cwd: string, options: BuildOptions) {
	options.esbuild.outdir = path.resolve(cwd, "public/assets")
	const context = await esbuild.context(options.esbuild)

	const serveOptions: esbuild.ServeOptions = {
		servedir: path.resolve(cwd, "public"),
		port: 3000,
		fallback: path.resolve(cwd, "public/index.html"),
	}
	const server = await context.serve(serveOptions)
	logger.info(
		"startDevServer",
		`server running at http://localhost:${server.port}`,
	)
}

async function buildToDisk(cwd: string, options: BuildOptions) {
	await fs.promises.rm(path.resolve(cwd, "dist"), {
		force: true,
		recursive: true,
	})

	const result = await esbuild.build(options.esbuild)
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

function setBuildMode(options: BuildOptions, mode: BuildMode) {
	logger.debug("setBuildMode", "set build mode", {mode})
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
			mainJS.outputFile.replace("dist/assets", "/assets"),
		)
		if (mainCSSOutputFile) {
			html = html.replace(
				"/assets/main.css",
				mainCSSOutputFile.replace("dist/assets", "/assets"),
			)
		}

		html = await htmlMinify.minify(html, {
			collapseWhitespace: true,
		})
		fs.writeFileSync(path.resolve(cwd, htmlFile), html, "utf8")
	}
}

execScript(import.meta, buildWebsite)
