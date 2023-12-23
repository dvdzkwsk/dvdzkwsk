import {Bucket, Storage} from "@google-cloud/storage"
import {loadEnv, shell} from "./_util.js"
import {GCPConfig, getGCPConfig} from "./_gcp.js"

async function main() {
	await loadEnv()
	const config = getGCPConfig()
	await ensureGCPInfra(config)
}

export async function ensureGCPInfra(config: GCPConfig) {
	const storage = new Storage({
		projectId: config.projectId,
		keyFilename: config.keyFilename,
	})

	const buckets = {
		cdn: storage.bucket(config.buckets.cdn),
		website: storage.bucket(config.buckets.website),
	}

	// setup service account
	await ensureServiceAccount(config)

	// setup cdn bucket
	await ensureBucketExists(buckets.cdn)

	// setup website bucket
	await ensureBucketExists(buckets.website)
	await shell(
		`gsutil iam ch allUsers:objectViewer gs://${config.buckets.website}`,
	)
	await shell(
		`gsutil web set -m index.html -e 404.html gs://${config.buckets.website}`,
	)
}

async function ensureServiceAccount(config: GCPConfig) {
	// ensure service account exists
	await shell(`gcloud iam service-accounts create ${config.serviceAccount}`)

	// assign roles
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
	console.log("Ensure bucket exists: %s", bucket.name)
	if (await bucketExists(bucket)) {
		console.log("Bucket already exists: %s", bucket.name)
		return
	}
	console.log("Create bucket: %s", bucket.name)
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

main()
