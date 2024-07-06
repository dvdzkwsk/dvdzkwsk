import {Link} from "../Router.js"
import {PageLayout} from "../components/PageLayout.js"
import {parseDateString} from "../lib/DateUtil.js"
import {Text} from "../lib/TextUtil.js"

const READING_LOG_CSV = `
date,title,author,completed
2024-06-02,What I Talk About When I Talk About Running,Haruki Murakami,y
2024-06-01,1Q84,Haruki Murakami,n
2024-01-23,A Scanner Darkly,Philip K. Dick,y
2023-12-26,The Three Body Problem,Liu Cixin,n
2023-12-15,Chickenhawk,Robert Mason,y
`

const READING_LOG = READING_LOG_CSV.split("\n")
	.filter((text) => text.trim())
	.slice(1)
	.map((text) => {
		const parts = text.split(",")
		return {
			date: parseDateString(parts[0]),
			title: parts[1],
			author: parts[2],
			completed: parts[3] === "y",
		}
	})

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
				2024 Reading List
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
