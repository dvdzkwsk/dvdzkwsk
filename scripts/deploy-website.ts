import * as fs from "fs"
import * as path from "path"
import {isMainModule, loadEnv, shell} from "./_util.js"
import {GCPConfig, getGCPConfig} from "./_gcp.js"
import {ensureGCPInfra} from "./ensure-infra.js"

async function main() {
	await loadEnv()

	const folderToSync = path.resolve(process.cwd(), "dvdzkwsk/dist")
	const config = await getGCPConfig()
	await ensureGCPInfra(config)
	if (!fs.existsSync(folderToSync)) {
		console.error(
			"Website hasn't been built, expected '%s' to exist",
			folderToSync,
		)
		process.exit(1)
	}
	await syncFolderToBucket(folderToSync, config.buckets.dvdzkwsk)
}

async function syncFolderToBucket(folderToSync: string, bucket: string) {
	const flags: string[] = [
		// Delete extra files under dst_url not found under src_url.
		"-d",
		//Causes directories, buckets, and bucket subdirectories to be synchronized recursively.
		"-r",
	]
	await shell(
		`gsutil rsync ${flags.join(" ")} ${folderToSync} gs://${bucket}`,
	)
}

if (isMainModule(import.meta)) {
	main()
}
