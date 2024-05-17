import {createBlogPost} from "../Blog.js"

export default createBlogPost({
	title: "New Website",
	date: "2024-01-06",
	render: () => <Content />,
})

const Content = () => (
	<>
		<p>
			So this is my new website. Historically I've found it difficult to
			keep these things up-to-date because writing blog posts mostly for
			myself is low-priority to say the least. This is the latest go at
			turning it into something meaningful.
		</p>
	</>
)
