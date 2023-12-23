import * as fs from "fs"
import * as cp from "child_process"
import * as url from "url"
import * as path from "path"

export async function loadEnv() {
	try {
		const env = fs.readFileSync(".env", "utf8")
		for (const kv of env.split("\n")) {
			const [key, value] = kv.split("=")
			process.env[key] = value
		}
	} catch (e) {}
}

export function getEnv(key: string): string | null {
	const value = process.env[key]
	if (!value) {
		console.warn("Warn: missing environment variable: %s", key)
	}
	return value ?? null
}

export async function shell(script: string): Promise<{
	code: number
	stdout: string
	stderr: string
}> {
	return new Promise((resolve, reject) => {
		console.log("Run: %s", script)

		const [cmd, ...args] = script.split(" ")
		const proc = cp.spawn(cmd, args, {shell: true})

		let stdout = ""
		let stderr = ""

		proc.stdout.on("data", (data) => {
			stdout += data.toString()
			process.stdout.write(data)
		})

		proc.stderr.on("data", (data) => {
			stderr += data.toString()
			process.stderr.write(data)
		})

		proc.on("error", (err) => {
			reject(err)
		})
		proc.on("close", (code) => {
			resolve({stdout, stderr, code: code || 1})
		})
	})
}

export function isMainModule(importMeta: any) {
	return path.resolve(process.argv[1]) === url.fileURLToPath(importMeta.url)
}
