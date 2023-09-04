import * as fs from "fs"
import * as esbuild from "esbuild"
import {config} from "../config"

async function main() {
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

main()
