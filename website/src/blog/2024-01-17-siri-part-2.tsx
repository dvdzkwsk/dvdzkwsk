import {createBlogPost} from "../Blog.js"

export default createBlogPost({
	title: "Siri (Part 2)",
	date: "2024-01-17",
	render: () => <Content />,
})

const Content = () => (
	<>
		<p>
			<em>Scene: driving, approaching a red light.</em>
		</p>
		<p>"RED LIGHT CAMERA AHEAD."</p>
		<p>"Hey Siri, how do I turn off red light camera alerts?"</p>
		<p>"Ok, which room? Kitchen, Living Room, ..."</p>
		<p>...</p>
	</>
)
