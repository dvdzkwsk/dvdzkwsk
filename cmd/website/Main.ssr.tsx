import * as fs from "fs"
import * as path from "path"
import {createMemoryHistory} from "history"
import {renderToString} from "preact-render-to-string"
import {Logger} from "@pkg/logger/Logger.js"
import {App, createAppContext} from "./App.js"
import {Route, ROUTES} from "./Router.js"
import {dirname} from "../../tools/CliUtil.js"

const OUT_DIR = path.join(dirname(import.meta), "dist")

const logger = new Logger("SSR")

export async function ssr() {
	const templateHtml = fs.readFileSync(
		path.join(OUT_DIR, "index.html"),
		"utf8",
	)
	const history = createMemoryHistory()
	const context = createAppContext(history)
	for (const route of ROUTES) {
		await buildRoute(route, templateHtml)
	}
}

async function buildRoute(route: Route, templateHtml: string) {
	const dst = route.path.endsWith("/")
		? path.join(OUT_DIR, route.path + "index.html")
		: path.join(OUT_DIR, route.path + ".html")

	logger.debug("buildRoute", "building route", {route, dst})

	const history = createMemoryHistory()
	history.replace(route.path)

	const context = createAppContext(history)
	const app = renderToString(<App context={context} />)

	let html = templateHtml
	html = html.replace('<div id="root"></div>', `<div id="root">${app}</div>`)

	if (context.metaHtml) {
		html = html.replace("</head>", `${context.metaHtml}</head>`)
	}

	await fs.promises.mkdir(path.dirname(dst), {recursive: true})
	await fs.promises.writeFile(dst, html, "utf8")
}
