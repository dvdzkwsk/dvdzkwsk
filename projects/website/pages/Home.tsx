import * as React from "react"
import {Text} from "../components/Text.js"
import {DefaultLayout} from "../layouts/DefaultLayout.js"
import {Link, definePage} from "../RouterJson.js"

const HomePage: React.FC = () => {
	return (
		<>
			<Text headingLevel={1}>Hello!</Text>
			<Text>
				My name is David Zukowski. I'm a software engineer based out of
				Washington state. I currently work at{" "}
				<Link href="https://microsoft.com">Microsoft</Link> where I help
				build design systems that support Microsoft Teams, OneDrive, and
				more.
			</Text>
			<Text>
				Prior to that I worked at{" "}
				<Link href="https://material.security/">Material Security</Link>
				, where we did some cool stuff to secure Google Workspace and
				Microsoft 365 environments.
			</Text>
		</>
	)
}

export default definePage({
	title: "Home",
	layout: DefaultLayout,
	content: HomePage,
})
