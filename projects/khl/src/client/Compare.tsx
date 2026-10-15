import {cx} from "@dvdzkwsk/util/ReactUtil"
import {HeadToHeadGame, RecentGame, SeasonSummary} from "../shared/ApiJson.js"
import {KHLSeason} from "../shared/KHLJson.js"
import {LIMITS} from "../shared/KHLConfig.js"
import {Hint, TeamAvatar, TeamLink} from "./Components.js"
import {ResultChips} from "./Games.js"
import {getShortSeasonName} from "./Util.js"

/**
 * Two teams' seasons compared, as on the matchup page. A game page compares
 * its teams' seasons going into the game.
 */
export interface ComparisonData {
	/** Titles the comparison "Season so far" when both sides are in it */
	currentSeason: KHLSeason
	a: SeasonSummary
	b: SeasonSummary
	/** Finished games between the two teams, newest first */
	headToHead: HeadToHeadGame[]
}

/** Which side a stat favors: more is better, less is better, or neither. */
type Better = "higher" | "lower" | null

type Side = "a" | "b"

interface ComparisonStat {
	label: string
	get: (team: SeasonSummary) => number
	format: (value: number) => string
	better: Better
	/** Draw bars; only for counts and rates, which can't be negative */
	bar: boolean
}

const perGame = (total: (t: SeasonSummary) => number) => (t: SeasonSummary) =>
	t.gamesPlayed > 0 ? total(t) / t.gamesPlayed : 0

const RECORD_STATS: ComparisonStat[] = [
	{
		label: "Wins",
		get: (t) => t.wins,
		format: String,
		better: "higher",
		bar: true,
	},
	{
		label: "Losses",
		get: (t) => t.losses,
		format: String,
		better: "lower",
		bar: true,
	},
	{
		label: "Ties",
		get: (t) => t.ties,
		format: String,
		better: null,
		bar: true,
	},
]

const GOAL_STATS: ComparisonStat[] = [
	{
		label: "Goals for / game",
		get: perGame((t) => t.goalsFor),
		format: (v) => v.toFixed(2),
		better: "higher",
		bar: true,
	},
	{
		label: "Goals against / game",
		get: perGame((t) => t.goalsAgainst),
		format: (v) => v.toFixed(2),
		better: "lower",
		bar: true,
	},
	{
		label: "Goal differential",
		get: (t) => t.goalsFor - t.goalsAgainst,
		format: (v) => (v > 0 ? `+${v}` : String(v)),
		better: "higher",
		bar: false,
	},
]

/**
 * The two teams' seasons side by side: each row's label in the middle, each
 * team's value beside it, and bars in the team's color growing outward.
 */
export const Comparison = ({matchup}: {matchup: ComparisonData}) => {
	const {a, b} = matchup
	const sameSeason = a.season.id === b.season.id
	return (
		<section className={cx("Detail-panel", "Compare")}>
			<header className="Compare-head">
				<CompareTeam side="a" team={a} />
				<h2 className={cx("SectionLabel", "Compare-title")}>
					{sameSeason
						? a.season.id === matchup.currentSeason.id
							? "Season so far"
							: a.season.name
						: "Seasons"}
				</h2>
				<CompareTeam side="b" team={b} />
			</header>
			<CompareGroup label="Form">
				<CompareRow
					label="Last 10"
					a={<ResultChips games={a.recent} />}
					b={<ResultChips games={b.recent} />}
				/>
				{a.team.id !== b.team.id && <HeadToHeadRow matchup={matchup} />}
				<CompareRow
					label="Streak"
					a={<StreakChip team={a} />}
					b={<StreakChip team={b} />}
				/>
			</CompareGroup>
			<CompareGroup label="Record">
				{RECORD_STATS.map((stat) => (
					<StatRow key={stat.label} stat={stat} a={a} b={b} />
				))}
			</CompareGroup>
			<CompareGroup label="Goals">
				{GOAL_STATS.map((stat) => (
					<StatRow key={stat.label} stat={stat} a={a} b={b} />
				))}
			</CompareGroup>
		</section>
	)
}

/** A team's name, logo and color key, at its side of the comparison. */
const CompareTeam = ({side, team}: {side: Side; team: SeasonSummary}) => {
	return (
		<div className={cx("Compare-team", `Compare-team--${side}`)}>
			<TeamAvatar
				name={team.team.name}
				logoUrl={team.team.logoUrl}
				size={36}
			/>
			<div className="Compare-team-text">
				<div className="Compare-team-name">
					<span className="Compare-key" aria-hidden />
					<TeamLink team={team.team} seasonId={team.team.seasonId} />
				</div>
				<Hint label={team.season.name}>
					<div className="Compare-team-meta">
						{getShortSeasonName(team.season.name)} ·{" "}
						{team.gamesPlayed} GP
					</div>
				</Hint>
			</div>
		</div>
	)
}

