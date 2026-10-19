import * as React from "react"
import {URLS} from "../../shared/KHLConfig.js"
import {Achievement, AchievementIcon, ACHIEVEMENTS} from "../Achievements.js"
import {Card, Link, PageShell} from "../Components.js"
import {Route} from "../Util.js"

// --- /achievements: every achievement a player can have, and how to get it

const AchievementsPage = () => {
	const earned = ACHIEVEMENTS.filter((achievement) => !achievement.players)
	const given = ACHIEVEMENTS.filter((achievement) => achievement.players)
	return (
		<PageShell>
			<div className="AchievementsPage">
				<header className="AchievementsPage-hero">
					<h1 className="AchievementsPage-title">Achievements</h1>
					<p className="AchievementsPage-lede">
						Achievements show on a player's page. Most are earned
						from career stats, and a few are awarded by hand. Have
						an idea?{" "}
						<Link href={URLS.FEEDBACK_FORM}>
							Suggest an achievement ↗
						</Link>
						. Think you've earned one?{" "}
						<Link href={URLS.FEEDBACK_FORM}>
							Request an achievement ↗
						</Link>
						.
					</p>
				</header>
				<AchievementSection title="Earned" achievements={earned} />
				<AchievementSection title="Awarded" achievements={given} />
			</div>
		</PageShell>
	)
}

const AchievementSection = ({
	title,
	achievements,
}: {
	title: string
	achievements: Achievement[]
}) => {
	if (achievements.length === 0) {
		return null
	}
	return (
		<Card title={title} flush>
			<ul className="AchievementsPage-list">
				{achievements.map((achievement) => (
					<li
						key={achievement.id}
						className="AchievementsPage-achievement"
					>
						<AchievementIcon achievement={achievement} />
						<div className="AchievementsPage-text">
							<span className="AchievementsPage-label">
								{achievement.label}
							</span>
							<span className="AchievementsPage-description">
								{achievement.description}
							</span>
						</div>
					</li>
				))}
			</ul>
		</Card>
	)
}

export const AchievementsRoute = {
	path: "/achievements",
	title: "Achievements",
	description: "Every achievement a player can earn, and how to get it.",
	content: AchievementsPage,
} as const satisfies Route
