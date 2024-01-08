import {createBlogPost} from "./index.js"

export default createBlogPost({
	title: "New Habits",
	date: "2024-01-07",
	render: () => <Content />,
})

const Content = () => (
	<>
		<p>
			Something that I've finally accepted about myself: "tomorrow" is a
			bad idea. Anything worth starting is worth starting today. Anything
			worth changing is worth changing right now, not after I've had the
			chance to do the bad thing "just one more time".
		</p>
		<p>
			Having learned that, I've exercised regularly for the past year,
			been vape-free for 14 months, and sober for nearly 2. Still far from
			the level of health and discipline I aspire to, I've at least
			learned that "just one more X" is never "just one more".
		</p>
	</>
)
