import * as cp from "child_process"

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
