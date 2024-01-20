import * as url from "url"
import * as path from "path"
import {getEnvVar} from "./_util.js"

export interface CloudflareConfig {
	apiToken: string
	domain: string
	zoneId: string
}
export function getCloudflareConfig(): CloudflareConfig {
	const config: CloudflareConfig = {
		apiToken: getEnvVar("CLOUDFLARE_API_TOKEN")!,
		zoneId: getEnvVar("CLOUDFLARE_API_TOKEN")!,
		domain: "", // must be set later
	}
	return config
}

export interface WebsiteConfig {
	dir: string
	domain: string
	gcpBucket: string
	cloudflareZoneId: string
}
export function getWebsiteConfig(): WebsiteConfig {
	const dirname = path.dirname(url.fileURLToPath(import.meta.url))
	const repoRoot = path.join(dirname, "..")

	const config: WebsiteConfig = {
		dir: "",
		domain: "",
		gcpBucket: "",
		cloudflareZoneId: "",
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
			config.domain = getEnvVar("WEBSITE_DOMAIN")!
			config.gcpBucket = getEnvVar("WEBSITE_GCP_BUCKET")!
			config.cloudflareZoneId = getEnvVar("WEBSITE_CLOUDFLARE_ZONE_ID")!
			break
	}
	return config
}
