import * as fs from "fs"
import * as path from "path"
import * as url from "url"
import {renderToString} from "preact-render-to-string"
import {Logger} from "@dvdzkwsk/logger"
import {App} from "./App.js"
import {loadBlogPosts} from "../../scripts/_blog.js"

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const logger = new Logger("SSR")

async function main() {
	const templateHtml = fs.readFileSync(
		path.join(__dirname, "../dist/index.html"),
		"utf8",
	)

	const posts = await loadBlogPosts(path.join(__dirname, "../blog"))
	;(globalThis as any).BLOG_POSTS = posts

	await buildRoute({path: "/"}, templateHtml)
	for (const post of posts) {
		await buildRoute({path: `/blog/${post.meta.slug}`}, templateHtml)
	}
}

interface Route {
	path: string
}

async function buildRoute(route: Route, templateHtml: string) {
	const dst = route.path.endsWith("/")
		? path.join(__dirname, "../dist", route.path + "index.html")
		: path.join(__dirname, "../dist", route.path, "index.html")

	logger.debug("buildRoute", "building route", {route, dst})

	const app = renderToString(<App />)
	let html = templateHtml.replace(
		'<div id="root"></div>',
		`<div id="root">${app}</div>`,
	)

	await fs.promises.mkdir(path.dirname(dst), {recursive: true})
	await fs.promises.writeFile(dst, html, "utf8")
}

main()
