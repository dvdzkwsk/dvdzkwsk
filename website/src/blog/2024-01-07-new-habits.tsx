import {createBlogPost} from "./BlogPostUtil.js"

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
			chance to do the bad thing "just one more time." Whether I can make
			the change <em>right now</em> is the first test of my commitment.
		</p>
		<p>
			Having learned that, I've been vape-free for 14 months and sober for
			nearly 2. While there's still a ways to go to achieve the health and
			discipline I aspire to, I'm happy to accept that, for me, "just one
			more" is never just one more, and "tomorrow" is always too late.
		</p>
	</>
)
