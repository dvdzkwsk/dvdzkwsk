import * as fs from "fs"
import * as path from "path"
import * as esbuild from "esbuild"
import {Logger} from "@dvdzkwsk/logger"
import {buildWebApp} from "./WebApp.js"
import {buildNodeApp} from "./NodeApp.js"

const logger = new Logger("Build")

export interface BuildOptions {
	cwd: string
	dev: boolean
	mode: "development" | "production"
	esbuild: esbuild.BuildOptions
}

export async function build(options: BuildOptions) {
	if (!options.dev) {
		const dist = path.join(options.cwd, "dist")
		if (fs.existsSync(dist)) {
			logger.debug("build", "remove dist")
			await fs.promises.rm(path.join(options.cwd, "dist"), {
				recursive: true,
				force: true,
			})
		}
	}

	loadEnvVars(options.cwd)

	const pkg = JSON.parse(
		await fs.promises.readFile(
			path.join(options.cwd, "package.json"),
			"utf8",
		),
	)
	switch (pkg.packageType) {
		case "NodeApp":
			return buildNodeApp(options)
		case "WebApp":
			return buildWebApp(options)
		default:
			throw logger.newError("build", "unknown package type", {
				packageType: pkg.packageType,
			})
	}
}

function loadEnvVars(cwd: string) {
	const envFile = path.join(cwd, ".env")
	if (!fs.existsSync(envFile)) {
		logger.debug("loadEnvVars", ".env file does not exist", {path: envFile})
		return
	}
	const txt = fs.readFileSync(envFile, "utf8")
	for (const line of txt.split("\n")) {
		if (line.trim().startsWith("#")) {
			continue
		}
		const [key, value] = line.trim().split("=")
		if (key && value) {
			process.env[key] = value
		}
	}
}
