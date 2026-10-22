import * as fs from "fs"
import * as path from "path"
import {ConsoleTransport, Logger, setLoggerTransports} from "@dvdzkwsk/logger"
import compression from "compression"
import express from "express"

setLoggerTransports([new ConsoleTransport({verbose: true})])
const logger = new Logger("Server")

// Defaults suit a local `build`; the Fly.io image (see Dockerfile/fly.toml)
// runs a bundled copy of this file and points these at its own layout.
const PORT = Number(process.env.WEBSITE_PORT ?? 3001)
// Relative to projects/website, one level above server/
const PROJECT_DIR = path.join(import.meta.dirname, "..")
const DIST_DIR =
	process.env.WEBSITE_STATIC_DIR ?? path.join(PROJECT_DIR, "dist/website")

if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
	throw logger.newError("start", "no built site to serve; run `pnpm build`", {
		dir: DIST_DIR,
	})
}

const app = express()
app.use(compression())

// Fly's health check (see fly.toml)
app.get("/health", (_req, res) => {
	res.json({ok: true})
})

// Vite puts a content hash in every asset's name, so they never change
app.use(
	"/assets",
	express.static(path.join(DIST_DIR, "assets"), {
		immutable: true,
		maxAge: "1y",
	}),
)
app.use(express.static(DIST_DIR))
// The client routes every page (see RouteMap.tsx), including the 404 page
app.get("/{*path}", (_req, res) => {
	res.sendFile(path.join(DIST_DIR, "index.html"))
})

app.use(
	(
		error: unknown,
		_req: express.Request,
		res: express.Response,
		_next: express.NextFunction,
	) => {
		logger.error("request", "request failed", {error})
		res.status(500).send("Internal Server Error")
	},
)

const server = app.listen(PORT, () => {
	logger.info("listen", `server listening on http://localhost:${PORT}`)
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		logger.info("shutdown", "stopping", {signal})
		server.close(() => process.exit(0))
	})
}
