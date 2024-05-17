import {getBlogPosts} from "../blog/BlogUtil.js"
import {PageLayout} from "../components/PageLayout.js"
import {BlogPostPreview} from "./BlogPost.js"

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
