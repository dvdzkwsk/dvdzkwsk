import * as React from "react"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {
	GET_TEAM_ENDPOINT,
	RosterPlayer,
	TeamResponse,
} from "../../shared/ApiJson.js"
import {getGoalsByTeam} from "../../shared/KHLJson.js"
import {
	AsyncContent,
	Link,
	PageShell,
	PageTitle,
	Picker,
	SegmentedControl,
	RosterTables,
	TeamAvatar,
} from "../Components.js"
import {GameCards, HeroLastResults, HeroStatGroup, PastGames} from "../Games.js"
import {
	AppContext,
	getPlayerHref,
	getTeamHref,
	Route,
	RouteProps,
	useAsync,
	useNow,
} from "../Util.js"

const TeamPage = ({params, query}: RouteProps) => {
	const teamId = params.teamId!
	const seasonId = query.get("season") ?? undefined
	const state = useAsync(
		() => doRequest(GET_TEAM_ENDPOINT, {teamId, season: seasonId}),
		[teamId, seasonId],
	)
	const now = useNow()

	return (
		<PageShell>
			<AsyncContent state={state} loadingLabel="Loading team details…">
				{(team) => (
					<div className="Detail">
						<PageTitle>{team.team.name}</PageTitle>
						<div className="Detail-toolbar">
							<SeasonPicker team={team} />
						</div>
						<TeamHeader team={team} />
						<section>
							<h2
								className={cx(
									"SectionLabel",
									"Detail-section-title",
								)}
							>
								Upcoming games
							</h2>
							<GameCards
								games={team.upcoming}
								seasonId={team.season.id}
								now={now}
								emptyMessage={`No upcoming games in ${team.season.name}.`}
							/>
						</section>
						<PastGames
							games={team.games}
							now={now}
							getTeamLogoUrl={() => team.team.logoUrl}
						/>
						{/* Leaders beside the roster on wide screens, above it on narrow */}
						<div className="TeamPage-people">
							<TeamLeaders roster={team.roster} />
							<Roster team={team} />
						</div>
					</div>
				)}
			</AsyncContent>
		</PageShell>
	)
}

const TeamHeader = ({team}: {team: TeamResponse}) => {
	const finals = team.games.filter((g) => g.game.isFinal && g.game.result)
	const count = (...results: string[]) => {
		return finals.filter((g) => results.includes(g.game.result!)).length
	}
	// Goals from games with a score the league split per team
	const goals = finals.flatMap((g) => {
		const byTeam = getGoalsByTeam(g.game)
		return byTeam
			? [
					{
						for: byTeam[g.game.team.id]!,
						against: byTeam[g.game.opponent.id]!,
					},
				]
			: []
	})
	const goalsFor = goals.reduce((n, g) => n + g.for, 0)
	const goalsAgainst = goals.reduce((n, g) => n + g.against, 0)
	const diff = goalsFor - goalsAgainst
	return (
		<header className="Detail-header Detail-header--player">
			<div className="PlayerHero">
				<div className="TeamHero-identity">
					<TeamAvatar
						name={team.team.name}
						logoUrl={team.team.logoUrl}
						size={64}
					/>
					<div className="PlayerHero-identity">
						<h1 className="PlayerHero-name">{team.team.name}</h1>
						{team.divisionName && (
							<div className="PlayerHero-bio">
								<span className="PlayerHero-position">
									{team.divisionName}
								</span>
							</div>
						)}
					</div>
				</div>
				<div className="PlayerHero-stats">
					<HeroStatGroup
						label="Record"
						stats={{
							W: count("W"),
							L: count("L", "OTL", "SOL"),
							T: count("T"),
							GP: finals.length,
						}}
					/>
					<HeroStatGroup
						label="Goals"
						stats={{
							GF: goalsFor,
							GA: goalsAgainst,
							Diff: diff > 0 ? `+${diff}` : diff,
						}}
					/>
					<HeroLastResults games={team.games} />
				</div>
			</div>
		</header>
	)
}

const SeasonPicker = ({team}: {team: TeamResponse}) => {
	const {history} = React.useContext(AppContext)
	return (
		<Picker
			groups={[
				{
					label: "",
					items: team.seasons.map((s) => ({
						value: s.id,
						label: s.name,
					})),
				},
			]}
			value={team.season.id}
			onChange={(seasonId) => {
				history.push(getTeamHref({id: team.team.id, seasonId}))
			}}
			placeholder="Season"
			className="Detail-select"
		/>
	)
}

