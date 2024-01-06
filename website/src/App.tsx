import {Box} from "./Primitives.js"

const GUITAR_LOG = [
	{
		artist: "The National",
		title: "About Today",
	},

	{
		artist: "Noah Kahan",
		title: "Stick Season",
	},

	{
		artist: "Radiohead",
		title: "Karma Police",
	},

	{
		artist: "Radiohead",
		title: "Fake Plastic Trees",
	},
]

const READING_LOG = [
	{
		author: "Liu Cixin",
		title: "The Three-Body Problem",
	},
	{
		author: "Robert Mason",
		title: "Chickenhawk",
	},
	{
		author: "Philip K. Dick",
		title: "Do Androids Dream of Electric Sheep?",
	},
	{
		author: "Ben Rich and Leo Janos",
		title: "Skunk Works",
	},
	{
		author: "David Kushner",
		title: "Masters of Doom",
	},
	{
		author: "Micahel Durant",
		title: "In the Company of Heroes",
	},
]

const MOVIE_LOG = [
	{
		director: "Takashi Yamazaki",
		title: "Godzilla Minus One",
	},
	{
		director: "Christopher Nolan",
		title: "Interstellar",
	},
]

export const App = () => {
	return (
		<main className="app">
			<Box flex gap={16}>
				<section style={{flex: "1 0"}}>
					<h3>Recent Stuff</h3>
					<ol>
						{GUITAR_LOG.map((item) => {
							return (
								<ListItem
									key={item.title}
									text={`Learned "${item.title}"`}
									subtext={`by ${item.artist}`}
								/>
							)
						})}
						{READING_LOG.map((item) => {
							return (
								<ListItem
									key={item.title}
									text={`Read "${item.title}"`}
									subtext={`by ${item.author}`}
								/>
							)
						})}
						{MOVIE_LOG.map((item) => {
							return (
								<ListItem
									key={item.title}
									text={`Watched "${item.title}"`}
									subtext={`by ${item.director}`}
								/>
							)
						})}
					</ol>
				</section>
			</Box>
		</main>
	)
}

const ListItem = ({text, subtext}: {text: string; subtext: string}) => {
	return (
		<li className="li-with-drop">
			{text}
			<span className="drop">{subtext}</span>
		</li>
	)
}
