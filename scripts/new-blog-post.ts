import * as fs from "fs"
import * as url from "url"
import * as path from "path"
import {sluggify} from "../website/src/blog/BlogPostUtil.js"
import {rebuildBlogIndex} from "./build-website.js"

async function newBlogPost() {
	const dirname = path.dirname(url.fileURLToPath(import.meta.url))
	const today = new Date()
	const yyyy = today.getFullYear()
	const mm = (today.getMonth() + 1).toString().padStart(2, "0")
	const dd = today.getDate().toString().padStart(2, "0")
	const title = process.argv.slice(2).join(" ")

	if (!title) {
		console.error("Please provide a title for the blog post.")
		process.exit(1)
	}

	const file = `${yyyy}-${mm}-${dd}-${sluggify(title)}.tsx`

	let content = `import {createBlogPost} from "./BlogPostUtil.js"

export default createBlogPost({
    title: "${title}",
    date: "${yyyy}-${mm}-${dd}",
    render: () => <Content />
})

const Content = () => (
    <>
        <p></p>
    </>
)
`
	await fs.promises.writeFile(
		path.join(dirname, "../website/src/blog/", file),
		content,
		"utf8",
	)
	await rebuildBlogIndex(path.join(dirname, "../website"))
}

newBlogPost()
