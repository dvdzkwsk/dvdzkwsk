import {BlogPost} from "./BlogPostUtil.js"
import BLOG_POSTS from "./index.registry.js"

export function getBlogPosts(): BlogPost[] {
	return BLOG_POSTS.sort((a, b) => +b.date - +a.date)
}
