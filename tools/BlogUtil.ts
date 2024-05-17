import * as fs from "fs"
import * as path from "path"
import {Logger} from "@pkg/logger/Logger.js"
import {dirname, execScript} from "./CliUtil.js"

const logger = new Logger("BlogUtil")

const BLOG_DIR = path.join(dirname(import.meta), "../cmd/website/blog")

async function blogUtilCli() {
	await buildBlogIndex()
}

export async function buildBlogIndex() {
	logger.debug("buildBlogIndex", "rebuilding index...")

	const dst = path.join(BLOG_DIR, "_generated/index.ts")
	await fs.promises.rm(dst, {force: true})

	const files = await fs.promises.readdir(BLOG_DIR).then((files) => {
		return files.filter((file) => file.endsWith(".tsx"))
	})

	const posts = await Promise.all(
		files.map(async (file) => {
			const post = await import(path.join(BLOG_DIR, file)).then(
				(m) => m.default,
			)

			return {
				path: file.replace(path.extname(file), ".js"),
				title: post.title,
				moduleName: post.title.replace(/[\s()]/g, ""),
			}
		}),
	)

	let content = ""
	content += "// THIS IS A GENERATED FILE. DO NOT EDIT IT DIRECTLY."
	content += "\n"
	for (const post of posts) {
		content += "\n"
		content += `import ${post.moduleName} from "../${post.path}"`
	}
	content += "\n\n"
	content += "export default ["
	for (const post of posts) {
		content += "\n"
		content += `\t${post.moduleName},`
	}
	content += "\n]\n"

	logger.debug("buildBlogIndex", "write index", {dst})

	await fs.promises.mkdir(path.dirname(dst), {recursive: true})
	await fs.promises.writeFile(dst, content, "utf8")
}

execScript(import.meta, blogUtilCli)
