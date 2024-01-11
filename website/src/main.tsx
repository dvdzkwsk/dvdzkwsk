import {render} from "preact"
import {App, createAppContext} from "./App.js"
import {createBrowserHistory} from "history"

function main() {
	const history = createBrowserHistory()
	const context = createAppContext(history)
	const root = document.getElementById("root")!
	render(<App context={context} />, root)
}

main()
