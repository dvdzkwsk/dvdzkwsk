import * as React from "react"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {LIST_RINKS_ENDPOINT} from "../../shared/ApiJson.js"
import {AsyncContent, PageShell} from "../Components.js"
import {
	filterScheduledGames,
	GameCards,
	GameFilters,
	GameFilterValues,
	GameList,
	getScheduledGames,
	readGameFilters,
	writeGameFilters,
} from "../Games.js"
import {AppContext, Route, RouteProps, useAsync, useNow} from "../Util.js"

/** Every upcoming game in the league, filterable by day, rink and division. */
const HomePage = ({query}: RouteProps) => {
	const {history} = React.useContext(AppContext)
	const state = useAsync(() => doRequest(LIST_RINKS_ENDPOINT, {}), [])
	const now = useNow()
	const filters = readGameFilters(query)
	const setFilters = (changes: Partial<GameFilterValues>) => {
		// Replace rather than push: filter tweaks shouldn't fill up history
		history.replace({
			pathname: history.location.pathname,
			search: writeGameFilters({...filters, ...changes}),
		})
	}

	return (
		<PageShell>
			<div className="HomePage">
				<AsyncContent state={state}>
					{({rinks, season}) => {
						const games = getScheduledGames(rinks, now)
						const {forDay, visible} = filterScheduledGames(
							games,
							filters,
							now,
						)
						return (
							<>
								<GameFilters
									filters={filters}
									onChange={setFilters}
									games={games}
									gamesForDay={forDay}
								/>
								{/* The next few matching games, as cards. Hidden when nothing
								    matches; the list below says so. */}
								{visible.length > 0 && (
									<section>
										<h2
											className={cx(
												"SectionLabel",
												"HomePage-section-title",
											)}
										>
											Up next
										</h2>
										<GameCards
											games={visible}
											seasonId={season.id}
											now={now}
											limit={3}
										/>
									</section>
								)}
								<GameList
									games={visible}
									seasonId={season.id}
									now={now}
								/>
							</>
						)
					}}
				</AsyncContent>
			</div>
		</PageShell>
	)
}

export const HomeRoute = {
	path: "/",
	title: "Home",
	content: HomePage,
} as const satisfies Route
