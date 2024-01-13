import {Link, PageLayout} from "./Layout.js"
import {Text} from "./Typography.js"
import {BlogPost} from "./blog/BlogPostUtil.js"

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
			{post.render()}
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
