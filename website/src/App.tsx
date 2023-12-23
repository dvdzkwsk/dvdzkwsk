import {Box} from "./Primitives.js"

export const App = () => {
	return (
		<main className="app">
			<Box gap={16}>
				<h2>Recently Learned on Guitar</h2>
				<RecentGuitarSongs />
				<h2>Recently Read</h2>
				<RecentBooks />
				<h2>Recently Watched</h2>
				<RecentMovies />
			</Box>
		</main>
	)
}

const RecentGuitarSongs = () => {
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

const RecentBooks = () => {
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

const RecentMovies = () => {
	return (
		<ol>
			<Movie title="Godzilla Minus One" />
			<Movie title="Interstellar" />
		</ol>
	)
}

const Movie = ({title}: {title: string}) => {
	return <li>{title}</li>
}
