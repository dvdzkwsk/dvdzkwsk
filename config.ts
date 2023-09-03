import * as fs from "fs"
import {vanillaExtractPlugin} from "@vanilla-extract/esbuild-plugin"
import type {BuildOptions} from "esbuild"

interface Config {
	flags: {
		dryRun: boolean
	}
	gcloud: {
		projectId: string
	}
	website: {
		gcloud: {
			bucket: string
		}
		esbuild: BuildOptions
	}
}

function createConfig(): Config {
	loadEnvFile()
	const config: Config = {
		flags: {
			dryRun: false,
		},
		gcloud: {
			projectId: env("GCLOUD_PROJECT_ID")!,
		},
		website: {
			gcloud: {
				bucket: "dev.zuko.me",
			},
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

	if (process.argv.includes("--dry")) {
		config.flags.dryRun = true
	}

	validateConfig(config)
	return config
}

function env(key: string): string | null {
	const value = process.env[key]
	if (!value) {
		console.warn("Warn: missing environment variable: %s", key)
	}
	return value ?? null
}

function validateConfig(config: Config) {
	if (!config?.gcloud?.projectId) {
		console.warn("Warn: missing config.gcloud.projectId")
	}
}

function loadEnvFile() {
	try {
		const env = fs.readFileSync(".env", "utf8")
		for (const kv of env.split("\n")) {
			const [key, value] = kv.split("=")
			process.env[key] = value
		}
	} catch (e) {}
}

export const config = createConfig()
