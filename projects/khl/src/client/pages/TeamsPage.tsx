import * as React from "react"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {GET_STANDINGS_ENDPOINT} from "../../shared/ApiJson.js"
import {KHLStandingsDivision, KHLStandingsRow} from "../../shared/KHLJson.js"
import {
	AsyncContent,
	PageShell,
	SeasonFilter,
	StatsTable,
	StatsTableColumn,
	TeamAvatar,
	TeamLink,
} from "../Components.js"
import {DivisionMenu, sortByDivision} from "../Games.js"
import {
	getVisibleDivisions,
	Route,
	RouteProps,
	useAsync,
	useSeasonFilters,
} from "../Util.js"

/** Every division's standings, filterable by season and division. */
const TeamsPage = ({query}: RouteProps) => {
	const [filters, setFilters] = useSeasonFilters(query)
	const state = useAsync(
		() =>
			doRequest(GET_STANDINGS_ENDPOINT, {
				season: filters.season ?? undefined,
			}),
		[filters.season],
	)

	return (
		<PageShell>
			<div className="HomePage">
				<AsyncContent state={state} loadingLabel="Loading standings…">
					{(standings) => {
						const names = standings.divisions.map((d) => d.name)
						const visible = getVisibleDivisions(
							names,
							filters.divisions,
						)
						return (
							<>
								<div className="FilterToolbar">
									<span className="FilterToolbar-spacer" />
									<DivisionMenu
										divisions={names}
										selected={filters.divisions}
										onChange={(divisions) =>
											setFilters({divisions})
										}
									/>
									<SeasonFilter
										seasons={standings.seasons}
										value={standings.season.id}
										onChange={(season) =>
											setFilters({season})
										}
									/>
								</div>
								{standings.divisions.length === 0 && (
									<div className="GameList-empty">
										No standings for {standings.season.name}
										.
									</div>
								)}
								{sortByDivision(
									standings.divisions,
									(d) => d.name,
								)
									.filter((d) => visible.has(d.name))
									.map((division) => (
										<DivisionStandings
											key={division.name}
											division={division}
											seasonId={standings.season.id}
										/>
									))}
							</>
						)
					}}
				</AsyncContent>
			</div>
		</PageShell>
	)
}

/** Tooltips for the league's column abbreviations */
const COLUMN_TITLES: Record<string, string> = {
	GP: "Games played",
	W: "Wins",
	L: "Losses",
	T: "Ties",
	OTL: "Overtime losses",
	PTS: "Points",
	"PTS%": "Points percentage",
	GF: "Goals for",
	GFA: "Goals for per game",
	GA: "Goals against",
	GAA: "Goals against per game",
	PIM: "Penalty minutes",
}

interface RankedRow {
	rank: number
	row: KHLStandingsRow
}

const DivisionStandings = ({
	division,
	seasonId,
}: {
	division: KHLStandingsDivision
	seasonId: string
}) => {
	const columns: StatsTableColumn<RankedRow>[] = [
		{
			header: "Team",
			isLabel: true,
			// The cell leads with the rank; sort by the name
			sortValue: ({row}) => row.teamName.toLowerCase(),
			render: ({rank, row}) => (
				<span className="Standings-team">
					<span className="Standings-rank">{rank}</span>
					<TeamAvatar
						name={row.teamName}
						logoUrl={row.logoUrl}
						size={24}
					/>
					<TeamLink
						className="Standings-team-name"
						team={{id: row.teamId, name: row.teamName}}
						seasonId={seasonId}
					/>
				</span>
			),
		},
		...division.columns.map((column): StatsTableColumn<RankedRow> => ({
			header: column,
			title: COLUMN_TITLES[column],
			render: ({row}) =>
				column === "PTS" ? (
					<strong>{row.stats[column]}</strong>
				) : (
					row.stats[column]
				),
		})),
	]
	return (
		<section className="Detail-panel">
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				{division.name}
			</h2>
			<div className="Standings-table">
				<StatsTable
					columns={columns}
					// Listed by rank
					rows={division.rows.map((row, i) => ({rank: i + 1, row}))}
					rowKey={({row}) => row.teamId}
				/>
			</div>
		</section>
	)
}

export const TeamsRoute = {
	path: "/teams",
	title: "Teams",
	content: TeamsPage,
} as const satisfies Route
