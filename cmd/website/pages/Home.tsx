import {Link} from "../Router.js"
import {PageLayout} from "../components/PageLayout.js"
import {Text} from "../components/Text.js"

const READING_LOG = [
	{title: "Girl with Curious Hair", author: "David Foster Wallace"},
	{title: "Ubik", author: "Philip K. Dick"},
	{title: "Galápagos", author: "Kurt Vonnegut"},
	{title: "Smokejumper", author: "Jason Ramos"},
	{title: "Into the Wild", author: "John Krakauer"},
]

export const Home = () => {
	return (
		<PageLayout>
			<Text headingLevel={1}>Hello!</Text>
			<Text>
				My name is David Zukowski. I'm a software engineer based out of
				Washington state. I currently work at{" "}
				<Link href="https://material.security/">Material Security</Link>
				. We do some cool stuff to secure Google Workspace and Microsoft
				365 environments. Prior to that I worked at Microsoft on a
				slimmer, faster version of Microsoft Teams. You can see my full
				work history{" "}
				<Link href="https://www.linkedin.com/in/david-zukowski-0318a475/">
					here
				</Link>
				.
			</Text>
			<Text>
				My steadfast companion is Kona, the friendliest corgi you'll
				ever meet. We spend lots of time visiting local parks. I'm an
				avid hockey player and a beginner guitarist. Easily spotted in a
				crowd as that guy over there staring up at airplanes.
			</Text>
			<Text headingLevel={2} style={{marginTop: "2rem"}}>
				2025 Reading List
			</Text>
			<ol
				style={{
					margin: 0,
					padding: 0,
					listStyle: "none",
				}}
			>
				{READING_LOG.map((it) => {
					return (
						<li key={it.title} style={{marginBottom: "0.75rem"}}>
							<span style={{display: "block", fontWeight: 500}}>
								{it.title}
							</span>{" "}
							by {it.author}
						</li>
					)
				})}
			</ol>
		</PageLayout>
	)
}
