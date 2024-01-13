import {getBlogPosts} from "./blog/index.js"
import {PageLayout, Link} from "./Layout.js"
import {Text} from "./Typography.js"

export const Archive = () => {
	const posts = getBlogPosts()
	return (
		<PageLayout>
			<Text headingLevel={2}>Blog Posts</Text>
			<ol style={{listStyle: "circle", paddingLeft: "1rem"}}>
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
