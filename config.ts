import * as fs from "fs"
import {vanillaExtractPlugin} from "@vanilla-extract/esbuild-plugin"
import type {BuildOptions} from "esbuild"

interface Config {
	gcloud: {
		projectId: string
		keyFilename: string
		serviceAccount: string
		buckets: {
			cdn: string
			website: string
		}
	}
	website: {
		esbuild: BuildOptions
	}
}

function createConfig(): Config {
	loadEnvFile()
	const config: Config = {
		gcloud: {
			projectId: env("GCLOUD_PROJECT_ID")!,
			keyFilename: "secrets/gcloud.keyfile.json",
			serviceAccount: env("GCLOUD_SERVICE_ACCOUNT")!,
			buckets: {
				cdn: "cdn.zuko.me",
				website: "dev.zuko.me",
			},
		},
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
	if (!config?.gcloud?.serviceAccount) {
		console.warn("Warn: missing config.gcloud.serviceAccount")
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
