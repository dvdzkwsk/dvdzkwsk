import * as React from "react"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {
	GET_STANDINGS_ENDPOINT,
	LIST_TEAMS_ENDPOINT,
	StandingsResponse,
} from "../../shared/ApiJson.js"
import {KHLStandingsRow, KHLTeam} from "../../shared/KHLJson.js"
import {
	AsyncContent,
	FilterBar,
	Link,
	PageShell,
	SeasonFilter,
	TeamAvatar,
} from "../Components.js"
import {DivisionFilter, sortByDivision} from "../Games.js"
import {
	getTeamHref,
	getVisibleDivisions,
	Route,
	RouteProps,
	useAsync,
	useSeasonFilters,
} from "../Util.js"

/** Every team in a season, by division, filterable by season and division. */
const TeamsPage = ({query}: RouteProps) => {
	const [filters, setFilters] = useSeasonFilters(query)
	const state = useAsync(
		() =>
			Promise.all([
				doRequest(LIST_TEAMS_ENDPOINT, {
					season: filters.season ?? undefined,
				}),
				// Records are a nice-to-have; list the teams without them
				doRequest(GET_STANDINGS_ENDPOINT, {
					season: filters.season ?? undefined,
				}).catch(() => null),
			]),
		[filters.season],
	)

	return (
		<PageShell>
			<div className="HomePage">
				<AsyncContent state={state}>
					{([teams, standings]) => {
						const names = teams.divisions.map((d) => d.name)
						const visible = getVisibleDivisions(
							names,
							filters.divisions,
						)
						const records = getRecords(standings)
						return (
							<>
								<FilterBar>
									<SeasonFilter
										seasons={teams.seasons}
										value={teams.season.id}
										onChange={(season) =>
											setFilters({season})
										}
									/>
									<DivisionFilter
										divisions={names}
										selected={filters.divisions}
										onChange={(divisions) =>
											setFilters({divisions})
										}
									/>
								</FilterBar>
								{teams.divisions.length === 0 && (
									<div className="GameList-empty">
										No teams in {teams.season.name}.
									</div>
								)}
								{sortByDivision(teams.divisions, (d) => d.name)
									.filter((d) => visible.has(d.name))
									.map((division) => (
										<section key={division.name}>
											<h2
												className={cx(
													"SectionLabel",
													"HomePage-section-title",
												)}
											>
												{division.name} ·{" "}
												{division.teams.length}{" "}
												{division.teams.length === 1
													? "team"
													: "teams"}
											</h2>
											<ul className="TeamsGrid">
												{division.teams.map((team) => (
													<TeamCard
														key={team.id}
														team={team}
														// Teams without a row haven't played
														record={
															records
																? (records.get(
																		team.id,
																	) ?? null)
																: undefined
														}
													/>
												))}
											</ul>
										</section>
									))}
							</>
						)
					}}
				</AsyncContent>
			</div>
		</PageShell>
	)
}

/** Standings rows by team id; null if the standings didn't load */
function getRecords(
	standings: StandingsResponse | null,
): Map<string, KHLStandingsRow> | null {
	if (!standings) {
		return null
	}
	const rows = standings.divisions.flatMap((d) => d.rows)
	return new Map(rows.map((row) => [row.teamId, row]))
}

const TeamCard = ({
	team,
	record,
}: {
	team: KHLTeam
	/** Null if the team hasn't played; undefined if records didn't load */
	record: KHLStandingsRow | null | undefined
}) => {
	const stat = (column: string) => record?.stats[column] ?? "0"
	const played = Number(stat("GP")) > 0
	return (
		<li>
			<Link className="TeamCard" href={getTeamHref(team)}>
				<TeamAvatar name={team.name} logoUrl={team.logoUrl} size={40} />
				<span className="TeamCard-body">
					<span className="TeamCard-name">{team.name}</span>
					{record !== undefined && (
						<span className="TeamCard-record">
							{played ? (
								<>
									{stat("W")}-{stat("L")}-{stat("T")}
									<span className="Detail-meta-hint">
										{" "}
										W-L-T
									</span>
									{" · "}
									{stat("PTS")}
									<span className="Detail-meta-hint">
										{" "}
										PTS
									</span>
								</>
							) : (
								"No games yet"
							)}
						</span>
					)}
				</span>
			</Link>
		</li>
	)
}

export const TeamsRoute = {
	path: "/teams",
	title: "Teams",
	content: TeamsPage,
} as const satisfies Route
