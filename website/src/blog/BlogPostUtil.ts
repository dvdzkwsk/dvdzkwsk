import {ComponentChildren} from "preact"

export interface BlogPost {
	title: string
	description: string
	slug: string
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
	const post: BlogPost = {
		...options,
		description: options.description || "",
		date: yyyymmddToLocalDate(options.date),
		slug: options.slug || sluggify(options.title),
	}
	return post
}

export function sluggify(title: string) {
	return title.toLowerCase().replace(/(\s+)/, "-")
}

function yyyymmddToLocalDate(isoString: string) {
	const [year, month, day] = isoString.split("-") as any
	return new Date(year, month - 1, day)
}
