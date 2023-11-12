import {Bucket, Storage} from "@google-cloud/storage"
import {config} from "../config"
import {shell} from "./_util"

const storage = new Storage({
	projectId: config.gcloud.projectId,
	keyFilename: config.gcloud.keyFilename,
})

const buckets = {
	cdn: storage.bucket(config.gcloud.buckets.cdn),
	website: storage.bucket(config.gcloud.buckets.website),
}

export async function ensureGCPInfra() {
	assertValidGCPConfig()

	// setup service account
	await ensureServiceAccount()

	// setup cdn bucket
	await ensureBucketExists(buckets.cdn)

	// setup website bucket
	await ensureBucketExists(buckets.website)
	await shell(
		`gsutil iam ch allUsers:objectViewer gs://${config.gcloud.buckets.website}`,
	)
	await shell(
		`gsutil web set -m index.html -e 404.html gs://${config.gcloud.buckets.website}`,
	)
}

async function ensureServiceAccount() {
	// ensure service account exists
	await shell(
		`gcloud iam service-accounts create ${config.gcloud.serviceAccount}`,
	)

	// assign roles
	const roles = ["roles/storage.admin"]
	for (const role of roles) {
		await shell(
			[
				`gcloud projects add-iam-policy-binding ${config.gcloud.projectId}`,
				`--member='serviceAccount:${config.gcloud.serviceAccount}@${config.gcloud.projectId}.iam.gserviceaccount.com'`,
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

function assertValidGCPConfig() {
	if (
		!config.gcloud.projectId ||
		!config.gcloud.serviceAccount ||
		!config.gcloud.keyFilename ||
		!config.gcloud.buckets.cdn ||
		!config.gcloud.buckets.website
	) {
		throw new Error("Invalid GCP config")
	}
}
