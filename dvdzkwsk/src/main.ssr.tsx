import * as fs from "fs"
import * as path from "path"
import * as url from "url"
import {renderToString} from "preact-render-to-string"
import {App} from "./App.js"

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

async function main() {
	const template = fs.readFileSync(
		path.join(__dirname, "../public/index.html"),
		"utf8",
	)
	const app = renderToString(<App />)
	let html = template.replace(
		'<div id="root"></div>',
		`<div id="root">${app}</div>`,
	)
	console.log(html)
}

main()
