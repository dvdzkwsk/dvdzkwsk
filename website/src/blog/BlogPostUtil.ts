import {ComponentChildren} from "preact"

export interface BlogPost {
	title: string
	description: string
	path: string
	date: Date
	render(): ComponentChildren
}

interface CreateBlogPostOptions {
	title: string
	description?: string
	slug?: string
	date: string
	render(): ComponentChildren
}
export function createBlogPost(options: CreateBlogPostOptions) {
	const slug = options.slug || sluggify(options.title)
	const post: BlogPost = {
		...options,
		description: options.description || "",
		date: yyyymmddToLocalDate(options.date),
		path: `/blog/${slug}`,
	}
	return post
}

export function sluggify(title: string) {
	return title.toLowerCase().replace(/(\s+)/g, "-").replace(/[()]/g, "")
}

function yyyymmddToLocalDate(isoString: string) {
	const [year, month, day] = isoString.split("-") as any
	return new Date(year, month - 1, day)
}
