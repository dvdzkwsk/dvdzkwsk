import * as path from "path"
import {ConsoleTransport, setLoggerTransports} from "@dvdzkwsk/logger"
import * as build from "@dvdzkwsk/build"

const WORKDIR = path.join(import.meta.dirname, "..", "packages/umbrella")
const DEV_MODE = process.argv.includes("--dev")
const BUILD_MODE = process.argv.includes("--dev") ? "development" : "production"

async function main() {
	setLoggerTransports([new ConsoleTransport({verbose: false})])
	await buildClient()
}

async function buildClient() {
	const env = await build.loadEnvFile(path.join(WORKDIR, ".env"), {
		only: [
			"GOOGLE_OAUTH_CLIENT_ID",
			"OAUTH_REDIRECT_URI",
			"SUPABASE_PROJECT_URL",
			"SUPABASE_PUBLIC_API_KEY",
		],
	})
	const context = build.context({
		workdir: WORKDIR,
		dst: path.join(WORKDIR, "dist/client"),
		entrypoints: [path.join(WORKDIR, "client/main.tsx")],
		publicdir: path.join(WORKDIR, "client/public"),
		target: "browser",
		mode: BUILD_MODE,
		env,
	})
	if (DEV_MODE) {
		await build.serve(context)
	} else {
		await build.buildToDisk(context)
	}
}

async function buildServer() {
	const context = build.context({
		workdir: WORKDIR,
		dst: path.join(WORKDIR, "dist/server"),
		entrypoints: [path.join(WORKDIR, "server/main.ts")],
		target: "node",
		mode: BUILD_MODE,
		env: {},
	})
	// await build.serve(context)
}

main()
