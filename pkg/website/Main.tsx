import {createBrowserHistory} from "history"
import {createRoot} from "react-dom/client"
import {App, createAppContext} from "./App.js"

function main() {
	const history = createBrowserHistory()
	const context = createAppContext(history)
	const root = createRoot(document.getElementById("root")!)
	root.render(<App context={context} />)
}

main()
