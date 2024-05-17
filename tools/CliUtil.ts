import * as fs from "fs"
import * as url from "url"
import * as path from "path"
import {ConsoleTransport, setLoggerTransports} from "@pkg/logger/Logger.js"

export function isMainModule(importMeta: ImportMeta) {
	return path.resolve(process.argv[1]) === url.fileURLToPath(importMeta.url)
}

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

export function getEnvVar(key: string): string | null {
	const value = process.env[key]
	if (!value) {
		console.warn("Warn: missing environment variable: %s", key)
	}
	return value ?? null
}

export function dirname(importMeta: ImportMeta): string {
	return path.dirname(url.fileURLToPath(importMeta.url))
}
