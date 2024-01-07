import * as fs from "fs"
import * as path from "path"
import * as url from "url"
import {createMemoryHistory} from "history"
import {renderToString} from "preact-render-to-string"
import {Logger} from "@dvdzkwsk/logger"
import {App, Route, getRoutes} from "./App.js"

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
	const app = renderToString(<App history={history} />)

	let html = templateHtml.replace(
		'<div id="root"></div>',
		`<div id="root">${app}</div>`,
	)

	await fs.promises.mkdir(path.dirname(dst), {recursive: true})
	await fs.promises.writeFile(dst, html, "utf8")
}

main()
