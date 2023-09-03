import * as fs from "fs"
import * as path from "path"
import * as esbuild from "esbuild"
import {config} from "../config"

const main = async () => {
	await fs.promises.rm("dist/website", {force: true, recursive: true})

	const esbuildConfig = {...config.website.esbuild}
	esbuildConfig.minify ??= true
	esbuildConfig.metafile = true
	esbuildConfig.assetNames = "[name]-[hash]"
	esbuildConfig.entryNames = "[name]-[hash]"
	esbuildConfig.define!["process.env.NODE_ENV"] = JSON.stringify(
		process.env.NODE_ENV || "production",
	)

	const result = await esbuild.build(esbuildConfig)
	await fs.promises.cp("./website/public", "./dist/website", {
		recursive: true,
	})

	// update asset paths

	const outputs = Object.entries(result.metafile!.outputs).map((o) => {
		return {
			outputFile: o[0],
			...o[1],
		}
	})
	const mainJS = outputs.find((o) => {
		return o.entryPoint?.endsWith("src/main.tsx")
	})!
	console.log(outputs)

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

	const text = await esbuild.analyzeMetafile(result.metafile!, {
		verbose: false,
	})
	console.log(text)
}

main()
