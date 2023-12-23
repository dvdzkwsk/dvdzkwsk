import {getEnv} from "./_util.js"

export interface GCPConfig {
	projectId: string
	keyFilename: string
	serviceAccount: string
	buckets: {
		cdn: string
		website: string
	}
}

export function getGCPConfig(): GCPConfig {
	const config: GCPConfig = {
		projectId: getEnv("GCLOUD_PROJECT_ID")!,
		keyFilename: "secrets/gcloud.keyfile.json",
		serviceAccount: getEnv("GCLOUD_SERVICE_ACCOUNT")!,
		buckets: {
			cdn: "cdn.zuko.me",
			website: "dev.zuko.me",
		},
	}
	return config
}
