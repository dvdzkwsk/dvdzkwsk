import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {Helmet} from "react-helmet"
import {GET_RINK_ENDPOINT} from "../../shared/ApiJson.js"
import {STRINGS} from "../../shared/KHLConfig.js"
import {
	AsyncContent,
	Hint,
	Link,
	LiveBarnBadge,
	NotOnLiveBarn,
	PageShell,
} from "../Components.js"
import {
	GameSummary,
	GameTable,
	getRinkStatus,
	toGameTableRow,
} from "../Games.js"
import {Route, RouteProps, useAsync, useNow} from "../Util.js"

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
			<AsyncContent state={state} loadingLabel="Loading rink details…">
				{({rink, address, season, recent}) => {
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
											<Hint label="Open in Google Maps">
												<Link
													className="RinkRoute-address-link"
													href={getDirectionsUrl(
														address,
													)}
												>
													{address} ↗
												</Link>
											</Hint>
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

							{recent.length > 0 && (
								<section className="RinkRoute-panel">
									<h2 className="RinkRoute-section-title SectionLabel">
										Recent games
									</h2>
									<GameTable
										rows={recent.map(
											({game, livebarn}) => ({
												...toGameTableRow(
													{rink, game},
													season.id,
													now,
												),
												// Finished: replays instead of the live feed
												livebarn: livebarn.map(
													(link) => ({
														surfaceId:
															link.surfaceId,
														href: link.vodUrl,
														title: `Watch the replay on LiveBarn (${link.surfaceName})`,
													}),
												),
											}),
										)}
										now={now}
										showDay
										showRink={false}
									/>
								</section>
							)}

							<section className="RinkRoute-panel">
								<h2 className="RinkRoute-section-title SectionLabel">
									Upcoming games
								</h2>
								{rink.games.length === 0 ? (
									<p className="RinkRoute-empty">
										No games scheduled.
									</p>
								) : (
									<GameTable
										rows={rink.games.map((game) =>
											toGameTableRow(
												{rink, game},
												season.id,
												now,
											),
										)}
										now={now}
										showDay
										showRink={false}
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
