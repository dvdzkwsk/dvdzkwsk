import * as React from "react"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {
	GET_MATCHUP_ENDPOINT,
	LIST_TEAM_SEASONS_ENDPOINT,
	LIST_TEAMS_ENDPOINT,
	MatchupResponse,
	MatchupTeam,
	TeamsResponse,
} from "../../shared/ApiJson.js"
import {KHLSeason, KHLTeam} from "../../shared/KHLJson.js"
import {
	AsyncContent,
	ErrorState,
	Hint,
	PageShell,
	PageTitle,
	Picker,
	RosterPanels,
	RosterTables,
	TeamAvatar,
} from "../Components.js"
import {Comparison} from "../Compare.js"
import {GameCards, HeadToHeadGames, TeamForm} from "../Games.js"
import {
	AppContext,
	AsyncState,
	getShortSeasonName,
	Route,
	RouteProps,
	useAsync,
	useNow,
} from "../Util.js"

/** Any two teams' seasons compared, like the league's game previews. */
const MatchupPage = ({query}: RouteProps) => {
	const {history} = React.useContext(AppContext)
	const params: MatchupParams = {
		a: query.get("a"),
		aSeason: query.get("aSeason"),
		b: query.get("b"),
		bSeason: query.get("bSeason"),
	}
	const {a, aSeason, b, bSeason} = params
	const teamsA = useTeams(aSeason)
	const teamsB = useTeams(bSeason)
	const teamA = findTeam(teamsA, a)
	const teamB = findTeam(teamsB, b)
	const seasonsA = useTeamSeasons(teamA)
	const seasonsB = useTeamSeasons(teamB)
	const isSamePick =
		teamA &&
		teamB &&
		teamA.id === teamB.id &&
		teamA.seasonId === teamB.seasonId
	const ready = teamA && teamB && !isSamePick
	const matchup = useAsync(
		() =>
			ready
				? doRequest(GET_MATCHUP_ENDPOINT, {
						a: teamA.id,
						b: teamB.id,
						aSeason: teamA.seasonId,
						bSeason: teamB.seasonId,
					})
				: Promise.resolve(null),
		[ready, teamA?.id, teamA?.seasonId, teamB?.id, teamB?.seasonId],
	)
	const now = useNow()
	const data = matchup.status === "success" ? matchup.data : null

	const setParams = (next: MatchupParams) => {
		const search = new URLSearchParams()
		for (const [key, value] of Object.entries(next)) {
			if (value) {
				search.set(key, value)
			}
		}
		const queryString = search.toString()
		// Picking teams isn't worth a back-button stop each
		history.replace(`/matchup${queryString ? `?${queryString}` : ""}`)
	}

	return (
		<PageShell>
			<div className="Detail">
				<PageTitle>
					{teamA && teamB
						? `${teamA.name} vs ${teamB.name}`
						: "Matchup"}
				</PageTitle>
				<header className={cx("Detail-header", "Matchup-header")}>
					<MatchupSide
						side="a"
						teams={teamsA}
						team={teamA}
						teamSeasons={seasonsA}
						other={teamB}
						stats={data?.a ?? null}
						onTeamChange={(id) => setParams({...params, a: id})}
						// Team ids carry over between seasons, so keep the pick
						onSeasonChange={(id) =>
							setParams({...params, aSeason: id})
						}
					/>
					<div className="Matchup-center">
						<span className="Matchup-vs">vs</span>
						<Hint label="Swap sides">
							<button
								type="button"
								className="Matchup-swap"
								aria-label="Swap sides"
								disabled={!a && !b && !aSeason && !bSeason}
								onClick={() =>
									setParams({
										a: b,
										aSeason: bSeason,
										b: a,
										bSeason: aSeason,
									})
								}
							>
								<SwapIcon />
							</button>
						</Hint>
					</div>
					<MatchupSide
						side="b"
						teams={teamsB}
						team={teamB}
						teamSeasons={seasonsB}
						other={teamA}
						stats={data?.b ?? null}
						onTeamChange={(id) => setParams({...params, b: id})}
						onSeasonChange={(id) =>
							setParams({...params, bSeason: id})
						}
					/>
				</header>
				{ready ? (
					<MatchupContent state={matchup} now={now} />
				) : (
					<MatchupEmpty />
				)}
			</div>
		</PageShell>
	)
}

interface MatchupParams {
	a: string | null
	aSeason: string | null
	b: string | null
	bSeason: string | null
}

