import {Link, PageLayout} from "./Layout.js"
import {Text} from "./Typography.js"
import {BlogPost} from "./blog/BlogPostUtil.js"
import {getBlogPosts} from "./blog/index.js"

export const Archive = () => {
	const posts = getBlogPosts()
	return (
		<PageLayout>
			<Text headingLevel={2}>Blog Posts</Text>
			<ol className="Blog-list">
				{posts.map((post) => {
					const yyyy = post.date.getFullYear()
					const mm = (post.date.getMonth() + 1)
						.toString()
						.padStart(2, "0")
					const dd = post.date.getDate().toString().padStart(2, "0")
					const date = `${yyyy}-${mm}-${dd}`
					return (
						<li>
							<Link href={post.path} className="Blog-link">
								{date} - {post.title}
							</Link>
						</li>
					)
				})}
			</ol>
		</PageLayout>
	)
}

export const BlogPostPreview = ({post}: {post: BlogPost}) => {
	return (
		<article style={{marginBottom: "2rem"}}>
			<Link href={post.path}>
				<Text headingLevel={2}>{post.title}</Text>
			</Link>
			<p style={{color: "var(--fg-muted)"}}>
				{post.date.toLocaleDateString("en-us", {
					year: "numeric",
					month: "long",
					day: "numeric",
				})}
			</p>
			{post.render()}
		</article>
	)
}
