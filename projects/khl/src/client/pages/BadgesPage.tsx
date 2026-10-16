import * as React from "react"
import {Badge, BadgeIcon, BADGES} from "../Badges.js"
import {PageShell} from "../Components.js"
import {Route} from "../Util.js"

// --- /badges: every badge a player can have, and how to get it

const LIST_FORMAT = new Intl.ListFormat("en", {type: "conjunction"})

const BadgesPage = () => {
	const earned = BADGES.filter((badge) => !badge.players)
	const given = BADGES.filter((badge) => badge.players)
	return (
		<PageShell>
			<div className="BadgesPage">
				<header className="BadgesPage-hero">
					<h1 className="BadgesPage-title">Badges</h1>
					<p className="BadgesPage-lede">
						Badges show on a player's page. Most are earned from
						career stats, and a few are handed out.
					</p>
				</header>
				<BadgeSection title="Earned" badges={earned} />
				<BadgeSection title="Handed out" badges={given} />
			</div>
		</PageShell>
	)
}

/** Each name once, with "(×2)" after those listed twice */
function formatRecipients(players: string[]): string[] {
	const counts = new Map<string, number>()
	for (const name of players) {
		counts.set(name, (counts.get(name) ?? 0) + 1)
	}
	return [...counts].map(([name, count]) =>
		count > 1 ? `${name} (×${count})` : name,
	)
}

const BadgeSection = ({title, badges}: {title: string; badges: Badge[]}) => {
	if (badges.length === 0) {
		return null
	}
	return (
		<section className="BadgesPage-section">
			<h2 className="SectionLabel">{title}</h2>
			<ul className="BadgesPage-list">
				{badges.map((badge) => (
					<li key={badge.id} className="BadgesPage-badge">
						<BadgeIcon badge={badge} />
						<div className="BadgesPage-text">
							<span className="BadgesPage-label">
								{badge.label}
							</span>
							<span className="BadgesPage-description">
								{badge.description}
							</span>
							{badge.players && (
								<span className="BadgesPage-players">
									Given to{" "}
									{LIST_FORMAT.format(
										formatRecipients(badge.players),
									)}
								</span>
							)}
						</div>
					</li>
				))}
			</ul>
		</section>
	)
}

export const BadgesRoute = {
	path: "/badges",
	title: "Badges",
	description: "Every badge a player can earn, and how to get it.",
	content: BadgesPage,
} as const satisfies Route
