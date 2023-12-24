import * as fs from "fs"
import * as path from "path"
import {execScript, shell} from "./_util.js"
import {getGCPConfig} from "./_gcp.js"
import {ensureGCPInfra} from "./ensure-infra.js"
import {newLogger} from "@dvdzkwsk/logger"

const logger = newLogger("DeployWebsite")

async function deployWebsite() {
	const config = await getGCPConfig()
	await ensureGCPInfra(config)

	const folderToSync = path.resolve(process.cwd(), "dvdzkwsk/dist")
	await syncFolderToBucket(folderToSync, config.buckets.dvdzkwsk)
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

execScript(import.meta, deployWebsite)
