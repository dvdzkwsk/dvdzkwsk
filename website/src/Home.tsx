import {BlogPostPreview} from "./Blog.js"
import {PageLayout} from "./lib/LayoutUtil.js"
import {getBlogPosts} from "./blog/index.js"

export const Home = () => {
	const recentBlogPosts = getBlogPosts()
	return (
		<PageLayout>
			{recentBlogPosts.map((post) => {
				return <BlogPostPreview key={post.title} post={post} />
			})}
		</PageLayout>
	)
}
