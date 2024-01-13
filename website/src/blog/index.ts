import {BlogPost} from "../Blog.js"
// This file gets generated at build time.
import BLOG_POSTS from "./index.registry.js"

export function getBlogPosts(): BlogPost[] {
	return BLOG_POSTS.sort((a, b) => +b.date - +a.date)
}
