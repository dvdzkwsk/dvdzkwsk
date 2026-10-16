import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import * as React from "react"
import {LIST_GAMES_ENDPOINT, LIST_RINKS_ENDPOINT} from "../../shared/ApiJson.js"
import {AsyncContent, PageShell} from "../Components.js"
import {
	filterScheduledGames,
	GameCards,
	GameFilters,
	GameFilterValues,
	GameList,
	getPastDays,
	getScheduledGames,
	includesUpcomingDays,
	NoGames,
	readGameFilters,
	writeGameFilters,
} from "../Games.js"
import {AppContext, Route, RouteProps, useAsync, useNow} from "../Util.js"

/**
 * Every upcoming game in the league, filterable by day, rink, and division.
 * Past days (or a range reaching into the past) show their results too.
 */
const HomePage = ({query}: RouteProps) => {
	const {history} = React.useContext(AppContext)
	const state = useAsync(() => doRequest(LIST_RINKS_ENDPOINT, {}), [])
	const now = useNow()
	const filters = readGameFilters(query)
	const pastDays = getPastDays(filters.day, now)
	// The past days are consecutive, so one range request covers them
	const pastFrom = pastDays[0]
	const pastTo = pastDays[pastDays.length - 1]
	const pastState = useAsync(async () => {
		if (!pastFrom || !pastTo) {
			return []
		}
		const response = await doRequest(LIST_GAMES_ENDPOINT, {
			from: pastFrom,
			to: pastTo,
		})
		return response.games
	}, [pastFrom, pastTo])
	const hasPast = pastDays.length > 0
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
				<AsyncContent
					state={state}
					loadingLabel="Loading the schedule…"
				>
					{({rinks, season}) => {
						const pastGames =
							pastState.status === "success" ? pastState.data : []
						const upcoming = getScheduledGames(rinks, now)
						const games = [
							...pastGames,
							...(includesUpcomingDays(filters.day, now)
								? upcoming
								: []),
						]
						const {forDay, visible} = filterScheduledGames(
							games,
							filters,
							now,
						)
						const noGames = (
							<NoGames
								filters={filters}
								forDay={forDay}
								upcoming={upcoming}
								now={now}
								onChange={setFilters}
							/>
						)
						return (
							<>
								<GameFilters
									filters={filters}
									onChange={setFilters}
									games={games}
									gamesForDay={forDay}
									now={now}
								/>
								{hasPast ? (
									<AsyncContent
										state={pastState}
										loadingLabel="Loading past games…"
										errorTitle="Couldn't load those days' games"
									>
										{() => (
											<GameList
												games={visible}
												seasonId={season.id}
												now={now}
												empty={noGames}
											/>
										)}
									</AsyncContent>
								) : (
									<>
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
											empty={noGames}
										/>
									</>
								)}
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

/** The home page's schedule, at its own URL for the nav */
export const GamesRoute = {
	path: "/games",
	title: "Games",
	content: HomePage,
} as const satisfies Route