/** A season's teams, for one side's pickers. Null means the current season. */
function useTeams(seasonId: string | null): AsyncState<TeamsResponse> {
	return useAsync(
		() => doRequest(LIST_TEAMS_ENDPOINT, {season: seasonId ?? undefined}),
		[seasonId],
	)
}

/**
 * The seasons `team` played, so its season picker only offers those. Null
 * without a team, or until they've loaded.
 */
function useTeamSeasons(team: KHLTeam | null): KHLSeason[] | null {
	const state = useAsync(
		() =>
			team
				? doRequest(LIST_TEAM_SEASONS_ENDPOINT, {
						teamId: team.id,
						season: team.seasonId,
					}).then((r) => r.seasons)
				: Promise.resolve(null),
		// A team's seasons are the same from any of them
		[team?.id],
	)
	return state.status === "success" ? state.data : null
}

function findTeam(
	teams: AsyncState<TeamsResponse>,
	teamId: string | null,
): KHLTeam | null {
	if (teams.status !== "success" || !teamId) {
		return null
	}
	return (
		teams.data.divisions
			.flatMap((d) => d.teams)
			.find((t) => t.id === teamId) ?? null
	)
}

const MatchupContent = ({
	state,
	now,
}: {
	state: AsyncState<MatchupResponse | null>
	now: Date
}) => {
	return (
		<AsyncContent
			state={state}
			loadingLabel="Loading matchup details…"
			errorTitle="Couldn't load this matchup"
		>
			{(matchup) => {
				if (!matchup) {
					return null
				}
				// Name each side's season when they differ
				const showSeasons = matchup.a.season.id !== matchup.b.season.id
				return (
					<>
						{matchup.upcoming.length > 0 && (
							<section>
								<h2
									className={cx(
										"SectionLabel",
										"Detail-section-title",
									)}
								>
									Next meeting
								</h2>
								<GameCards
									games={matchup.upcoming}
									seasonId={matchup.currentSeason.id}
									now={now}
									limit={1}
								/>
							</section>
						)}
						{/* The same sections as a game's preview */}
						<Comparison
							a={matchup.a}
							b={matchup.b}
							previewStats={matchup.previewStats}
						/>
						{matchup.a.team.id !== matchup.b.team.id && (
							<HeadToHeadGames
								left={matchup.a.team}
								right={matchup.b.team}
								games={matchup.headToHead}
								now={now}
							/>
						)}
						<RosterPanels
							teams={[matchup.a, matchup.b].map((side) => ({
								team: side.team,
								roster: side.roster,
								note: showSeasons
									? side.season.name
									: undefined,
								title: side.season.name,
							}))}
						/>
					</>
				)
			}}
		</AsyncContent>
	)
}

/** One side's season and team pickers, logo and record. */
const MatchupSide = ({
	side,
	teams,
	team,
	teamSeasons,
	other,
	stats,
	onTeamChange,
	onSeasonChange,
}: {
	/** Which color the side is keyed with in the comparison below */
	side: "a" | "b"
	teams: AsyncState<TeamsResponse>
	team: KHLTeam | null
	/** The seasons `team` played; null while loading or without a team */
	teamSeasons: KHLSeason[] | null
	/** The other side's pick, which can't be picked here too */
	other: KHLTeam | null
	stats: MatchupTeam | null
	onTeamChange: (teamId: string) => void
	onSeasonChange: (seasonId: string | null) => void
}) => {
	if (teams.status === "error") {
		return (
			<div className={cx("Matchup-side", `Matchup-side--${side}`)}>
				<ErrorState
					title="Couldn't load this season's teams"
					error={teams.error}
					onRetry={teams.reload}
					size="inline"
				/>
			</div>
		)
	}
	const data = teams.status === "success" ? teams.data : null
	return (
		<div className={cx("Matchup-side", `Matchup-side--${side}`)}>
			<span className="Matchup-label">
				<span className="Compare-key" aria-hidden />
				Team {side === "a" ? 1 : 2}
			</span>
			{team ? (
				<TeamAvatar name={team.name} logoUrl={team.logoUrl} size={72} />
			) : (
				<span className="Matchup-placeholder" aria-hidden>
					<ShieldIcon />
				</span>
			)}
			<TeamPicker
				teams={data}
				value={team}
				disabledId={
					other && other.seasonId === data?.season.id
						? other.id
						: null
				}
				onChange={onTeamChange}
			/>
			<SeasonPicker
				teams={data}
				// Before a team is picked, any season can be browsed for teams;
				// after, only the team's own seasons
				seasons={
					team ? (teamSeasons ?? (data ? [data.season] : null)) : null
				}
				onChange={(seasonId) =>
					// The current season is the default, so leave it out of the URL
					onSeasonChange(
						seasonId === data?.seasons[0]?.id ? null : seasonId,
					)
				}
			/>
			{/* As under a team in a game's header, minus the division: the
			    pickers above already say it */}
			{stats && <TeamForm form={stats} showDivision={false} />}
		</div>
	)
}

