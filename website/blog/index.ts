export interface BlogPost {
	html: string
	meta: {
		title: string
		slug: string
		preview: string
	}
}

// This file exists to satisfy TypeScript. Its implementation is replaced at build time.
// During SSR there's no pre-build step so it injects them via a global.
export function getBlogPosts(): BlogPost[] {
	return (globalThis as any).BLOG_POSTS || []
}
