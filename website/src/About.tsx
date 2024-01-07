import {Link, PageLayout} from "./Layout.js"

export const About = () => {
	return (
		<PageLayout>
			<h1>About Me</h1>
			<p>
				My name is David Zukowski. I'm a software engineer based out of
				Washington State. I currently work at a startup called{" "}
				<Link href="https://material.security">Material Security</Link>,
				where we protect sensitive data in your Google and Outlook
				mailboxes even after you've been breached. It's pretty cool.
				Before that I was at Microsoft spearheading the new, faster
				version of Microsoft Teams.
			</p>
			<p>
				My steadfast companion is Kona, probably the friendliest corgi
				you'll ever meet. We spend lots of time visiting local parks.
				Beside that, I enjoy playing guitar, reading, and watching
				movies.
			</p>
		</PageLayout>
	)
}
