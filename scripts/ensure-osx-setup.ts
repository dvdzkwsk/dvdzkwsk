import * as os from "os"
import * as fs from "fs"
import * as path from "path"
import {execScript} from "./_util.js"
import {newLogger} from "@dvdzkwsk/logger"

const logger = newLogger("EnsureOSXSetup")

interface Options {
	force: boolean
}

async function ensureOSXSetup() {
	const options: Options = {
		force: process.argv.includes("--force"),
	}
	await ensureDotFilesLinked(options)
	await ensureConfigFilesLinked(options)
}

async function ensureDotFilesLinked(options: Options) {
	for (const name of fs.readdirSync("dotfiles")) {
		if (!name.startsWith(".")) continue

		logger.debug("ensureDotFilesLinked", "ensure dotfile", {name})
		await ensureSymlink(
			{
				from: path.join(os.homedir(), name),
				to: path.join(process.cwd(), "dotfiles", name),
			},
			options,
		)
	}
}

async function ensureConfigFilesLinked(options: Options) {
	logger.debug("ensureConfigFilesLinked", "ensure config file", {
		name: "vscode/settings.json",
	})
	await ensureSymlink(
		{
			from: path.join(
				os.homedir(),
				"Library/Application Support/Code/User/settings.json",
			),
			to: path.join(
				process.cwd(),
				"dotfiles/config/vscode/settings.json",
			),
		},
		options,
	)
}

/**
 * Ensures a symlink exists at `src` and points to `dst`.
 */
async function ensureSymlink(
	link: {from: string; to: string},
	options: {force: boolean},
) {
	if (fs.existsSync(link.from)) {
		const stat = await fs.promises.lstat(link.from)
		if (stat.isSymbolicLink()) {
			const linksTo = await fs.promises.readlink(link.from)
			if (linksTo === link.to) {
				return
			}
		}
		if (!options?.force) {
			throw logger.newError(
				"ensureSymlink",
				"a file already exists at the destination path. Use --force to override it.",
				link,
			)
		}
		logger.debug(
			"ensureSymlink",
			"(force) removing file so it can be re-created as a symlink.",
			link,
		)
		try {
			await fs.promises.rm(link.from, {force: true})
		} catch (e) {
			throw logger.newError(
				"ensureSymlink",
				"failed to remove existing file",
				{
					...link,
					error: e,
				},
			)
		}
	}
	try {
		await fs.promises.symlink(link.to, link.from, "file")
		logger.debug("ensureSymlink", "created symlink", link)
	} catch (e) {
		throw logger.newError("ensureSymlink", "failed to create symlink", {
			...link,
			error: e,
		})
	}
}

execScript(import.meta, ensureOSXSetup)
