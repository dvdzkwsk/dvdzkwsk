import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {GET_RINK_ENDPOINT} from "../../shared/ApiJson.js"
import {
	AsyncContent,
	Hint,
	Link,
	LIVEBARN_TITLES,
	LiveBarnBadge,
	Notice,
	NotOnLiveBarn,
	PageShell,
	PageTitle,
} from "../Components.js"
import {
	GameSummary,
	GameTableCard,
	getRinkStatus,
	toGameTableRow,
	toReplayLinks,
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
			<AsyncContent
				state={state}
				loadingLabel="Loading location details…"
			>
				{({rink, address, season, recent}) => {
					const status = getRinkStatus(rink, now)
					return (
						<div className="RinkRoute">
							<PageTitle>{rink.name}</PageTitle>
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
													title={LIVEBARN_TITLES.live(
														surface.surfaceName,
													)}
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

							{rink.livebarn.length === 0 && (
								<Notice title="LiveBarn doesn't have a feed for this rink" />
							)}

							<GameTableCard
								title="Upcoming games"
								count={rink.games.length}
								emptyText="No games scheduled."
								// About five games, then they scroll inside the card
								maxHeight="20rem"
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

							{recent.length > 0 && (
								<GameTableCard
									title="Recent games"
									emptyText="No games played yet."
									rows={recent.map(({game, livebarn}) => ({
										...toGameTableRow(
											{rink, game},
											season.id,
											now,
										),
										// Finished: replays instead of the live feed
										livebarn: toReplayLinks(livebarn),
									}))}
									now={now}
									showDay
									showRink={false}
								/>
							)}
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
	title: "Location",
	content: RinkPage,
} as const satisfies Route
