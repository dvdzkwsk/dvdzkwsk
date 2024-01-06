import * as url from "url"
import * as path from "path"
import {getEnvVar} from "./_util.js"
import {Bucket} from "@google-cloud/storage"

export interface GCPConfig {
	projectId: string
	keyFilename: string
	serviceAccount: string
	buckets: {
		[key: string]: string
	}
}

export function getGCPConfig(): GCPConfig {
	const config: GCPConfig = {
		projectId: getEnvVar("GCLOUD_PROJECT_ID")!,
		keyFilename: "secrets/gcloud.keyfile.json",
		serviceAccount: getEnvVar("GCLOUD_SERVICE_ACCOUNT")!,
		buckets: Object.fromEntries(
			getEnvVar("GCLOUD_BUCKETS")!
				.split(",")
				.map((entry) => entry.split(":")),
		),
	}
	return config
}

export interface CloudflareConfig {
	apiToken: string
}
export function getCloudflareConfig(): CloudflareConfig {
	const config: CloudflareConfig = {
		apiToken: getEnvVar("CLOUDFLARE_API_TOKEN")!,
	}
	return config
}

export interface WebsiteConfig {
	dir: string
	gcpBucket: string | null
}
export function getWebsiteConfig(): WebsiteConfig {
	const dirname = path.dirname(url.fileURLToPath(import.meta.url))
	const repoRoot = path.join(dirname, "..")

	const config: WebsiteConfig = {
		dir: "",
		gcpBucket: null,
	}

	const target = process.argv.slice(2).find((arg) => !arg.startsWith("-"))
	if (target) {
		config.dir = path.join(process.cwd(), target)
	}

	// default to building my website
	if (!config.dir) {
		config.dir = path.join(repoRoot, "website")
	}

	switch (path.basename(config.dir)) {
		case "website":
			config.gcpBucket = getGCPConfig().buckets.dvdzkwsk
			break
	}
	return config
}
