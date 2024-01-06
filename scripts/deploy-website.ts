import * as fs from "fs"
import * as path from "path"
import {newLogger} from "@dvdzkwsk/logger"
import {Bucket, Storage} from "@google-cloud/storage"
import {execScript, shell} from "./_util.js"
import {
	CloudflareConfig,
	GCPConfig,
	WebsiteConfig,
	getCloudflareConfig,
	getGCPConfig,
	getWebsiteConfig,
} from "./_config.js"
import {buildWebsite} from "./build-website.js"

const logger = newLogger("DeployWebsite")

async function deployWebsite() {
	const websiteConfig = getWebsiteConfig()
	const gcpConfig = getGCPConfig()
	const cloudflareConfig = getCloudflareConfig()

	if (process.argv.includes("--build")) {
		await buildWebsite(websiteConfig)
	}

	if (!process.argv.includes("--skip-infra")) {
		await ensureGCPInfra(websiteConfig, gcpConfig)
		await ensureCloudflareInfra(cloudflareConfig)
	}

	await syncFolderToBucket(
		path.join(websiteConfig.dir, "dist"),
		websiteConfig.gcpBucket!,
	)
}

async function syncFolderToBucket(folderToSync: string, bucket: string) {
	if (!fs.existsSync(folderToSync)) {
		logger.error(
			"syncFolderToBucket",
			"No dist directory to deploy. Did you forget to build the website?",
			{
				path: folderToSync,
			},
		)
		process.exit(1)
	}

	const flags: string[] = []
	flags.push("-r") // -r indicates a recursive copy.
	await shell(
		`gsutil -m -h "Cache-Control:no-cache" cp ${flags.join(
			" ",
		)} ${folderToSync}/* gs://${bucket}`,
	)
}

async function ensureGCPInfra(
	websiteConfig: WebsiteConfig,
	gcpConfig: GCPConfig,
) {
	if (!websiteConfig.gcpBucket) {
		throw logger.newError("ensureGCPInfra", "no gcp bucket configured")
	}
	const storage = new Storage({
		projectId: gcpConfig.projectId,
		keyFilename: gcpConfig.keyFilename,
	})
	const bucket = storage.bucket(websiteConfig.gcpBucket!)

	await ensureServiceAccount(gcpConfig)
	await ensureBucketExists(bucket)
	await shell(`gsutil iam ch allUsers:objectViewer gs://${bucket.name}`)
	await shell(`gsutil web set -m index.html -e 404.html gs://${bucket.name}`)
}

async function ensureServiceAccount(config: GCPConfig) {
	logger.debug("ensureServiceAccount", "ensuring service account exists...")
	await shell(`gcloud iam service-accounts create ${config.serviceAccount}`)

	logger.debug(
		"ensureServiceAccount",
		"ensuring service account has required roles...",
	)
	const roles = ["roles/storage.admin"]
	for (const role of roles) {
		await shell(
			[
				`gcloud projects add-iam-policy-binding ${config.projectId}`,
				`--member='serviceAccount:${config.serviceAccount}@${config.projectId}.iam.gserviceaccount.com'`,
				`--role=${role}`,
			].join(" "),
		)
	}
}

async function ensureBucketExists(bucket: Bucket) {
	logger.debug("ensureBucketExists", "ensuring bucket exists...", {
		bucket: bucket.name,
	})
	if (await bucketExists(bucket)) {
		logger.debug("ensureBucketExists", "bucket already exists", {
			bucket: bucket.name,
		})
		return
	}
	logger.debug("ensureBucketExists", "bucket doesn't exist, creating it...", {
		bucket: bucket.name,
	})
	await bucket.create()
}

async function bucketExists(bucket: Bucket): Promise<boolean> {
	try {
		const res = await bucket.exists()
		return res[0] === true
	} catch (e) {
		return false
	}
}

async function ensureCloudflareInfra(config: CloudflareConfig) {
	const res = await fetch(
		"https://api.cloudflare.com/client/v4/user/tokens/verify",
		{
			headers: {
				Authorization: `Bearer ${config.apiToken}`,
				"Content-Type": "application/json",
			},
		},
	)
	if (!res.ok) {
		throw logger.newError(
			"ensureCloudflareInfra",
			"could not connect to cloudflare",
		)
	}
	// TODO: ensure page rules are configured
}

execScript(import.meta, deployWebsite)
