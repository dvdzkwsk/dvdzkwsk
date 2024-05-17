// This file gets generated at build time.
import {ComponentChildren} from "preact"
import ALL_BLOG_POSTS from "./_generated/index.js"
import {parseDateString} from "../lib/DateUtil.js"
import {sluggify} from "../lib/TextUtil.js"

const BLOG_POSTS = (ALL_BLOG_POSTS as BlogPost[]).sort((a, b) => {
	return +b.date - +a.date
})

export interface BlogPost {
	title: string
	description: string
	path: string
	date: Date
	render(): ComponentChildren
	preview?(): ComponentChildren
}

export function getBlogPosts(): BlogPost[] {
	return BLOG_POSTS
}

interface CreateBlogPostOptions {
	title: string
	description?: string
	slug?: string
	date: string
	render(): ComponentChildren
	preview?(): ComponentChildren
}
export function createBlogPost(options: CreateBlogPostOptions) {
	const slug = options.slug || sluggify(options.title)
	const post: BlogPost = {
		...options,
		description: options.description || "",
		date: parseDateString(options.date),
		path: `/blog/${slug}`,
	}
	return post
}
