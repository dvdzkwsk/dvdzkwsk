import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {matchField} from "@dvdzkwsk/util/MatchUtil"
import * as React from "react"
import {LIST_GAMES_ENDPOINT, LIST_RINKS_ENDPOINT} from "../../shared/ApiJson.js"
import {getLeagueDayKey} from "../../shared/LeagueTime.js"
import {AsyncContent, PageShell, Section} from "../Components.js"
import {
	countEndedToday,
	filterScheduledGames,
	GameCards,
	GameFilters,
	GameFilterValues,
	GameList,
	getPastDays,
	getScheduledGames,
	getTodayAndUpcomingGames,
	includesToday,
	includesUpcomingDays,
	NoGames,
	readGameFilters,
	ScheduledGame,
	writeGameFilters,
} from "../Games.js"
import {AppContext, Route, RouteProps, useAsync, useNow} from "../Util.js"

/**
 * Today's and upcoming games in the league, filterable by day, rink, and
 * division. Today's finished games and past days (or a range reaching into
 * the past) show their results too.
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
	// The schedule drops today's games once they're final, so today's come
	// from the scoreboard too. Refetch as each one ends to pick up its score.
	const today = includesToday(filters.day, now) ? getLeagueDayKey(now) : null
	const endedToday = matchField(state, "status", {
		loading: () => 0,
		error: () => 0,
		success: (s) => countEndedToday(s.data.rinks, now),
	})
	const todayState = useAsync(async () => {
		if (!today) {
			return []
		}
		const response = await doRequest(LIST_GAMES_ENDPOINT, {from: today})
		return response.games
	}, [today, endedToday])
	// Keep showing the last scoreboard while a refetch loads
	const todayGames = React.useRef<ScheduledGame[]>([])
	matchField(todayState, "status", {
		loading: () => {},
		error: () => {},
		success: (s) => {
			todayGames.current = s.data
		},
	})
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
						const pastGames = matchField(pastState, "status", {
							loading: () => [],
							error: () => [],
							success: (s) => s.data,
						})
						const upcoming = getScheduledGames(rinks, now)
						const games = [
							...pastGames,
							...(includesUpcomingDays(filters.day, now)
								? getTodayAndUpcomingGames(
										rinks,
										today ? todayGames.current : [],
									)
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
											<Section title="Up next">
												<GameCards
													games={visible}
													seasonId={season.id}
													now={now}
													limit={3}
													showHeadToHead
												/>
											</Section>
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
