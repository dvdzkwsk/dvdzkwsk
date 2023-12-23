import * as os from "os"
import * as fs from "fs"
import * as path from "path"
import {isMainModule} from "./_util.js"
import {createLogger} from "@dvdzkwsk/logger"

const logger = createLogger("EnsureOSXSetup")

interface Options {
	force: boolean
}

async function main() {
	const options: Options = {
		force: process.argv.includes("--force"),
	}
	await ensureDotFilesLinked(options)
}

async function ensureDotFilesLinked(options: Options) {
	for (const name of fs.readdirSync("dotfiles")) {
		if (!name.startsWith(".")) continue

		const src = path.join(process.cwd(), "dotfiles", name)
		const dst = path.join(os.homedir(), name)
		if (fs.existsSync(dst)) {
			const stat = fs.statSync(dst)
			if (stat.isSymbolicLink()) {
				const linksTo = fs.readlinkSync(dst)
				if (linksTo === src) {
					logger.log(
						"debug",
						"ensureDotFilesLinked",
						"dotfile already linked",
						{from: src, to: dst},
					)
				}
				continue
			}
			logger.log(
				"warn",
				"ensureDotFilesLinked",
				"dotfile already exists at destination and is not a symlink.",
				{from: src, to: dst},
			)
			if (options.force) {
				logger.log(
					"debug",
					"ensureDotFilesLinked",
					"removing file at destination so it can be re-created as a symlink.",
					{from: src, to: dst},
				)
				fs.rmSync(dst, {force: true})
			} else {
				continue
			}
		}
		try {
			fs.symlinkSync(src, dst, "file")
			logger.log("debug", "ensureDotFilesLinked", "created symlink", {
				from: src,
				to: dst,
			})
		} catch (e) {
			logger.log(
				"error",
				"ensureDotFilesLinked",
				"failed to create symlink",
				{
					from: src,
					to: dst,
					error: e,
				},
			)
		}
	}
}

if (isMainModule(import.meta)) {
	main()
}
