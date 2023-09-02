import * as fs from "fs"
import * as esbuild from "esbuild"
import {config} from "../config"

const main = async () => {
	await fs.promises.rm("dist/website", {force: true, recursive: true})

	const esbuildConfig = {...config.website.esbuild}
	esbuildConfig.minify ??= true
	esbuildConfig.metafile = true
	esbuildConfig.define!["process.env.NODE_ENV"] = JSON.stringify(
		process.env.NODE_ENV || "production",
	)

	const result = await esbuild.build(esbuildConfig)
	await fs.promises.cp("./website/public", "./dist/website", {
		recursive: true,
	})
	if (result.metafile) {
		const text = await esbuild.analyzeMetafile(result.metafile, {
			verbose: false,
		})
		console.log(text)
	}
}

main()
