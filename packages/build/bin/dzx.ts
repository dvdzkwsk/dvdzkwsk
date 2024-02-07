#!/usr/bin/env tsx
import {ConsoleTransport, setLoggerTransports} from "@dvdzkwsk/logger"
import {build} from "../src/index.js"

async function main() {
	setLoggerTransports([new ConsoleTransport({verbose: false})])

	await build({
		cwd: process.cwd(),
		mode: process.argv.includes("--dev") ? "development" : "production",
		dev: process.argv.includes("--dev"),
		esbuild: {},
	})
}

main()
