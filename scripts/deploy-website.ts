import * as fs from "fs"
import * as path from "path"
import {isMainModule, loadEnv, shell} from "./_util.js"
import {getGCPConfig} from "./_gcp.js"
import {ensureGCPInfra} from "./ensure-infra.js"

async function main() {
	await loadEnv()

	const config = await getGCPConfig()
	await ensureGCPInfra(config)

	const folderToSync = path.resolve(process.cwd(), "dvdzkwsk/dist")
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
	const flags: string[] = []
	flags.push("-r") // -r indicates a recursive copy.
	await shell(
		`gsutil -m -h "Cache-Control:no-cache" cp ${flags.join(
			" ",
		)} ${folderToSync}/* gs://${bucket}`,
	)
}

if (isMainModule(import.meta)) {
	main()
}
