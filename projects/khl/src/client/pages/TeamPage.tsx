import * as React from "react"
import {Tabs} from "@base-ui/react/tabs"
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
	Link,
	PageShell,
	Picker,
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
			<AsyncContent state={state}>
				{(team) => (
					<div className="Detail">
						<Helmet>
							<title>
								{team.team.name} | {STRINGS.PRODUCT_NAME}
							</title>
						</Helmet>
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
							showTeam={false}
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
							<span className="Detail-meta-hint"> W-L-T</span>
						</span>
					)}
					<RecentResults games={finals} />
				</div>
			</div>
			<SeasonPicker team={team} />
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
		<span className="Detail-form" title="Last 5 games, oldest to newest">
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
const TeamLeaders = ({roster}: {roster: TeamResponse["roster"]}) => {
	if (roster.skaters.length === 0 && roster.goalies.length === 0) {
		return null
	}
	return (
		<section>
			<Tabs.Root defaultValue="skaters">
				<div className="Leaders-header">
					<h2 className="SectionLabel">Team leaders</h2>
					<Tabs.List className="Tabs-list">
						<Tabs.Tab className="Tabs-tab" value="skaters">
							Skaters
						</Tabs.Tab>
						<Tabs.Tab className="Tabs-tab" value="goalies">
							Goalies
						</Tabs.Tab>
						<Tabs.Indicator className="Tabs-indicator" />
					</Tabs.List>
				</div>
				<Tabs.Panel value="skaters" className="Leaders-grid">
					{SKATER_LEADERS.map((category) => (
						<LeaderCard
							key={category.column}
							category={category}
							players={roster.skaters}
						/>
					))}
				</Tabs.Panel>
				<Tabs.Panel value="goalies" className="Leaders-grid">
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
				</Tabs.Panel>
			</Tabs.Root>
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
