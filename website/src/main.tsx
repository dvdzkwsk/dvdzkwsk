import {render} from "preact"
import {App} from "./App.js"
import {createBrowserHistory} from "history"

function main() {
	const history = createBrowserHistory()
	const root = document.getElementById("root")!
	render(<App history={history} />, root)
}

main()