const CompareGroup = ({
	label,
	children,
}: {
	label: string
	children: React.ReactNode
}) => {
	return (
		<div className="Compare-group" role="group" aria-label={label}>
			<h3 className="Compare-group-label">{label}</h3>
			{children}
		</div>
	)
}

/** One row: team A's cell, the label, team B's cell. */
const CompareRow = ({
	label,
	a,
	b,
	title,
}: {
	label: string
	a: React.ReactNode
	b: React.ReactNode
	/** Both values, on hover */
	title?: string
}) => {
	return (
		<Hint label={title}>
			<div className="Compare-row">
				<div className={cx("Compare-cell", "Compare-cell--a")}>{a}</div>
				<div className="Compare-label">{label}</div>
				<div className={cx("Compare-cell", "Compare-cell--b")}>{b}</div>
			</div>
		</Hint>
	)
}

const StatRow = ({
	stat,
	a,
	b,
}: {
	stat: ComparisonStat
	a: SeasonSummary
	b: SeasonSummary
}) => {
	const valueA = stat.get(a)
	const valueB = stat.get(b)
	const leader: Side | null =
		stat.better === null || valueA === valueB
			? null
			: valueA > valueB === (stat.better === "higher")
				? "a"
				: "b"
	// Both bars share a scale, so the larger value fills its side
	const max = Math.max(valueA, valueB)
	const cell = (side: Side, value: number) => (
		<>
			<span
				className={cx(
					"Compare-value",
					leader === side && "Compare-value--leader",
				)}
			>
				{stat.format(value)}
			</span>
			{stat.bar && (
				<span className="Compare-track" aria-hidden>
					{max > 0 && value > 0 && (
						<span
							className={cx(
								"Compare-fill",
								leader !== null &&
									leader !== side &&
									"Compare-fill--trailing",
							)}
							style={{width: `${(value / max) * 100}%`}}
						/>
					)}
				</span>
			)}
		</>
	)
	return (
		<CompareRow
			label={stat.label}
			title={`${a.team.name} ${stat.format(valueA)} · ${b.team.name} ${stat.format(valueB)}`}
			a={cell("a", valueA)}
			b={cell("b", valueB)}
		/>
	)
}

const StreakChip = ({team}: {team: SeasonSummary}) => {
	if (!team.streak) {
		return <span className="Compare-empty">–</span>
	}
	const {result, count} = team.streak
	const word = {W: "win", L: "loss", T: "tie"}[result] ?? result
	return (
		<Hint
			label={`${count} ${count === 1 ? word : word === "loss" ? "losses" : `${word}s`} in a row`}
		>
			<span
				className={cx(
					"GameFeed-result",
					`GameFeed-result--${result}`,
					"Compare-streak",
				)}
			>
				{result}
				{count}
			</span>
		</Hint>
	)
}

/**
 * Each side's latest meetings with the other team in its own season, or a
 * note that they didn't meet.
 */
const HeadToHeadRow = ({matchup}: {matchup: ComparisonData}) => {
	const {a, b, currentSeason} = matchup
	const meetings = (
		team: SeasonSummary,
		opponent: SeasonSummary,
	): RecentGame[] => {
		return (
			matchup.headToHead
				// Newest first; unscored games have no result to show
				.filter((g) => g.seasonId === team.season.id && g.goals)
				.slice(0, LIMITS.MATCHUP_HEAD_TO_HEAD_GAMES)
				.reverse()
				.map((game) => {
					const own = game.goals![team.team.id]!
					const other = game.goals![opponent.team.id]!
					return {
						gameId: game.gameId,
						startsAt: game.startsAt,
						arena: game.arena,
						opponent: opponent.team,
						homeAway:
							game.homeTeamId === team.team.id ? "home" : "away",
						result: own > other ? "W" : own < other ? "L" : "T",
						goalsFor: own,
						goalsAgainst: other,
					}
				})
		)
	}
	const meetingsA = meetings(a, b)
	const meetingsB = meetings(b, a)
	if (
		meetingsA.length === 0 &&
		meetingsB.length === 0 &&
		a.season.id === b.season.id
	) {
		const when =
			a.season.id === currentSeason.id
				? "this season"
				: `in ${a.season.name}`
		// An empty mark on each side, like Streak, so the row keeps its shape
		const none = <span className="Compare-empty">–</span>
		return (
			<CompareRow
				label="Head-to-head"
				title={`They haven't played each other ${when}`}
				a={none}
				b={none}
			/>
		)
	}
	const cell = (games: RecentGame[], team: SeasonSummary) =>
		games.length === 0 ? (
			<span className="Compare-empty">None in {team.season.name}</span>
		) : (
			<ResultChips games={games} />
		)
	return (
		<CompareRow
			label="Head-to-head"
			a={cell(meetingsA, a)}
			b={cell(meetingsB, b)}
		/>
	)
}
