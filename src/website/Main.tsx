import {createRoot} from "react-dom/client"
import {createBrowserHistory} from "history"
import {App, createAppContext} from "./App.js"

function main() {
	const history = createBrowserHistory()
	const context = createAppContext(history)
	const root = createRoot(document.getElementById("root")!)
	root.render(<App context={context} />)
}

main()
