import * as React from "react"
import {RecentPenalties} from "../shared/ApiJson.js"
import {LIMITS} from "../shared/KHLConfig.js"
import {normalizePlayerName} from "../shared/KHLJson.js"

/** What a player's badges are judged on */
export interface BadgeStats {
	name: string
	/** Career games */
	gamesPlayed: number
	/** Null if the latest games couldn't be loaded */
	recentPenalties: RecentPenalties | null
}

export interface Badge {
	id: string
	/** An emoji, or an inline SVG where an emoji doesn't render everywhere */
	icon: React.ReactNode
	label: string
	description: string
	/** Hand-given badges: who has it, by name, once per time given */
	players?: string[]
	earned: (stats: BadgeStats) => boolean
	/** How many times they have it, for badges given more than once */
	count?: (stats: BadgeStats) => number
}

/** Windows draws the 🇯🇵 emoji as the letters "JP", so the flag is drawn here */
function JapanFlag() {
	return (
		<svg className="BadgeIcon-flag" viewBox="0 0 30 20">
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

const {BADGE_TREND_LOOKBACK_DAYS, BADGE_TREND_MIN_GAMES} = LIMITS

/** Penalties per game over the trend window, once it has enough games */
function getPenaltiesPerGame(stats: BadgeStats): number | null {
	const recent = stats.recentPenalties
	if (!recent || recent.games < BADGE_TREND_MIN_GAMES) {
		return null
	}
	return recent.penalties / recent.games
}

const TREND_MONTHS = Math.round(BADGE_TREND_LOOKBACK_DAYS / 30.4)

const TREND_NOTE = `over their last ${TREND_MONTHS} months of games (at least ${BADGE_TREND_MIN_GAMES} played)`

const gamesMilestone = (
	games: number,
	icon: string,
	label: string,
	description: string,
): Badge => ({
	id: `games-${games}`,
	icon,
	label,
	description,
	earned: (stats) => stats.gamesPlayed >= games,
})

/** Given out by hand, matched on the player's name. List a name again for
    each extra time they've earned it. */
const customBadge = (
	id: string,
	icon: React.ReactNode,
	label: string,
	description: string,
	players: string[],
): Badge => {
	const counts = new Map<string, number>()
	for (const name of players.map(normalizePlayerName)) {
		counts.set(name, (counts.get(name) ?? 0) + 1)
	}
	const getCount = (stats: BadgeStats) => {
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

/** Every badge, in the order they're shown */
export const BADGES: Badge[] = [
	customBadge(
		"red-gloves-gang",
		"🥊",
		"Red Gloves Gang",
		"A founding member of the Red Gloves Gang.",
		["Gabey Lucas", "David Zukowski", "Emily Olan"],
	),
	customBadge("japanese", <JapanFlag />, "日本語", "Speaks Japanese.", [
		"Emily Sorg",
	]),
	customBadge(
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

export interface EarnedBadge {
	badge: Badge
	/** 1, unless it was given more than once */
	count: number
}

export function getBadges(stats: BadgeStats): EarnedBadge[] {
	return BADGES.filter((badge) => badge.earned(stats)).map((badge) => ({
		badge,
		count: badge.count?.(stats) ?? 1,
	}))
}

/** A badge's emoji in a rounded tile, with "×2" in the corner if earned twice */
export const BadgeIcon = ({
	badge,
	count = 1,
}: {
	badge: Badge
	count?: number
}) => {
	return (
		<span className="BadgeIcon" aria-hidden>
			{badge.icon}
			{count > 1 && <span className="BadgeIcon-count">×{count}</span>}
		</span>
	)
}

/** A badge's name and how it's earned, for a popover */
export const BadgeHint = ({
	badge,
	count = 1,
}: {
	badge: Badge
	count?: number
}) => {
	return (
		<span className="BadgeHint">
			<strong className="BadgeHint-label">
				{badge.label}
				{count > 1 && ` ×${count}`}
			</strong>
			{badge.description}
		</span>
	)
}
