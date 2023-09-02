import {render} from "preact"
import {App} from "./App"

function main() {
	const root = document.getElementById("root")!
	render(<App />, root)
}

main()
