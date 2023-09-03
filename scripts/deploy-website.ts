import * as fs from "fs"
import * as path from "path"
import {config} from "../config"
import {shell} from "./_share"

const DIST = path.join(process.cwd(), "dist/website")

async function main() {
	if (!fs.existsSync(DIST)) {
		console.error("Website hasn't been built, expected '%s' to exist", DIST)
		process.exit(1)
	}
	await ensureWebsiteBucket()
	await syncFolderToBucket()
}

async function ensureWebsiteBucket() {
	if (config.flags.dryRun) return

	const info = await shell(
		`gsutil ls -b gs://${config.website.gcloud.bucket}`,
	)
	if (info.stderr?.includes("BucketNotFoundException")) {
		await shell(`gsutil mb -b on gs://${config.website.gcloud.bucket}`)
	}
	await shell(
		`gsutil iam ch allUsers:objectViewer gs://${config.website.gcloud.bucket}`,
	)
	await shell(
		`gsutil web set -m index.html -e 404.html gs://${config.website.gcloud.bucket}`,
	)
}

async function syncFolderToBucket() {
	const flags: string[] = [
		// Delete extra files under dst_url not found under src_url.
		"-d",
		//Causes directories, buckets, and bucket subdirectories to be synchronized recursively.
		"-r",
	]
	if (config.flags.dryRun) {
		flags.push("-n")
	}
	await shell(
		`gsutil rsync ${flags.join(" ")} ${DIST} gs://${
			config.website.gcloud.bucket
		}`,
	)
}

main()
