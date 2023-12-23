import {render} from "preact"
import {App} from "./App.js"

function main() {
	const root = document.getElementById("root")!
	render(<App />, root)
}

main()
