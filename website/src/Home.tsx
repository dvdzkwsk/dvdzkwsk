import {PageLayout} from "./Layout.js"
import {getBlogPosts} from "./blog/index.js"

export const Home = () => {
	const recentBlogPosts = getBlogPosts()
	return (
		<PageLayout>
			{recentBlogPosts.map((post) => {
				return (
					<article key={post.title} style={{marginBottom: "2rem"}}>
						<h2>{post.title}</h2>
						{post.render()}
					</article>
				)
			})}
		</PageLayout>
	)
}
