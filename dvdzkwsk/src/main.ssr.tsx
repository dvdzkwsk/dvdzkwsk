import * as fs from "fs"
import * as path from "path"
import * as url from "url"
import {renderToString} from "preact-render-to-string"
import {App} from "./App.js"

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

async function main() {
	const template = fs.readFileSync(
		path.join(__dirname, "../dist/index.html"),
		"utf8",
	)
	const app = renderToString(<App />)
	let html = template.replace(
		'<div id="root"></div>',
		`<div id="root">${app}</div>`,
	)
	const dst = path.join(__dirname, "../dist/index.html")
	await fs.promises.writeFile(dst, html, "utf8")
}

main()
