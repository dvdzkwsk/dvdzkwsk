import * as fs from "fs"
import * as path from "path"
import * as url from "url"
import {renderToString} from "preact-render-to-string"
import {App} from "./App.js"
import {newLogger} from "@dvdzkwsk/logger"

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const logger = newLogger("SSR")

async function main() {
	const templateHtml = fs.readFileSync(
		path.join(__dirname, "../dist/index.html"),
		"utf8",
	)
	for (const route of getRoutesToBuild()) {
		await buildRoute(route, templateHtml)
	}
}

function getRoutesToBuild(): Route[] {
	return [{path: "/"}]
}

interface Route {
	path: string
}

async function buildRoute(route: Route, templateHtml: string) {
	const dst = route.path.endsWith("/")
		? path.join(__dirname, "../dist", route.path + "index.html")
		: path.join(__dirname, "../dist", route.path)

	logger.debug("buildRoute", "building route", {route, dst})

	const app = renderToString(<App />)
	let html = templateHtml.replace(
		'<div id="root"></div>',
		`<div id="root">${app}</div>`,
	)
	await fs.promises.writeFile(dst, html, "utf8")
}

main()
