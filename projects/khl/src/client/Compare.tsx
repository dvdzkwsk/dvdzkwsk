import {matchValue} from "@dvdzkwsk/util/MatchUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {Card, InfoPopover} from "./Components.js"
import {SeasonSummary} from "../shared/ApiJson.js"
import {KHLGamePreviewStats} from "../shared/KHLJson.js"

/** Which side a stat favors: more is better, less is better, or neither. */
type Better = "higher" | "lower" | null

type Side = "a" | "b"

interface ComparisonStat {
	label: string
	/** What the stat means and how it's calculated, in the label's popover */
	info: string
	a: number | null
	b: number | null
	format: (value: number) => string
	better: Better
}

const perGame = (team: SeasonSummary, total: number) =>
	team.gamesPlayed > 0 ? total / team.gamesPlayed : 0

const percent = (value: number) => `${value.toFixed(1)}%`
const oneDecimal = (value: number) => value.toFixed(1)
const twoDecimals = (value: number) => value.toFixed(2)

/** Goal rows from each side's season, then the league's preview stats */
function getComparisonStats(
	a: SeasonSummary,
	b: SeasonSummary,
	previewStats: KHLGamePreviewStats | null,
): ComparisonStat[] {
	const goals: ComparisonStat[] = [
		{
			label: "Goals for / game",
			info: "Goals scored per game: goals in the season's finished games ÷ games played.",
			a: perGame(a, a.goalsFor),
			b: perGame(b, b.goalsFor),
			format: twoDecimals,
			better: "higher",
		},
		{
			label: "Goals against / game",
			info: "Goals allowed per game: goals against in the season's finished games ÷ games played. Lower is better.",
			a: perGame(a, a.goalsAgainst),
			b: perGame(b, b.goalsAgainst),
			format: twoDecimals,
			better: "lower",
		},
		{
			label: "Goal differential",
			info: "Goals scored minus goals allowed, over the season's finished games.",
			a: a.goalsFor - a.goalsAgainst,
			b: b.goalsFor - b.goalsAgainst,
			format: (v) => (v > 0 ? `+${v}` : String(v)),
			better: "higher",
		},
	]
	// The league's numbers, from its game preview page
	const preview: (Omit<ComparisonStat, "a" | "b"> & {
		key: keyof KHLGamePreviewStats
	})[] = [
		{
			label: "Power play",
			info: "How often a team scores with the extra skater: power-play goals ÷ power plays, as the league reports it.",
			key: "powerPlayPct",
			format: percent,
			better: "higher",
		},
		{
			label: "Penalty kill",
			info: "How often a team stops the other team scoring while shorthanded: penalties killed without a goal ÷ times shorthanded, as the league reports it.",
			key: "penaltyKillPct",
			format: percent,
			better: "higher",
		},
		{
			label: "Shots / game",
			info: "Shots on goal per game: shots taken ÷ games played, as the league reports it.",
			key: "shotsPerGame",
			format: oneDecimal,
			better: "higher",
		},
		{
			label: "Shots against / game",
			info: "Shots on goal allowed per game: shots against ÷ games played, as the league reports it. Lower is better.",
			key: "shotsAgainstPerGame",
			format: oneDecimal,
			better: "lower",
		},
		{
			label: "Penalty minutes / game",
			info: "Penalty minutes per game: minutes assessed in penalties ÷ games played, as the league reports it. Lower is better.",
			key: "penaltyMinutesPerGame",
			format: oneDecimal,
			better: "lower",
		},
	]
	return [
		...goals,
		...preview.flatMap(({key, ...stat}) => {
			// "away" is side a: a game's away team, or a matchup's first pick
			const values = previewStats?.[key]
			return values ? [{...stat, a: values.away, b: values.home}] : []
		}),
	]
}

/**
 * How full each side's bar is, from 0 to 1, or null for an unknown value (no
 * bar). Both share a scale, so the larger value fills its side. The scale
 * starts at zero, or lower when a value is negative (a goal differential), so
 * the better side still fills and the lower one is empty.
 */
export function getBarFills(
	a: number | null,
	b: number | null,
): {a: number | null; b: number | null} {
	const min = Math.min(0, a ?? 0, b ?? 0)
	const max = Math.max(a ?? 0, b ?? 0)
	const fill = (value: number | null) => {
		if (value === null) {
			return null
		}
		return max > min ? (value - min) / (max - min) : 0
	}
	return {a: fill(a), b: fill(b)}
}

/**
 * Two teams' seasons side by side, on a game page and the matchup page: each
 * row's label in the middle, each team's value beside it, and bars in the
 * team's color growing outward.
 */
export const Comparison = ({
	a,
	b,
	previewStats,
}: {
	/** The away team, or the matchup's first pick */
	a: SeasonSummary
	b: SeasonSummary
	/** The league's PP%, PK%, shots and PIM, with a as "away"; rows for
	    missing stats are left out */
	previewStats: KHLGamePreviewStats | null
}) => {
	return (
		<Card panelClassName="Compare">
			<div className="Compare-group" role="group" aria-label="Stats">
				{getComparisonStats(a, b, previewStats).map((stat) => (
					<ValueRow
						key={stat.label}
						label={stat.label}
						info={stat.info}
						format={stat.format}
						better={stat.better}
						valueA={stat.a}
						valueB={stat.b}
					/>
				))}
			</div>
		</Card>
	)
}

/** One row: team A's cell, the label, team B's cell. */
const CompareRow = ({
	label,
	info,
	a,
	b,
}: {
	label: string
	/** Explains the stat, in a popover on the label */
	info: string
	a: React.ReactNode
	b: React.ReactNode
}) => {
	return (
		<div className="Compare-row">
			<div className={cx("Compare-cell", "Compare-cell--a")}>{a}</div>
			<div className="Compare-label">
				<InfoPopover
					trigger={
						<button type="button" className="Compare-info">
							{label}
						</button>
					}
				>
					{info}
				</InfoPopover>
			</div>
			<div className={cx("Compare-cell", "Compare-cell--b")}>{b}</div>
		</div>
	)
}

/** A stat for both sides: values by the label, bars growing outward. */
const ValueRow = ({
	label,
	info,
	format,
	better,
	valueA,
	valueB,
}: {
	label: string
	info: string
	format: (value: number) => string
	better: Better
	/** Null when unknown: a dash, and no bar */
	valueA: number | null
	valueB: number | null
}) => {
	const known = valueA !== null && valueB !== null
	let leader: Side | null = null
	if (known && better !== null && valueA !== valueB) {
		const aLeads = matchValue(better, {
			higher: valueA > valueB,
			lower: valueA < valueB,
		})
		leader = aLeads ? "a" : "b"
	}
	const fills = getBarFills(valueA, valueB)
	const show = (value: number | null) =>
		value === null ? "–" : format(value)
	const cell = (side: Side, value: number | null) => {
		const fill = fills[side]
		return (
			<>
				<span
					className={cx(
						"Compare-value",
						leader === side && "Compare-value--leader",
					)}
				>
					{show(value)}
				</span>
				{fill !== null && (
					// Both sides' tracks are the same length, outlined, so the
					// fills show the gap; an empty fill is just the outline
					<span className="Compare-track" aria-hidden>
						{fill > 0 && (
							<span
								className={cx(
									"Compare-fill",
									leader !== null &&
										leader !== side &&
										"Compare-fill--trailing",
								)}
								style={{width: `${fill * 100}%`}}
							/>
						)}
					</span>
				)}
			</>
		)
	}
	return (
		<CompareRow
			label={label}
			info={info}
			a={cell("a", valueA)}
			b={cell("b", valueB)}
		/>
	)
}
