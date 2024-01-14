import {type BlogPost} from "../Blog.js"
// This file gets generated at build time.
import BLOG_POSTS from "./index.registry.js"

/** This should only be imported from main.ts and main.ssr.tsx */
export function __unsafeGetBlogPosts(): BlogPost[] {
	return BLOG_POSTS.sort((a, b) => +b.date - +a.date)
}
