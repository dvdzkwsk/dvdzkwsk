import {render} from "preact"
import {createBrowserHistory} from "history"
import {App, createAppContext} from "./App.js"

function main() {
	const history = createBrowserHistory()
	const context = createAppContext(history)
	const root = document.getElementById("root")!
	render(<App context={context} />, root)
}

main()
