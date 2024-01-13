import {createBlogPost} from "../Blog.js"

export default createBlogPost({
	title: "My Favorite Kind of Documentation",
	date: "2024-01-12",
	render: () => <Content />,
})

const Content = () => (
	<>
		<p>
			Is printable in full. It's a web page or a file that I can press
			`ctrl+f` and search. It's that massive wall of text full of examples
			that you oh so desperately want to split into sub-documents with
			tags and cross-links and whatever else you can dream up.
		</p>
		<p>
			Put the keyboard down and walk away. Resist the temptation. That
			5,000 word plain text file is far more practical than a scavenger
			hunt through a web of cross-linked documents.
		</p>
	</>
)
