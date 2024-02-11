import {ComponentChildren} from "preact"
import {PageLayout} from "./lib/LayoutUtil.js"
import {Text, sluggify} from "./lib/TextUtil.js"
import {parseDateString} from "./lib/DateUtil.js"
import {useContext} from "preact/hooks"
import {AppContext} from "./App.js"
import {Link} from "./Router.js"

export interface BlogPost {
	title: string
	description: string
	path: string
	date: Date
	render(): ComponentChildren
	preview?(): ComponentChildren
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

export const BlogPostPreview = ({post}: {post: BlogPost}) => {
	return (
		<article style={{marginBottom: "2rem"}}>
			<Link href={post.path}>
				<Text headingLevel={2}>{post.title}</Text>
			</Link>
			<Text muted style={{marginTop: "-0.35rem"}}>
				{post.date.toLocaleDateString("en-us", {
					year: "numeric",
					month: "long",
					day: "numeric",
				})}
			</Text>
			{post.preview?.() ?? post.render()}
		</article>
	)
}

export const BlogPostRenderer = ({post}: {post: BlogPost}) => {
	return (
		<PageLayout>
			<Text headingLevel={1}>{post.title}</Text>
			{post.render()}
		</PageLayout>
	)
}

export function useBlogPosts(): BlogPost[] {
	return useContext(AppContext).posts
}
