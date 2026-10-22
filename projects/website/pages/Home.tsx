import * as React from "react"
import {Text} from "../components/Text.js"
import {DefaultLayout} from "../layouts/DefaultLayout.js"
import {Link, definePage} from "../RouterJson.js"

const HomePage: React.FC = () => {
	return (
		<>
			<Text>
				Hey! I'm David Zukowski, a software engineer living in
				Washington state.
			</Text>
			<Text>
				I lead an engineering team in{" "}
				<Link href="https://microsoft.com">Microsoft</Link>'s AI
				Experiences division. We build tools and systems that support
				internal design and engineering teams.
			</Text>
			<Text>
				Before that, I was an early member of the platform team at{" "}
				<Link href="https://material.security/">Material Security</Link>
				. Material introduced a novel approach to email security, and
				today their platform is used by companies including OpenAI,
				Anthropic, and more.
			</Text>
			<Text>
				Outside of work, I play hockey and tennis, and mountain bike
				whenever I can. I'm a proud dad to the most adorable corgi in
				the world, Kona. And once upon a time I flew airplanes for fun.
			</Text>
		</>
	)
}

export default definePage({
	title: "Home",
	layout: DefaultLayout,
	content: HomePage,
})
