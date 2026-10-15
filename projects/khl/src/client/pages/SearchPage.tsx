import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import * as React from "react"
import {SEARCH_ENDPOINT} from "../../shared/ApiJson.js"
import {
	AsyncContent,
	PageShell,
	PageTitle,
	SearchIcon,
	SearchResults,
} from "../Components.js"
import {
	AppContext,
	getSearchHref,
	Route,
	RouteProps,
	useAsync,
} from "../Util.js"

// --- /search?q=: every player, team, and location matching a query

/** Shorter queries match too much to be useful; the header search agrees */
const MIN_QUERY_LENGTH = 2

const SearchPage = ({query}: RouteProps) => {
	const q = (query.get("q") ?? "").trim()
	return (
		<PageShell>
			{q && <PageTitle>{`“${q}”`}</PageTitle>}
			<div className="SearchPage">
				<h1 className="SearchPage-title">Search</h1>
				{/* Keyed so going back to an older query refills the input */}
				<SearchForm key={q} initial={q} />
				{q.length >= MIN_QUERY_LENGTH ? (
					<Results q={q} />
				) : (
					<p className="SearchPage-hint">
						Type at least {MIN_QUERY_LENGTH} letters of a player,
						team, rink, or city.
					</p>
				)}
			</div>
		</PageShell>
	)
}

const SearchForm = ({initial}: {initial: string}) => {
	const {history} = React.useContext(AppContext)
	const [input, setInput] = React.useState(initial)
	return (
		<form
			className="SearchPage-form"
			role="search"
			action="/search"
			onSubmit={(e) => {
				e.preventDefault()
				history.push(getSearchHref(input.trim()))
			}}
		>
			<SearchIcon className="SearchPage-icon" />
			<input
				className="SearchPage-input"
				name="q"
				type="search"
				enterKeyHint="search"
				aria-label="Search players, teams, and locations"
				placeholder="Search players, teams, and locations"
				value={input}
				onChange={(e) => setInput(e.target.value)}
				// Only when arriving without a query, so results aren't
				// covered by the keyboard
				autoFocus={!initial}
			/>
		</form>
	)
}

const Results = ({q}: {q: string}) => {
	const state = useAsync(() => doRequest(SEARCH_ENDPOINT, {q}), [q])
	return (
		<AsyncContent
			state={state}
			size="inline"
			loadingLabel="Searching…"
			errorTitle={`Couldn't search for “${q}”`}
		>
			{(response) => <SearchResults response={response} />}
		</AsyncContent>
	)
}

export const SearchRoute = {
	path: "/search",
	title: "Search",
	description: "Find KHL players, teams, and rinks.",
	content: SearchPage,
} as const satisfies Route
