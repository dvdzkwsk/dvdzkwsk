import * as fs from "fs"
import * as path from "path"
import * as url from "url"
import {createMemoryHistory} from "history"
import {renderToString} from "preact-render-to-string"
import {Logger} from "@pkg/logger/Logger.js"
import {App, createAppContext} from "./App.js"
import {Route, getRoutes} from "./Router.js"
import {__unsafeGetBlogPosts} from "./blog/index.js"

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const logger = new Logger("SSR")

async function main() {
	const templateHtml = fs.readFileSync(
		path.join(__dirname, "../dist/index.html"),
		"utf8",
	)
	const history = createMemoryHistory()
	const context = createAppContext(history)
	context.posts = __unsafeGetBlogPosts()
	const routes = getRoutes(context)
	for (const route of routes) {
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

main()
