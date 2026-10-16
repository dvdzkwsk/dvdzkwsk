import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {SEARCH_ENDPOINT} from "../../shared/ApiJson.js"
import {
	AsyncContent,
	PageShell,
	PageTitle,
	SearchResults,
} from "../Components.js"
import {Route, RouteProps, useAsync} from "../Util.js"

// --- /search?q=: every player, team, and location matching a query

/** Shorter queries match too much to be useful; the header search agrees */
const MIN_QUERY_LENGTH = 2

const SearchPage = ({query}: RouteProps) => {
	const q = (query.get("q") ?? "").trim()
	return (
		<PageShell>
			{q && <PageTitle>{`“${q}”`}</PageTitle>}
			<div className="SearchPage">
				{/* Searched from the header, which keeps the query to refine */}
				<header className="SearchPage-header">
					<h1 className="SearchPage-title">Search Results</h1>
					{q && <p className="SearchPage-query">for “{q}”</p>}
				</header>
				{q.length >= MIN_QUERY_LENGTH ? (
					<Results q={q} />
				) : (
					<p className="SearchPage-hint">
						Search above for at least {MIN_QUERY_LENGTH} letters of
						a player, team, rink, or city.
					</p>
				)}
			</div>
		</PageShell>
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
