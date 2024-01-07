import {BlogPost, getBlogPosts} from "../blog/index.js"

export const App = () => {
	const recentBlogPosts = getBlogPosts()
	return (
		<main className="app">
			{recentBlogPosts.map((post) => {
				return <BlogPostPreview key={post.meta.title} post={post} />
			})}
		</main>
	)
}

const BlogPostPreview = ({post}: {post: BlogPost}) => {
	return (
		<article>
			<h3>{post.meta.title}</h3>
			<div dangerouslySetInnerHTML={{__html: post.html}} />
		</article>
	)
}
