import {Flex} from "./Layout.js"

export const App = () => {
	return (
		<main>
			<Flex gap={16}>
				<RecentlyLearnedGuitarSongs />
				<RecentlyRead />
			</Flex>
		</main>
	)
}

const RecentlyLearnedGuitarSongs = () => {
	return (
		<ol>
			<LearnedSong artist="The National" title="About Today" />
			<LearnedSong artist="Noah Kahan" title="Stick Season" />
			<LearnedSong artist="Radiohead" title="Karma Police" />
			<LearnedSong artist="Radiohead" title="Fake Plastic Trees" />
		</ol>
	)
}

const LearnedSong = ({artist, title}: {artist: string; title: string}) => {
	return (
		<li>
			{artist} - {title}
		</li>
	)
}

const RecentlyRead = () => {
	return (
		<ol>
			<Book title="The Three-Body Problem" />
			<Book title="Chickenhawk" />
			<Book title="Do Androids Dream of Electric Sheep?" />
			<Book title="Skunk Works" />
			<Book title="Masters of Doom" />
			<Book title="In the Company of Heroes" />
		</ol>
	)
}

const Book = ({title}: {title: string}) => {
	return <li>{title}</li>
}
