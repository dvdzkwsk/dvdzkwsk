import * as fs from "fs"
import * as path from "path"
import * as url from "url"
import crossSpawn from "cross-spawn"
import {
	ConsoleTransport,
	Logger,
	setLoggerTransports,
} from "../logger/Logger.js"

const logger = new Logger("CliUtil")

export async function createCliTool(
	importMeta: ImportMeta,
	handler: () => unknown,
) {
	if (isMainModule(importMeta)) {
		setLoggerTransports([new ConsoleTransport({verbose: true})])
		await loadEnvFile()
		try {
			await handler()
		} catch (error) {
			logger.error("createCliTool", "script failed", {error})
			process.exit(1)
		}
	}
}

function isMainModule(importMeta: ImportMeta) {
	return path.resolve(process.argv[1]) === url.fileURLToPath(importMeta.url)
}

// Package scripts run from their project's directory, so also read the
// repo-level .env. The current directory's .env wins on conflicts.
const REPO_ROOT = path.join(import.meta.dirname, "../..")

async function loadEnvFile() {
	const filepaths = [path.join(REPO_ROOT, ".env"), path.resolve(".env")]
	for (const filepath of new Set(filepaths)) {
		const env = await readEnvFile(filepath)
		for (const [key, value] of Object.entries(env ?? {})) {
			process.env[key] = value
		}
	}
}

async function readEnvFile(
	filepath: string,
): Promise<Record<string, string> | null> {
	const result: Record<string, string> = {}
	try {
		const env = await fs.promises.readFile(filepath, "utf8")
		for (let kv of env.split("\n")) {
			kv = kv.trim()
			if (!kv) {
				continue
			}
			if (kv.startsWith("#")) {
				continue
			}
			// Split on the first "=" only; values (e.g. tokens) may contain "="
			const i = kv.indexOf("=")
			if (i === -1) {
				continue
			}
			const key = kv.slice(0, i).trim()
			let value = kv.slice(i + 1).trim()
			if (/^(["']).*\1$/.test(value)) {
				value = value.slice(1, -1)
			}
			result[key] = value
		}
	} catch {
		return null
	}
	return result
}

export function getEnvVar(name: string, required = true): string {
	const value = process.env[name]
	if (!value) {
		if (required) {
			throw logger.newError(
				"getEnvVar",
				"missing required environment variable",
				{variable: name},
			)
		} else {
			logger.warn("getEnvVar", "missing environment variable", {
				variable: name,
			})
		}
	}
	return value ?? ""
}

/** Runs a command to completion, throwing if it fails. */
export function runCommand(
	command: string,
	args: string[],
	options: {cwd?: string; env?: Record<string, string>} = {},
) {
	const result = crossSpawn.sync(command, args, {
		stdio: "inherit",
		cwd: options.cwd,
		env: {...process.env, ...options.env},
	})
	if (result.error || result.status !== 0) {
		throw logger.newError("runCommand", "command failed", {
			command: [command, ...args].join(" "),
			status: result.status,
			error: result.error,
		})
	}
}
