import {PageLayout} from "../components/PageLayout.js"
import {Text} from "../lib/TextUtil.js"
import {Link} from "../Router.js"
import {BlogPost} from "../blog/BlogUtil.js"

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

export const BlogPostPage = ({post}: {post: BlogPost}) => {
	return (
		<PageLayout>
			<Text headingLevel={1}>{post.title}</Text>
			{post.render()}
		</PageLayout>
	)
}
