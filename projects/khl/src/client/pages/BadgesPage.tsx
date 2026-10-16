import * as React from "react"
import {URLS} from "../../shared/KHLConfig.js"
import {Badge, BadgeIcon, BADGES} from "../Badges.js"
import {Card, Link, PageShell} from "../Components.js"
import {Route} from "../Util.js"

// --- /badges: every badge a player can have, and how to get it

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
						career stats, and a few are awarded by hand. Have an
						idea?{" "}
						<Link href={URLS.FEEDBACK_FORM}>Suggest a badge ↗</Link>
						. Think you've earned one?{" "}
						<Link href={URLS.FEEDBACK_FORM}>Request a badge ↗</Link>
						.
					</p>
				</header>
				<BadgeSection title="Earned" badges={earned} />
				<BadgeSection title="Awarded" badges={given} />
			</div>
		</PageShell>
	)
}

const BadgeSection = ({title, badges}: {title: string; badges: Badge[]}) => {
	if (badges.length === 0) {
		return null
	}
	return (
		<Card title={title} flush>
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
						</div>
					</li>
				))}
			</ul>
		</Card>
	)
}

export const BadgesRoute = {
	path: "/badges",
	title: "Badges",
	description: "Every badge a player can earn, and how to get it.",
	content: BadgesPage,
} as const satisfies Route
