import {Bucket, Storage} from "@google-cloud/storage"
import {isMainModule, loadEnv, shell} from "./_util.js"
import {GCPConfig, getGCPConfig} from "./_gcp.js"
import {createLogger} from "@dvdzkwsk/logger"

const logger = createLogger("EnsureInfra")

async function main() {
	await loadEnv()
	const gcpConfig = getGCPConfig()
	await ensureGCPInfra(gcpConfig)
}

export async function ensureGCPInfra(config: GCPConfig) {
	if (process.argv.includes("--skip-infra")) {
		logger.logWithLevel(
			"debug",
			"ensureGCPInfra",
			'skipping infra check becasue "--skip-infra" was used',
		)
		return
	}
	const storage = new Storage({
		projectId: config.projectId,
		keyFilename: config.keyFilename,
	})

	const buckets = {
		dvdzkwsk: storage.bucket(config.buckets.dvdzkwsk),
	}

	// setup service account
	await ensureServiceAccount(config)

	// setup dvdzkwsk bucket
	logger.logWithLevel(
		"debug",
		"ensureServiceAccount",
		"ensuring service account exists...",
	)
	await ensureBucketExists(buckets.dvdzkwsk)
	await shell(
		`gsutil iam ch allUsers:objectViewer gs://${config.buckets.dvdzkwsk}`,
	)
	await shell(
		`gsutil web set -m index.html -e 404.html gs://${config.buckets.dvdzkwsk}`,
	)
}

async function ensureServiceAccount(config: GCPConfig) {
	logger.logWithLevel(
		"debug",
		"ensureServiceAccount",
		"ensuring service account exists...",
	)
	await shell(`gcloud iam service-accounts create ${config.serviceAccount}`)

	logger.logWithLevel(
		"debug",
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
	logger.logWithLevel(
		"debug",
		"ensureBucketExists",
		"ensuring bucket exists...",
		{
			bucket: bucket.name,
		},
	)
	if (await bucketExists(bucket)) {
		logger.logWithLevel(
			"debug",
			"ensureBucketExists",
			"bucket already exists",
			{
				bucket: bucket.name,
			},
		)
		return
	}
	logger.logWithLevel(
		"debug",
		"ensureBucketExists",
		"bucket doesn't exist, creating it...",
		{bucket: bucket.name},
	)
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

if (isMainModule(import.meta)) {
	main()
}
