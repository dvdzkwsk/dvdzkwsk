import * as fs from "fs"
import * as path from "path"
import {loadEnv, shell} from "./_util.js"
import {GCPConfig, getGCPConfig} from "./_gcp.js"

async function main() {
	await loadEnv()

	const config = await getGCPConfig()
	await deployWebsite(config, {
		dist: path.resolve(process.cwd(), "website/dist"),
	})
}

async function deployWebsite(config: GCPConfig, options: {dist: string}) {
	if (!fs.existsSync(options.dist)) {
		console.error(
			"Website hasn't been built, expected '%s' to exist",
			options.dist,
		)
		process.exit(1)
	}
	await syncFolderToBucket(config, options)
}

async function syncFolderToBucket(config: GCPConfig, options: {dist: string}) {
	const flags: string[] = [
		// Delete extra files under dst_url not found under src_url.
		"-d",
		//Causes directories, buckets, and bucket subdirectories to be synchronized recursively.
		"-r",
	]
	await shell(
		`gsutil rsync ${flags.join(" ")} ${options.dist} gs://${
			config.buckets.website
		}`,
	)
}

main()
