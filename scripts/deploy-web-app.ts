import * as fs from "fs"
import {shell} from "./_util.js"

export async function deployWebsite() {
	// if (!fs.existsSync("dist")) {
	// 	console.error("Website hasn't been built, expected '%s' to exist", DIST)
	// 	process.exit(1)
	// }
	// await syncFolderToBucket()
}

async function syncFolderToBucket() {
	// const flags: string[] = [
	// 	// Delete extra files under dst_url not found under src_url.
	// 	"-d",
	// 	//Causes directories, buckets, and bucket subdirectories to be synchronized recursively.
	// 	"-r",
	// ]
	// await shell(
	// 	`gsutil rsync ${flags.join(" ")} ${DIST} gs://${
	// 		config.gcloud.buckets.website
	// 	}`,
	// )
}