const SeasonPicker = ({
	teams,
	seasons,
	onChange,
}: {
	/** Null while loading */
	teams: TeamsResponse | null
	/** The seasons to offer; null for every league season */
	seasons: KHLSeason[] | null
	onChange: (seasonId: string) => void
}) => {
	return (
		<Picker
			groups={[
				{
					label: "",
					items: (seasons ?? teams?.seasons ?? []).map((s) => ({
						value: s.id,
						label: s.name,
					})),
				},
			]}
			value={teams?.season.id ?? null}
			onChange={onChange}
			triggerLabel={teams && getShortSeasonName(teams.season.name)}
			placeholder="Loading seasons…"
			disabled={!teams}
			className={cx("Matchup-picker", "Matchup-season")}
			title={teams?.season.name}
		/>
	)
}

/** Before both teams are picked: what the page will show once they are. */
const MatchupEmpty = () => {
	return (
		<section className="Matchup-empty">
			<h2 className="Matchup-empty-title">Compare any two teams</h2>
			<p className="Matchup-empty-text">
				Pick a team and season on each side.
			</p>
			<ul className="Matchup-features">
				<li className="Matchup-feature">
					<ChartIcon />
					<span>
						<span className="Matchup-feature-title">
							Season stats
						</span>
						Record and recent form, then goals, special teams and
						shots, side by side.
					</span>
				</li>
				<li className="Matchup-feature">
					<SwapIcon />
					<span>
						<span className="Matchup-feature-title">
							Head-to-head
						</span>
						Every meeting between the two teams, across seasons.
					</span>
				</li>
				<li className="Matchup-feature">
					<PlayersIcon />
					<span>
						<span className="Matchup-feature-title">Rosters</span>
						Each team's players and goalies, by points.
					</span>
				</li>
			</ul>
			<p className="Matchup-tip">
				Tip: pick the same team on both sides to compare two of its
				seasons.
			</p>
		</section>
	)
}

const ICON_PROPS = {
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.75,
	strokeLinecap: "round",
	strokeLinejoin: "round",
	"aria-hidden": true,
} as const

const SwapIcon = () => {
	return (
		<svg {...ICON_PROPS}>
			<path d="M7 4 3 8l4 4" />
			<path d="M3 8h14" />
			<path d="m17 20 4-4-4-4" />
			<path d="M21 16H7" />
		</svg>
	)
}

const ShieldIcon = () => {
	return (
		<svg {...ICON_PROPS}>
			<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z" />
		</svg>
	)
}

const ChartIcon = () => {
	return (
		<svg {...ICON_PROPS}>
			<path d="M4 20V10" />
			<path d="M10 20V4" />
			<path d="M16 20v-7" />
			<path d="M22 20H2" />
		</svg>
	)
}

const PlayersIcon = () => {
	return (
		<svg {...ICON_PROPS}>
			<circle cx="9" cy="8" r="3.5" />
			<path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5" />
			<path d="M16 4.7a3.5 3.5 0 0 1 0 6.6" />
			<path d="M18.5 14.8c1.6.8 2.6 2.6 3 5.2" />
		</svg>
	)
}

const TeamPicker = ({
	teams,
	value,
	disabledId,
	onChange,
}: {
	/** Null while loading */
	teams: TeamsResponse | null
	value: KHLTeam | null
	disabledId: string | null
	onChange: (teamId: string) => void
}) => {
	return (
		<Picker
			groups={(teams?.divisions ?? []).map((division) => ({
				label: division.name,
				items: division.teams.map((t) => ({
					value: t.id,
					label: t.name,
					icon: (
						<TeamAvatar
							name={t.name}
							logoUrl={t.logoUrl}
							size={22}
						/>
					),
					disabled: t.id === disabledId,
				})),
			}))}
			value={value?.id ?? null}
			onChange={onChange}
			placeholder={teams ? "Choose a team" : "Loading teams…"}
			disabled={!teams}
			className="Matchup-picker"
		/>
	)
}

export const MatchupRoute = {
	path: "/matchup",
	title: "Matchup",
	content: MatchupPage,
} as const satisfies Route
