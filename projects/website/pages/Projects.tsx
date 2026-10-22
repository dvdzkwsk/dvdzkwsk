import * as React from "react"
import {Text} from "../components/Text.js"
import {DefaultLayout} from "../layouts/DefaultLayout.js"
import {Link, definePage} from "../RouterJson.js"

const ProjectsPage: React.FC = () => {
	return (
		<>
			<Text headingLevel={2}>
				<Link href="https://khl.dvdzkwsk.com/">KHL+</Link>
			</Text>
			<Text>
				A faster, friendlier front end for recreational hockey in
				Seattle.
			</Text>
		</>
	)
}

export default definePage({
	title: "Projects",
	layout: DefaultLayout,
	content: ProjectsPage,
})
