import * as fs from "fs"
import * as url from "url"
import * as path from "path"
import {
	ConsoleTransport,
	Logger,
	setLoggerTransports,
} from "../src/util/Logger.js"

const logger = new Logger("CliUtil")

export async function execScript(
	importMeta: ImportMeta,
	handler: () => unknown,
) {
	if (isMainModule(importMeta)) {
		setLoggerTransports([new ConsoleTransport({verbose: true})])
		await loadEnvFile()
		await handler()
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
	} catch (e) {
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
