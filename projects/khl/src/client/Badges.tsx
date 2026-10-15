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
	/** Hand-given badges: who has it, by name */
	players?: string[]
	earned: (stats: BadgeStats) => boolean
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

/** Given out by hand, matched on the player's name */
const customBadge = (
	id: string,
	icon: React.ReactNode,
	label: string,
	description: string,
	players: string[],
): Badge => {
	const names = new Set(players.map(normalizePlayerName))
	return {
		id,
		icon,
		label,
		description,
		players,
		earned: (stats) => names.has(normalizePlayerName(stats.name)),
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
	gamesMilestone(1, "🏒", "First Game", "Played a first KHL game."),
	gamesMilestone(100, "💯", "100 Games", "Played 100 career games."),
	gamesMilestone(500, "🏆", "500 Games", "Played 500 career games."),
]

export function getBadges(stats: BadgeStats): Badge[] {
	return BADGES.filter((badge) => badge.earned(stats))
}

/** A badge's emoji in a rounded tile */
export const BadgeIcon = ({badge}: {badge: Badge}) => {
	return (
		<span className="BadgeIcon" aria-hidden>
			{badge.icon}
		</span>
	)
}

/** A badge's name and how it's earned, for a popover */
export const BadgeHint = ({badge}: {badge: Badge}) => {
	return (
		<span className="BadgeHint">
			<strong className="BadgeHint-label">{badge.label}</strong>
			{badge.description}
		</span>
	)
}
