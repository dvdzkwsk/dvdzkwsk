import * as React from "react"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {Helmet} from "react-helmet"
import {
	FeedGame,
	GET_TEAM_ENDPOINT,
	RosterPlayer,
	TeamResponse,
} from "../../shared/ApiJson.js"
import {STRINGS} from "../../shared/KHLConfig.js"
import {
	AsyncContent,
	Hint,
	Link,
	PageShell,
	Picker,
	SegmentedControl,
	RosterTables,
	TeamAvatar,
} from "../Components.js"
import {GameCards, PastGames} from "../Games.js"
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
						<Helmet>
							<title>
								{team.team.name} | {STRINGS.PRODUCT_NAME}
							</title>
						</Helmet>
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
						<TeamLeaders roster={team.roster} />
						<PastGames
							games={team.games}
							now={now}
							getTeamLogoUrl={() => team.team.logoUrl}
						/>
						<Roster team={team} />
					</div>
				)}
			</AsyncContent>
		</PageShell>
	)
}

const TeamHeader = ({team}: {team: TeamResponse}) => {
	const finals = team.games.filter((g) => g.game.isFinal && g.game.result)
	const count = (result: string) => {
		return finals.filter((g) => g.game.result === result).length
	}
	return (
		<header className="Detail-header">
			<TeamAvatar
				name={team.team.name}
				logoUrl={team.team.logoUrl}
				size={64}
			/>
			<div className="Detail-heading">
				<h1 className="Detail-name">{team.team.name}</h1>
				<div className="Detail-meta">
					{team.divisionName && <span>{team.divisionName}</span>}
					{finals.length > 0 && (
						<span>
							{count("W")}-{count("L")}-{count("T")}
						</span>
					)}
					<RecentResults games={finals} />
				</div>
			</div>
		</header>
	)
}

/** The last five results, oldest to newest. */
const RecentResults = ({games}: {games: FeedGame[]}) => {
	const recent = games.slice(-5)
	if (recent.length === 0) {
		return null
	}
	return (
		<Hint label={`Last ${recent.length} games, oldest to newest`}>
			<span className="Detail-form">
				{/* The real count: a team three games in has a "Last 3" */}
				<span className="Detail-meta-hint">Last {recent.length}</span>
				{recent.map(({game}) => (
					<span
						key={game.startsAt}
						className={cx(
							"GameFeed-result",
							`GameFeed-result--${game.result}`,
						)}
					>
						{game.result}
					</span>
				))}
			</span>
		</Hint>
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
