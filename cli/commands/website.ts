import * as fs from "fs"
import * as path from "path"
import express from "express"
import compression from "compression"
import * as esbuild from "esbuild"
import {config} from "../../config"
import {Command} from "../main"
import {shell} from "../_share"

const DIST = path.join(process.cwd(), "dist/website")

export function getWebsiteCommand(): Command {
	return {
		name: "website",
		commands: [
			{
				name: "build",
				run() {
					return buildWebsite()
				},
			},
			{
				name: "deploy",
				run() {
					return deployWebsite()
				},
			},
			{
				name: "serve",
				run() {
					return serveWebsite()
				},
			},
			{
				name: "start",
				run() {
					return startWebsite()
				},
			},
		],
	}
}

export async function startWebsite() {
	const esbuildConfig = {...config.website.esbuild}
	esbuildConfig.minify = false
	esbuildConfig.splitting = true
	esbuildConfig.write = false
	esbuildConfig.outdir = "website/public/assets"
	esbuildConfig.sourcemap = "linked"

	// https://esbuild.github.io/api/#live-reload
	const ctx = await esbuild.context(esbuildConfig)

	// TODO(david): watch currently writes to disk but we don't want that in dev because
	// the outdir is web/public/assets and that's a source directory.
	// await ctx.watch()

	const serveConfig = {
		servedir: "website/public",
		port: 3000,
	}
	const server = await ctx.serve(serveConfig)
	console.log("server running at http://localhost:%s", server.port)
}

export async function buildWebsite() {
	await cleanOutputDir()
	const esbuildConfig = createProductionESBuildConfig()

	const result = await esbuild.build(esbuildConfig)
	console.log(await esbuild.analyzeMetafile(result.metafile!))

	await copyStaticFiles()
	await updateHashedAssetPaths(result)
}

async function cleanOutputDir() {
	await fs.promises.rm("dist/website", {force: true, recursive: true})
}

function createProductionESBuildConfig(): esbuild.BuildOptions {
	const esbuildConfig = {...config.website.esbuild}
	esbuildConfig.minify ??= true
	esbuildConfig.metafile = true
	esbuildConfig.assetNames = "[name]-[hash]"
	esbuildConfig.entryNames = "[name]-[hash]"
	esbuildConfig.define!["process.env.NODE_ENV"] = JSON.stringify(
		process.env.NODE_ENV || "production",
	)
	return esbuildConfig
}

async function copyStaticFiles() {
	await fs.promises.cp("./website/public", "./dist/website", {
		recursive: true,
	})
}

async function updateHashedAssetPaths(result: esbuild.BuildResult) {
	const outputs = Object.entries(result.metafile!.outputs).map((o) => {
		return {
			outputFile: o[0],
			...o[1],
		}
	})
	const mainJS = outputs.find((o) => {
		return o.entryPoint?.endsWith("src/main.tsx")
	})!

	const htmlFiles = ["dist/website/index.html"]
	for (const htmlFile of htmlFiles) {
		let html = fs.readFileSync(htmlFile, "utf8")
		html = html.replace(
			"/assets/main.js",
			mainJS.outputFile.replace("dist/website", ""),
		)
		html = html.replace(
			"/assets/main.css",
			mainJS.cssBundle!.replace("dist/website", ""),
		)
		fs.writeFileSync(htmlFile, html, "utf8")
	}
}

export async function serveWebsite() {
	const app = express()
	app.use(compression())
	app.use(express.static("dist/website"))
	app.listen(8080, () => {
		console.log("serving website at http://localhost:8080")
	})
}

export async function deployWebsite() {
	if (!fs.existsSync(DIST)) {
		console.error("Website hasn't been built, expected '%s' to exist", DIST)
		process.exit(1)
	}
	await syncFolderToBucket()
}

async function syncFolderToBucket() {
	const flags: string[] = [
		// Delete extra files under dst_url not found under src_url.
		"-d",
		//Causes directories, buckets, and bucket subdirectories to be synchronized recursively.
		"-r",
	]
	await shell(
		`gsutil rsync ${flags.join(" ")} ${DIST} gs://${
			config.gcloud.buckets.website
		}`,
	)
}
