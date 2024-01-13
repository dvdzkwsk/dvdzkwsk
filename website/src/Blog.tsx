import {Link, PageLayout} from "./Layout.js"
import {BlogPost} from "./blog/BlogPostUtil.js"
import {getBlogPosts} from "./blog/index.js"

export const Archive = () => {
	const posts = getBlogPosts()
	return (
		<PageLayout>
			<h2>Blog Posts</h2>
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
							<Link
								href={`/blog/${post.slug}`}
								className="Blog-link"
							>
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
			<Link href={`/blog/${post.slug}`}>
				<h2>{post.title}</h2>
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
