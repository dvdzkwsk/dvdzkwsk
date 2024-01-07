import {ComponentChildren} from "preact"
import NewWebsite from "./2024-01-06-new-website.js"

export interface BlogPost {
	title: string
	slug: string
	render(): ComponentChildren
}

export function getBlogPosts(): BlogPost[] {
	return [NewWebsite]
}

interface CreateBlogPostOptions extends Omit<BlogPost, "slug"> {
	slug?: string
	date?: string
}
export function createBlogPost(options: CreateBlogPostOptions) {
	const post: BlogPost = {
		...options,
		slug: options.slug || sluggify(options.title),
	}
	return post
}

function sluggify(title: string) {
	return title.toLowerCase().replace(/(\s+)/, "-")
}
