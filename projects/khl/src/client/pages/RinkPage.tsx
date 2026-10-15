import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {Helmet} from "react-helmet"
import {GET_RINK_ENDPOINT, RinkGame} from "../../shared/ApiJson.js"
import {STRINGS} from "../../shared/KHLConfig.js"
import {
	AsyncContent,
	HomeAwayBadge,
	Link,
	LiveBarnBadge,
	NotOnLiveBarn,
	PageShell,
	StatsTable,
	TeamLink,
} from "../Components.js"
import {GameSummary, getDivisionLabel, getRinkStatus} from "../Games.js"
import {
	formatGameDay,
	formatGameTime,
	Route,
	RouteProps,
	useAsync,
	useNow,
} from "../Util.js"

// --- /rinks/:arenaId: one rink and its upcoming games

const RinkPage = ({params}: RouteProps) => {
	const arenaId = params.arenaId!
	const state = useAsync(
		() => doRequest(GET_RINK_ENDPOINT, {arenaId}),
		[arenaId],
	)
	const now = useNow()

	return (
		<PageShell>
			<AsyncContent state={state}>
				{({rink, address, season}) => {
					const status = getRinkStatus(rink, now)
					return (
						<div className="RinkRoute">
							<Helmet>
								<title>
									{rink.name} | {STRINGS.PRODUCT_NAME}
								</title>
							</Helmet>
							<section
								className={cx(
									"RinkRoute-panel",
									"RinkRoute-hero",
								)}
							>
								<div className="RinkRoute-info">
									<h1 className="RinkRoute-name">
										{rink.name}
									</h1>
									{address && (
										<address className="RinkRoute-address">
											<Link
												className="RinkRoute-address-link"
												href={getDirectionsUrl(address)}
												title="Open in Google Maps"
											>
												{address} ↗
											</Link>
										</address>
									)}
									<div className="RinkRoute-livebarn">
										{rink.livebarn.length > 0 ? (
											rink.livebarn.map((surface) => (
												<LiveBarnBadge
													key={surface.surfaceId}
													href={surface.liveUrl}
													surfaceName={
														rink.livebarn.length > 1
															? surface.surfaceName
															: undefined
													}
													title={`Watch ${surface.surfaceName} live on LiveBarn`}
												/>
											))
										) : (
											<NotOnLiveBarn />
										)}
									</div>
								</div>
								<div
									className={cx(
										"RinkRoute-status",
										status.live && "RinkRoute-status--live",
									)}
								>
									<h2 className="SectionLabel">
										{status.live
											? "Playing now"
											: "Up next"}
									</h2>
									{status.live || status.next ? (
										<GameSummary
											rink={rink}
											game={(status.live ?? status.next)!}
											seasonId={season.id}
											now={now}
										/>
									) : (
										<p className="RinkRoute-empty">
											No games scheduled.
										</p>
									)}
								</div>
							</section>

							<section className="RinkRoute-panel">
								<h2 className="RinkRoute-section-title SectionLabel">
									Upcoming games
								</h2>
								{rink.games.length === 0 ? (
									<p className="RinkRoute-empty">
										No games scheduled.
									</p>
								) : (
									<StatsTable<RinkGame>
										rows={rink.games}
										rowKey={(game) => game.gameId}
										rowClassName={(game) =>
											game === status.live
												? "RinkRoute-live-row"
												: undefined
										}
										columns={[
											{
												header: "Day",
												isLabel: true,
												render: (game) =>
													formatGameDay(
														game.startsAt,
														now,
													),
											},
											{
												header: "Time",
												isLabel: true,
												render: (game) =>
													formatGameTime(
														game.startsAt,
													),
											},
											{
												header: "Matchup",
												isLabel: true,
												render: (game) => (
													<span className="RinkRoute-matchup">
														<HomeAwayBadge
															homeAway="away"
															truncated
														/>
														<TeamLink
															team={game.awayTeam}
															seasonId={season.id}
														/>
														<span className="RinkRoute-at">
															@
														</span>
														<HomeAwayBadge
															homeAway="home"
															truncated
														/>
														<TeamLink
															team={game.homeTeam}
															seasonId={season.id}
														/>
													</span>
												),
											},
											{
												header: "Division",
												isLabel: true,
												render: getDivisionLabel,
											},
										]}
									/>
								)}
							</section>
						</div>
					)
				}}
			</AsyncContent>
		</PageShell>
	)
}

/** Google Maps search for an address; opens directions on phones. */
function getDirectionsUrl(address: string): string {
	return `https://www.google.com/maps/search/?api=1&${new URLSearchParams({query: address})}`
}

export const RinkRoute = {
	path: "/rinks/:arenaId",
	title: "Rink",
	content: RinkPage,
} as const satisfies Route
