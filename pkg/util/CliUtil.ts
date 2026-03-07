import * as fs from "fs"
import * as path from "path"
import * as url from "url"
import {ConsoleTransport, Logger, setLoggerTransports} from "./Logger.js"

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

async function loadEnvFile() {
	const env = await readEnvFile(".env")
	if (env) {
		for (const [key, value] of Object.entries(env)) {
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
			const [key, value] = kv.split("=")
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
