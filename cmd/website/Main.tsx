import "./css/Main.css"
import {render} from "preact"
import {createBrowserHistory} from "history"
import {App, createAppContext} from "./App.js"
import {__unsafeGetBlogPosts} from "./blog/index.js"

function main() {
	const history = createBrowserHistory()
	const context = createAppContext(history)
	context.posts = __unsafeGetBlogPosts()
	const root = document.getElementById("root")!
	render(<App context={context} />, root)
}

main()
