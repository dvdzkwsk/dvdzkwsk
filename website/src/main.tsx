import {render} from "preact"
import {App, createAppContext} from "./App.js"
import {createBrowserHistory} from "history"
import {__unsafeGetBlogPosts} from "./blog/index.js"

function main() {
	const history = createBrowserHistory()
	const context = createAppContext(history)
	context.posts = __unsafeGetBlogPosts()
	const root = document.getElementById("root")!
	render(<App context={context} />, root)
}

main()
