import {BuildOptions} from "./index.js"

const ENV_VARS = [
	"GOOGLE_OAUTH_CLIENT_ID",
	"OAUTH_REDIRECT_URI",
	"SUPABASE_PROJECT_URL",
	"SUPABASE_PUBLIC_API_KEY",
]

export function finalizeBuildOptions(
	buildOptions: BuildOptions,
	config: {
		hashAssetsInProd?: boolean
	},
): BuildOptions {
	const env: Record<string, string> = {}
	for (const key of ENV_VARS) {
		env[`process.env.${key}`] = JSON.stringify(process.env[key] ?? "")
	}
	switch (buildOptions.mode) {
		case "development":
			buildOptions.esbuild.minify = false
			buildOptions.esbuild.splitting = true
			buildOptions.esbuild.write = false
			buildOptions.esbuild.assetNames = "[name]"
			buildOptions.esbuild.entryNames = "[name]"
			buildOptions.esbuild.define = {
				...buildOptions.esbuild.define,
				...env,
			}
			break
		case "production":
			buildOptions.esbuild.minify = true
			buildOptions.esbuild.splitting = true
			buildOptions.esbuild.metafile = true
			if (config?.hashAssetsInProd) {
				buildOptions.esbuild.assetNames = "[name]-[hash]"
				buildOptions.esbuild.entryNames = "[name]-[hash]"
			} else {
				buildOptions.esbuild.assetNames = "[name]"
				buildOptions.esbuild.entryNames = "[name]"
			}
			buildOptions.esbuild.define = {
				...buildOptions.esbuild.define,
				...env,
			}
			break
	}
	return buildOptions
}
