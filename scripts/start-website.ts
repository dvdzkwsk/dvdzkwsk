import * as esbuild from "esbuild"
import {config} from "../config"

async function main() {
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

main()
