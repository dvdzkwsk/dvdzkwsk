import * as os from "os"
import * as fs from "fs"
import * as path from "path"

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
					logWithLevel(
						"debug",
						"ensureDotFilesLinked",
						"dotfile already linked",
						{from: src, to: dst},
					)
				}
				continue
			}
			logWithLevel(
				"warn",
				"ensureDotFilesLinked",
				"dotfile already exists at destination and is not a symlink.",
				{from: src, to: dst},
			)
			if (options.force) {
				logWithLevel(
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
			logWithLevel("debug", "ensureDotFilesLinked", "created symlink", {
				from: src,
				to: dst,
			})
		} catch (e) {
			logWithLevel(
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

type LogLevel = "debug" | "warn" | "error"
function logWithLevel(
	level: LogLevel,
	subcontext: string,
	message: string,
	aux: any,
) {
	console[level](subcontext, message, aux)
}

main()
