import * as fs from "fs"
import * as path from "path"
import * as url from "url"
import {createMemoryHistory} from "history"
import {renderToString} from "preact-render-to-string"
import {Logger} from "@dvdzkwsk/logger"
import {App, Route, createAppContext, getRoutes} from "./App.js"

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const logger = new Logger("SSR")

async function main() {
	const templateHtml = fs.readFileSync(
		path.join(__dirname, "../dist/index.html"),
		"utf8",
	)
	for (const route of getRoutes()) {
		await buildRoute(route, templateHtml)
	}
}

async function buildRoute(route: Route, templateHtml: string) {
	const dst = route.path.endsWith("/")
		? path.join(__dirname, "../dist", route.path + "index.html")
		: path.join(__dirname, "../dist", route.path + ".html")

	logger.debug("buildRoute", "building route", {route, dst})

	const history = createMemoryHistory()
	history.replace(route.path)

	const ctx = createAppContext(history)
	const app = renderToString(<App context={ctx} />)

	let html = templateHtml
	html = html.replace('<div id="root"></div>', `<div id="root">${app}</div>`)

	const domain = process.env.WEBSITE_DOMAIN
	if (domain) {
		const uri = route.path.replace(/\/$/, "")
		const href = `https://${domain}${uri}`
		logger.debug("buildRoute", "write canonical tag", {route, href: uri})
		html = html.replace(
			"</head>",
			`<link rel="canonical" href="${href}" /></head>`,
		)
	}

	await fs.promises.mkdir(path.dirname(dst), {recursive: true})
	await fs.promises.writeFile(dst, html, "utf8")
}

main()
