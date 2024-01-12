import {Link, PageLayout} from "./Layout.js"

export const About = () => {
	return (
		<PageLayout>
			<h1>About Me</h1>
			<p>
				My name is David Zukowski. I'm a software engineer based out of
				Washington state. I currently work at{" "}
				<Link href="https://material.security">Material Security</Link>,
				where we protect sensitive data in your Google and Outlook
				accounts even if they get compromised. Previously I worked at
				Microsoft on the new, faster version of Microsft Teams. You can
				see my full work history{" "}
				<Link href="https://www.linkedin.com/in/david-zukowski-0318a475/">
					here
				</Link>
				.
			</p>
			<p>
				My steadfast companion is Kona, the friendliest corgi you'll
				ever meet. We spend lots of time visiting local parks. Beside
				that, I enjoy playing guitar, reading, and being outdoors.
			</p>
		</PageLayout>
	)
}
