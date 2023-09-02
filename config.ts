import {vanillaExtractPlugin} from "@vanilla-extract/esbuild-plugin"
import type {BuildOptions} from "esbuild"

interface Config {
	website: {
		esbuild: BuildOptions
	}
}

function createConfig(): Config {
	const config: Config = {
		website: {
			esbuild: {
				entryPoints: {
					main: "./website/src/main.tsx",
				},
				outdir: "dist/website/assets",
				bundle: true,
				format: "esm",
				platform: "browser",
				target: "esnext",
				splitting: true,
				tsconfig: "tsconfig.json",
				define: {
					"process.env.NODE_ENV": JSON.stringify(
						process.env.NODE_ENV || "development",
					),
				},
				pure: [],
				plugins: [vanillaExtractPlugin() as any],
			},
		},
	}

	if (process.argv.includes("--minify")) {
		config.website.esbuild.minify = true
	}
	return config
}

export const config = createConfig()
