import {PageLayout} from "../components/PageLayout.js"
import {Link} from "../Router.js"
import {Text} from "../lib/TextUtil.js"

export const About = () => {
	return (
		<PageLayout>
			<Text headingLevel={1}>About Me</Text>
			<Text>
				My name is David Zukowski. I'm a software engineer based out of
				Washington state. I currently work at{" "}
				<Link href="https://material.security">Material Security</Link>.
				We protect your Google and Outlook account, even if it gets
				hacked. Previously I worked at Microsoft on the new, faster
				version of Microsoft Teams. You can see my full work history{" "}
				<Link href="https://www.linkedin.com/in/david-zukowski-0318a475/">
					here
				</Link>
				.
			</Text>
			<Text>
				My steadfast companion is Kona, the friendliest corgi you'll
				ever meet. We spend lots of time visiting local parks. Beside
				that, I enjoy playing guitar, hockey, reading, and being
				outdoors.
			</Text>
		</PageLayout>
	)
}
