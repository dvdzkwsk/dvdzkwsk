import {ComponentChildren} from "preact"
import NewWebsite from "./2024-01-06-new-website.js"
import NewHabits from "./2024-01-07-new-habits.js"

export interface BlogPost {
	title: string
	slug: string
	date: Date
	render(): ComponentChildren
}

export function getBlogPosts(): BlogPost[] {
	return [NewHabits, NewWebsite]
}

interface CreateBlogPostOptions {
	title: string
	slug?: string
	date: string
	render(): ComponentChildren
}
export function createBlogPost(options: CreateBlogPostOptions) {
	const post: BlogPost = {
		...options,
		date: yyyymmddToLocalDate(options.date),
		slug: options.slug || sluggify(options.title),
	}
	return post
}

function sluggify(title: string) {
	return title.toLowerCase().replace(/(\s+)/, "-")
}

function yyyymmddToLocalDate(isoString: string) {
	const [year, month, day] = isoString.split("-") as any
	return new Date(year, month - 1, day)
}
