import {Link} from "../Router.js"
import {getBlogPosts} from "../blog/BlogUtil.js"
import {PageLayout} from "../components/PageLayout.js"
import {formatDate, parseDateString} from "../lib/DateUtil.js"
import {Text} from "../lib/TextUtil.js"

const READING_LOG = [
	{date: parseDateString("2024-01-23"), title: "A Scanner Darkly"},
	{date: parseDateString("2023-12-26"), title: "The Three Body Problem"},
	{date: parseDateString("2023-12-15"), title: "Chickenhawk"},
]

export const Archive = () => {
	const posts = getBlogPosts()
	return (
		<PageLayout>
			<Text headingLevel={2}>Blog Posts</Text>
			<ol className="Archive-List">
				{posts.map((post) => {
					return (
						<li key={post.title}>
							<Link href={post.path} className="Archive-Link">
								<Text as="span" mono>
									{formatDate(post.date)} - {post.title}
								</Text>
							</Link>
						</li>
					)
				})}
			</ol>
			<Text headingLevel={2} style={{marginTop: "1.5rem"}}>
				Reading Log
			</Text>
			<ol className="Archive-List">
				{READING_LOG.map((book) => {
					return (
						<li key={book.title}>
							<Text as="span" mono>
								{formatDate(book.date)} - {book.title}
							</Text>
						</li>
					)
				})}
			</ol>
		</PageLayout>
	)
}