interface LeaderCategory {
	title: string
	/** Column in the league's stats table */
	column: string
	/** Lower is better (e.g. goals-against average) */
	ascending?: boolean
}

const SKATER_LEADERS: LeaderCategory[] = [
	{title: "Goals", column: "G"},
	{title: "Assists", column: "A"},
	{title: "Points", column: "PTS"},
]

const GOALIE_LEADERS: LeaderCategory[] = [
	{title: "Wins", column: "W"},
	{title: "Goals against avg", column: "GAA", ascending: true},
	{title: "Save percentage", column: "SV%"},
]

const LEADERS_PER_CATEGORY = 3

/** Top skaters and goalies in a few categories, from the roster's stats. */
type LeaderKind = "skaters" | "goalies"

const TeamLeaders = ({roster}: {roster: TeamResponse["roster"]}) => {
	const [kind, setKind] = React.useState<LeaderKind>("skaters")
	if (roster.skaters.length === 0 && roster.goalies.length === 0) {
		return null
	}
	return (
		<section>
			<div className="Leaders-header">
				<h2 className="SectionLabel">Team leaders</h2>
				<SegmentedControl<LeaderKind>
					label="Leaders"
					options={[
						{value: "skaters", label: "Skaters"},
						{value: "goalies", label: "Goalies"},
					]}
					value={kind}
					onChange={setKind}
				/>
			</div>
			<div className="Leaders-grid">
				{kind === "skaters" ? (
					<>
						{SKATER_LEADERS.map((category) => (
							<LeaderCard
								key={category.column}
								category={category}
								players={roster.skaters}
							/>
						))}
					</>
				) : (
					<>
						{GOALIE_LEADERS.map((category) => (
							<LeaderCard
								key={category.column}
								category={category}
								// Rates only mean something for goalies who've played
								players={roster.goalies.filter(
									(g) => Number(g.stats["GP"]) > 0,
								)}
							/>
						))}
					</>
				)}
			</div>
		</section>
	)
}

const LeaderCard = ({
	category,
	players,
}: {
	category: LeaderCategory
	players: RosterPlayer[]
}) => {
	const value = (p: RosterPlayer) => Number(p.stats[category.column])
	const leaders = players
		.filter((p) => {
			const v = value(p)
			// Counting stats of 0 aren't leading anything
			return Number.isFinite(v) && (category.ascending || v > 0)
		})
		.sort((a, b) => {
			const diff = category.ascending
				? value(a) - value(b)
				: value(b) - value(a)
			return diff || a.name.localeCompare(b.name)
		})
		.slice(0, LEADERS_PER_CATEGORY)
	// Players with recorded stats but all zeros (e.g. a winless team) have
	// stats, just nothing to lead with
	const hasStats = players.some((p) => Number.isFinite(value(p)))
	return (
		<div className="LeaderCard">
			<h3 className="LeaderCard-title">{category.title}</h3>
			{leaders.length === 0 ? (
				<p className="Detail-empty">
					{hasStats
						? `No ${category.title.toLowerCase()} yet.`
						: "No stats yet."}
				</p>
			) : (
				<ol className="LeaderCard-list">
					{leaders.map((p) => (
						<li key={p.khlPlayerId} className="LeaderCard-row">
							<span className="LeaderCard-number">
								{p.number ? `#${p.number}` : ""}
							</span>
							<Link
								className="LeaderCard-name"
								href={getPlayerHref(p.playerId)}
							>
								{p.name}
							</Link>
							<span className="LeaderCard-value">
								{p.stats[category.column]}
							</span>
						</li>
					))}
				</ol>
			)}
		</div>
	)
}

const Roster = ({team}: {team: TeamResponse}) => {
	const {skaters, goalies} = team.roster
	return (
		<section className="Detail-panel">
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				Roster · {skaters.length + goalies.length}
			</h2>
			<RosterTables roster={team.roster} />
		</section>
	)
}

export const TeamRoute = {
	path: "/teams/:teamId",
	title: "Team",
	content: TeamPage,
} as const satisfies Route
