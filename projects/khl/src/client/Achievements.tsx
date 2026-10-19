import {matchValue} from "@dvdzkwsk/util/MatchUtil"
import * as React from "react"
import {ActivityEvent, ActivityResult} from "../shared/ApiJson.js"
import {LIMITS} from "../shared/KHLConfig.js"
import {normalizePlayerName} from "../shared/KHLJson.js"

/** Penalties a player took in their latest games, for the trend achievements */
export interface RecentPenalties {
	/** Games the player dressed for in LIMITS.ACHIEVEMENT_TREND_LOOKBACK_DAYS */
	games: number
	penalties: number
}

/**
 * Counts the penalties in an activity response that has every game the player
 * dressed for in LIMITS.ACHIEVEMENT_TREND_LOOKBACK_DAYS ("played"), with penalties
 */
export function toRecentPenalties(activity: ActivityResult): RecentPenalties {
	const played = activity.games.filter((g) =>
		matchValue(g.attendance, {played: true, skipped: false}),
	)
	const isPenalty = (event: ActivityEvent) => {
		return matchValue(event.kind, {
			goal: false,
			assist: false,
			penalty: true,
		})
	}
	return {
		games: played.length,
		penalties: played.reduce(
			(total, g) => total + g.events.filter(isPenalty).length,
			0,
		),
	}
}

/** What a player's achievements are judged on */
export interface AchievementStats {
	name: string
	/** Career games */
	gamesPlayed: number
	/** Null if the latest games couldn't be loaded */
	recentPenalties: RecentPenalties | null
}

export interface Achievement {
	id: string
	/** An emoji, or an inline SVG where an emoji doesn't render everywhere */
	icon: React.ReactNode
	label: string
	description: string
	/** Hand-given achievements: who has it, by name, once per time given */
	players?: string[]
	earned: (stats: AchievementStats) => boolean
	/** How many times they have it, for achievements given more than once */
	count?: (stats: AchievementStats) => number
}

/** Windows draws the 🇯🇵 emoji as the letters "JP", so the flag is drawn here */
function JapanFlag() {
	return (
		<svg className="AchievementIcon-flag" viewBox="0 0 30 20">
			<rect
				x="0.5"
				y="0.5"
				width="29"
				height="19"
				rx="2"
				fill="#fff"
				stroke="rgb(0 0 0 / 0.15)"
			/>
			<circle cx="15" cy="10" r="6" fill="#bc002d" />
		</svg>
	)
}

const {ACHIEVEMENT_TREND_LOOKBACK_DAYS, ACHIEVEMENT_TREND_MIN_GAMES} = LIMITS

/** Penalties per game over the trend window, once it has enough games */
function getPenaltiesPerGame(stats: AchievementStats): number | null {
	const recent = stats.recentPenalties
	if (!recent || recent.games < ACHIEVEMENT_TREND_MIN_GAMES) {
		return null
	}
	return recent.penalties / recent.games
}

const TREND_MONTHS = Math.round(ACHIEVEMENT_TREND_LOOKBACK_DAYS / 30.4)

const TREND_NOTE = `over their last ${TREND_MONTHS} months of games (at least ${ACHIEVEMENT_TREND_MIN_GAMES} played)`

const gamesMilestone = (
	games: number,
	icon: string,
	label: string,
	description: string,
): Achievement => ({
	id: `games-${games}`,
	icon,
	label,
	description,
	earned: (stats) => stats.gamesPlayed >= games,
})

/** Given out by hand, matched on the player's name. List a name again for
    each extra time they've earned it. */
const customAchievement = (
	id: string,
	icon: React.ReactNode,
	label: string,
	description: string,
	players: string[],
): Achievement => {
	const counts = new Map<string, number>()
	for (const name of players.map(normalizePlayerName)) {
		counts.set(name, (counts.get(name) ?? 0) + 1)
	}
	const getCount = (stats: AchievementStats) => {
		return counts.get(normalizePlayerName(stats.name)) ?? 0
	}
	return {
		id,
		icon,
		label,
		description,
		players,
		earned: (stats) => getCount(stats) > 0,
		count: getCount,
	}
}

/** Every achievement, in the order they're shown */
export const ACHIEVEMENTS: Achievement[] = [
	customAchievement(
		"red-gloves-gang",
		"🥊",
		"Red Gloves Gang",
		"A founding member of the Red Gloves Gang.",
		["Gabey Lucas", "David Zukowski", "Emily Olan"],
	),
	customAchievement("japanese", <JapanFlag />, "日本語", "Speaks Japanese.", [
		"Emily Sorg",
	]),
	customAchievement(
		"broken-bone",
		"🦴",
		"Broken Bone",
		"Broke a bone playing in the KHL.",
		[
			"Helen Mahan",
			"Dave Persing",
			"Dave Persing",
			"Nicole McVarish",
			"Patrick Austin",
		],
	),
	customAchievement(
		"concussion",
		"🤕",
		"Concussion",
		"Took a concussion playing in the KHL.",
		["Trina Sida"],
	),
	{
		id: "angel",
		icon: "😇",
		label: "Angel",
		description: `Fewer than 1 penalty every 10 games, ${TREND_NOTE}.`,
		earned: (stats) => {
			const rate = getPenaltiesPerGame(stats)
			return rate !== null && rate < 1 / 10
		},
	},
	{
		id: "devil",
		icon: "😈",
		label: "Devil",
		description: `More than 1 penalty every 2 games, ${TREND_NOTE}.`,
		earned: (stats) => {
			const rate = getPenaltiesPerGame(stats)
			return rate !== null && rate > 1 / 2
		},
	},
	gamesMilestone(1, "🏒", "First Game", "Played their first KHL game."),
	gamesMilestone(100, "💯", "100 Games", "Played 100 career games."),
	gamesMilestone(500, "🏆", "500 Games", "Played 500 career games."),
]

export interface EarnedAchievement {
	achievement: Achievement
	/** 1, unless it was given more than once */
	count: number
}

export function getAchievements(stats: AchievementStats): EarnedAchievement[] {
	return ACHIEVEMENTS.filter((achievement) => achievement.earned(stats)).map(
		(achievement) => ({
			achievement,
			count: achievement.count?.(stats) ?? 1,
		}),
	)
}

/** An achievement's emoji in a rounded tile, with "×2" in the corner if earned twice */
export const AchievementIcon = ({
	achievement,
	count = 1,
}: {
	achievement: Achievement
	count?: number
}) => {
	return (
		<span className="AchievementIcon" aria-hidden>
			{achievement.icon}
			{count > 1 && (
				<span className="AchievementIcon-count">×{count}</span>
			)}
		</span>
	)
}

/** An achievement's name and how it's earned, for a popover */
export const AchievementHint = ({
	achievement,
	count = 1,
}: {
	achievement: Achievement
	count?: number
}) => {
	return (
		<span className="AchievementHint">
			<strong className="AchievementHint-label">
				{achievement.label}
				{count > 1 && ` ×${count}`}
			</strong>
			{achievement.description}
		</span>
	)
}
