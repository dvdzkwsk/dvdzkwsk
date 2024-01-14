import {BlogPostPreview, useBlogPosts} from "./Blog.js"
import {PageLayout} from "./lib/LayoutUtil.js"

export const Home = () => {
	const recentBlogPosts = useBlogPosts()
	return (
		<PageLayout>
			{recentBlogPosts.map((post) => {
				return <BlogPostPreview key={post.title} post={post} />
			})}
		</PageLayout>
	)
}
