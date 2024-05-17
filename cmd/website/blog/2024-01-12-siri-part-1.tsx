import {createBlogPost} from "../Blog.js"

export default createBlogPost({
	title: "Siri (Part 1)",
	date: "2024-01-12",
	render: () => <Content />,
})

const Content = () => (
	<>
		<p>"Hey Siri, add 'X' to the todo list."</p>
		<p>"I didn't find a todo list. Do you want to create one?"</p>
		<p>"Hey Siri, add a reminder to do 'X'."</p>
		<p>"Ok, I added 'X' to the todo list."</p>
		<p>...</p>
	</>
)
