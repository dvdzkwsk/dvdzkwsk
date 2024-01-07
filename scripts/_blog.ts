import * as fs from "fs"
import * as path from "path"
import * as marked from "marked"
import type {BlogPost} from "../website/src/blog/index.js"

export async function loadBlogPosts(dir: string): Promise<BlogPost[]> {
	if (!fs.existsSync(dir)) {
		return []
	}
	const files = (await fs.promises.readdir(dir)).filter((f) => {
		return f.endsWith(".md")
	})
	return Promise.all(
		files.map((file) => {
			return loadBlogPostFromFile(path.join(dir, file))
		}),
	)
}

async function loadBlogPostFromFile(file: string): Promise<BlogPost> {
	let text = await fs.promises.readFile(file, "utf8")
	const meta: BlogPost["meta"] = {
		title: "",
		preview: "",
		slug: "",
	}
	const lines = text.split("\n")
	if (lines[0] === "---") {
		let i = 1
		for (; i < lines.length; i++) {
			const line = lines[i]
			if (line === "---") break
			const [k, v] = line.split(":")
			;(meta as any)[k.trim()] = v.trim()
		}
		text = lines.slice(i + 1).join("\n")
	}

	if (!meta.slug.trim()) {
		meta.slug = meta.title.toLowerCase().replace(/(\s+)/, "-")
	}
	return {
		meta,
		html: await marked.parse(text),
	}
}
