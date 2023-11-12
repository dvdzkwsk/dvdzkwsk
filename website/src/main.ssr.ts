import {html} from "lit-html"
import {render} from "@lit-labs/ssr"
import {collectResult} from "@lit-labs/ssr/lib/render-result.js"

async function main() {
	const result = render(html`<h1>Hello World</h1>`)
	const ssr = await collectResult(result)
	console.log(ssr)
}

main()
