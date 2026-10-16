import * as React from "react"
import {STRINGS, URLS} from "../../shared/KHLConfig.js"
import {Link, PageShell} from "../Components.js"
import {getBadgesHref, Route} from "../Util.js"

// --- /about: what the site adds on top of the league's

interface Feature {
	title: string
	/** One line; the diagram does the rest */
	text: React.ReactNode
	art: React.ComponentType
}

const FEATURES: Feature[] = [
	{
		title: "Jump straight to LiveBarn",
		text: "Stop struggling to find a game or highlight on LiveBarn. KHL+ gives you links so it's easy to watch every game and key moment.†",
		art: ReplayArt,
	},
	{
		title: "Consolidated player profiles",
		text: "The league site splits you into a separate profile for every team you join. We merge them into one, with career stats across all your teams.",
		art: PlayerArt,
	},
	{
		title: "Player badges",
		text: (
			<>
				Badges on your profile celebrate your time in the KHL. The more
				you play, the more you collect.{" "}
				<Link href={getBadgesHref()}>See every badge</Link>.
			</>
		),
		art: BadgesArt,
	},
	{
		title: "Activity feed",
		text: "Every player and team page shows their latest goals, assists, and penalties, with direct links to LiveBarn.†",
		art: ActivityArt,
	},
	{
		title: "Compare any two teams",
		text: "Any teams, any seasons, side by side.",
		art: CompareArt,
	},
	{
		title: "Rink details",
		text: "See rink addresses, schedules, LiveBarn feeds, all in one spot.",
		art: RinkArt,
	},
	{
		title: "Search everything",
		text: (
			<>
				Players, teams, and locations. Press <code>/</code> from
				anywhere to search.
			</>
		),
		art: SearchArt,
	},
	{
		title: "Box scores",
		text: "Every game's goals and shots by period, plus each team's lineup and what every player did.",
		art: BoxScoreArt,
	},
	{
		title: "Improved filters",
		text: "Filter games by location, and pick several locations or divisions at once.",
		art: FiltersArt,
	},
]

const AboutPage = () => {
	const leagueHost = new URL(URLS.KHL).host
	return (
		<PageShell>
			<div className="AboutPage">
				<header className="AboutPage-hero">
					<h1 className="AboutPage-title">
						The KHL website, reimagined by players and fans.
					</h1>
					<p className="AboutPage-lede">
						Find your next game, watch it on LiveBarn, and see your
						stats from every team you've played on. Same data as{" "}
						<Link href={URLS.KHL}>{leagueHost} ↗</Link>*, but with
						faster load times, smarter player profiles, direct links
						to LiveBarn feeds, and so much more.
					</p>
				</header>

				<ul className="AboutPage-features">
					{FEATURES.map((feature) => (
						<FeatureCard key={feature.title} feature={feature} />
					))}
				</ul>

				<footer className="AboutPage-notes">
					<p className="AboutPage-note">
						*Unofficial and not run by the league. {leagueHost} is
						the official record.
					</p>
					{/* See getGameEventClockTime for how the times are estimated */}
					<p className="AboutPage-note">
						†Scoresheets only give the game clock, not the time of
						day, so we estimate when each game event happened from
						the scheduled start, typical warmups and intermissions,
						and stoppages. Replays can land a minute or two off, so
						you may need to scrub a little.
					</p>
				</footer>
			</div>
		</PageShell>
	)
}

const FeatureCard = ({feature}: {feature: Feature}) => {
	const FeatureArt = feature.art
	return (
		<li className="AboutPage-feature">
			<div className="AboutPage-art" aria-hidden>
				<FeatureArt />
			</div>
			<h2 className="AboutPage-feature-title">{feature.title}</h2>
			<p className="AboutPage-feature-text">{feature.text}</p>
		</li>
	)
}

// --- Diagrams: 240×120, colored by the theme's tokens via CSS classes

const Art = ({children}: {children: React.ReactNode}) => {
	return (
		<svg viewBox="0 0 240 120" className="AboutArt">
			{children}
		</svg>
	)
}

/** The toolbar's dropdowns, one open with several rinks ticked */
function FiltersArt() {
	const options: [y: number, checked: boolean, w: number][] = [
		[48, true, 56],
		[68, true, 44],
		[88, false, 60],
	]
	return (
		<Art>
			<rect
				className="AboutArt-card"
				x="8"
				y="6"
				width="52"
				height="20"
				rx="10"
			/>
			<rect
				className="AboutArt-muted"
				x="20"
				y="14"
				width="28"
				height="4"
				rx="2"
			/>
			<rect
				className="AboutArt-ink"
				x="66"
				y="6"
				width="80"
				height="20"
				rx="10"
			/>
			<rect
				className="AboutArt-on-ink"
				x="78"
				y="14"
				width="40"
				height="4"
				rx="2"
			/>
			<rect
				className="AboutArt-on-ink"
				x="124"
				y="13"
				width="12"
				height="6"
				rx="3"
			/>
			<rect
				className="AboutArt-card"
				x="152"
				y="6"
				width="80"
				height="20"
				rx="10"
			/>
			<rect
				className="AboutArt-muted"
				x="164"
				y="14"
				width="44"
				height="4"
				rx="2"
			/>
			<rect
				className="AboutArt-card"
				x="66"
				y="34"
				width="120"
				height="78"
				rx="8"
			/>
			{options.map(([y, checked, w]) => (
				<g key={y}>
					{checked ? (
						<>
							<rect
								className="AboutArt-ink"
								x="76"
								y={y}
								width="12"
								height="12"
								rx="3"
							/>
							<path
								className="AboutArt-check"
								d={`M79 ${y + 6} L81.5 ${y + 8.5} L85.5 ${y + 3.5}`}
							/>
						</>
					) : (
						<rect
							className="AboutArt-outline"
							x="76.5"
							y={y + 0.5}
							width="11"
							height="11"
							rx="3"
						/>
					)}
					<rect
						className="AboutArt-muted"
						x="96"
						y={y + 4}
						width={w}
						height="4"
						rx="2"
					/>
				</g>
			))}
		</Art>
	)
}

/** Goals and penalties, one jumping to its moment in a LiveBarn replay */
function ReplayArt() {
	const events: [y: number, side: "a" | "b", w: number][] = [
		[10, "a", 56],
		[45, "b", 44],
		[80, "a", 50],
	]
	const picked = 45
	return (
		<Art>
			<path
				className="AboutArt-link"
				d={`M128 ${picked + 15} C 140 ${picked + 15}, 136 55, 148 55`}
			/>
			{events.map(([y, side, w]) => (
				<g key={y}>
					<rect
						className="AboutArt-surface"
						x="8"
						y={y}
						width="124"
						height="30"
						rx="6"
					/>
					<circle
						className={`AboutArt-${side}`}
						cx="24"
						cy={y + 15}
						r="5"
					/>
					<rect
						className="AboutArt-muted"
						x="36"
						y={y + 13}
						width={w}
						height="4"
						rx="2"
					/>
					{y === picked ? (
						<circle
							className="AboutArt-ink"
							cx="116"
							cy={y + 15}
							r="8"
						/>
					) : (
						<circle
							className="AboutArt-outline"
							cx="116"
							cy={y + 15}
							r="7.5"
						/>
					)}
					<path
						className={
							y === picked ? "AboutArt-on-ink" : "AboutArt-muted"
						}
						d={`M113.5 ${y + 11} L120.5 ${y + 15} L113.5 ${y + 19} Z`}
					/>
				</g>
			))}
			<rect
				className="AboutArt-ink"
				x="148"
				y="28"
				width="84"
				height="54"
				rx="6"
			/>
			<path className="AboutArt-on-ink" d="M184 46 L198 55 L184 64 Z" />
			<rect
				className="AboutArt-track"
				x="148"
				y="90"
				width="84"
				height="4"
				rx="2"
			/>
			<rect
				className="AboutArt-live"
				x="148"
				y="90"
				width="52"
				height="4"
				rx="2"
			/>
			<circle className="AboutArt-live" cx="200" cy="92" r="5" />
		</Art>
	)
}

/** Goals, assists, and penalties, newest first, each with a replay */
function ActivityArt() {
	const events: [y: number, cls: string, w: number][] = [
		[20, "AboutArt-win", 64],
		[44, "AboutArt-a", 48],
		[68, "AboutArt-warn", 72],
		[92, "AboutArt-win", 56],
	]
	return (
		<Art>
			<rect
				className="AboutArt-card"
				x="16"
				y="8"
				width="208"
				height="104"
				rx="8"
			/>
			{events.map(([y, cls, w]) => (
				<g key={y}>
					<rect
						className={cls}
						x="28"
						y={y - 5}
						width="26"
						height="10"
						rx="5"
					/>
					<rect
						className="AboutArt-muted"
						x="64"
						y={y - 2}
						width={w}
						height="4"
						rx="2"
					/>
					<rect
						className="AboutArt-track"
						x="164"
						y={y - 2}
						width="18"
						height="4"
						rx="2"
					/>
					<circle
						className="AboutArt-outline"
						cx="202"
						cy={y}
						r="7"
					/>
					<path
						className="AboutArt-muted"
						d={`M199.5 ${y - 3.5} L205.5 ${y} L199.5 ${y + 3.5} Z`}
					/>
				</g>
			))}
		</Art>
	)
}

/** Mirrored bars, like the matchup page's comparison */
function CompareArt() {
	const rows: [a: number, b: number][] = [
		[70, 50],
		[40, 84],
		[88, 30],
		[56, 62],
	]
	return (
		<Art>
			{rows.map(([a, b], i) => {
				const y = 12 + i * 26
				return (
					<g key={y}>
						<rect
							className="AboutArt-track"
							x="8"
							y={y}
							width="96"
							height="12"
							rx="3"
						/>
						<rect
							className="AboutArt-a"
							x={104 - a}
							y={y}
							width={a}
							height="12"
							rx="3"
						/>
						<rect
							className="AboutArt-muted"
							x="110"
							y={y + 4}
							width="20"
							height="4"
							rx="2"
						/>
						<rect
							className="AboutArt-track"
							x="136"
							y={y}
							width="96"
							height="12"
							rx="3"
						/>
						<rect
							className="AboutArt-b"
							x="136"
							y={y}
							width={b}
							height="12"
							rx="3"
						/>
					</g>
				)
			})}
		</Art>
	)
}

/** Three teams' stats adding up to one career */
function PlayerArt() {
	const sources: [y: number, cls: string][] = [
		[10, "AboutArt-a"],
		[49, "AboutArt-b"],
		[88, "AboutArt-win"],
	]
	return (
		<Art>
			{sources.map(([y, cls]) => (
				<g key={y}>
					<path
						className="AboutArt-link"
						d={`M82 ${y + 11} C 118 ${y + 11}, 118 60, 148 60`}
					/>
					<rect
						className="AboutArt-surface"
						x="8"
						y={y}
						width="74"
						height="22"
						rx="5"
					/>
					<rect
						className={cls}
						x="8"
						y={y}
						width="6"
						height="22"
						rx="2"
					/>
					<rect
						className="AboutArt-muted"
						x="22"
						y={y + 9}
						width="44"
						height="4"
						rx="2"
					/>
				</g>
			))}
			<rect
				className="AboutArt-card"
				x="148"
				y="22"
				width="84"
				height="76"
				rx="8"
			/>
			<circle className="AboutArt-ink" cx="166" cy="40" r="8" />
			<rect
				className="AboutArt-muted"
				x="180"
				y="38"
				width="40"
				height="4"
				rx="2"
			/>
			{[156, 182, 208].map((x) => (
				<g key={x}>
					<rect
						className="AboutArt-ink"
						x={x}
						y="58"
						width="16"
						height="12"
						rx="2"
					/>
					<rect
						className="AboutArt-track"
						x={x + 2}
						y="76"
						width="12"
						height="4"
						rx="2"
					/>
				</g>
			))}
		</Art>
	)
}

/** Goals by period and the total, one row per team */
function BoxScoreArt() {
	const columns: [x: number, label: string][] = [
		[128, "1"],
		[152, "2"],
		[176, "3"],
		[206, "T"],
	]
	const rows: [y: number, cls: string, goals: number[]][] = [
		[58, "AboutArt-a", [1, 0, 2, 3]],
		[84, "AboutArt-b", [0, 1, 1, 2]],
	]
	return (
		<Art>
			<rect
				className="AboutArt-card"
				x="20"
				y="14"
				width="200"
				height="92"
				rx="8"
			/>
			{columns.map(([x, label]) => (
				<text
					key={label}
					className="AboutArt-key"
					x={x}
					y="36"
					textAnchor="middle"
				>
					{label}
				</text>
			))}
			<rect
				className="AboutArt-track"
				x="32"
				y="44"
				width="176"
				height="1"
			/>
			{rows.map(([y, cls, goals]) => (
				<g key={y}>
					<rect
						className={cls}
						x="34"
						y={y}
						width="10"
						height="10"
						rx="2"
					/>
					<rect
						className="AboutArt-muted"
						x="52"
						y={y + 3}
						width="48"
						height="4"
						rx="2"
					/>
					{goals.map((n, i) => (
						<text
							key={i}
							className={
								i === goals.length - 1
									? "AboutArt-total"
									: "AboutArt-cell"
							}
							x={columns[i]![0]}
							y={y + 9}
							textAnchor="middle"
						>
							{n}
						</text>
					))}
				</g>
			))}
		</Art>
	)
}

/** A player's card with a row of badges */
function BadgesArt() {
	const badges: [x: number, emoji: string][] = [
		[54, "🏒"],
		[102, "💯"],
		[150, "😇"],
	]
	return (
		<Art>
			<rect
				className="AboutArt-card"
				x="36"
				y="14"
				width="168"
				height="92"
				rx="8"
			/>
			<circle className="AboutArt-ink" cx="62" cy="40" r="12" />
			<rect
				className="AboutArt-muted"
				x="82"
				y="33"
				width="72"
				height="5"
				rx="2.5"
			/>
			<rect
				className="AboutArt-track"
				x="82"
				y="44"
				width="44"
				height="4"
				rx="2"
			/>
			{badges.map(([x, emoji]) => (
				<g key={x}>
					<rect
						className="AboutArt-tile"
						x={x}
						y="64"
						width="36"
						height="30"
						rx="6"
					/>
					<text
						className="AboutArt-emoji"
						x={x + 18}
						y="85"
						textAnchor="middle"
					>
						{emoji}
					</text>
				</g>
			))}
		</Art>
	)
}

/** A map pin with a game going on */
function RinkArt() {
	return (
		<Art>
			<rect
				className="AboutArt-surface"
				x="8"
				y="4"
				width="224"
				height="112"
				rx="8"
			/>
			<path
				className="AboutArt-road"
				d="M8 84 C 70 70, 110 100, 232 66"
			/>
			<path
				className="AboutArt-road"
				d="M150 4 C 140 40, 170 80, 160 116"
			/>
			<path className="AboutArt-road" d="M8 34 L 232 28" />
			<path
				className="AboutArt-ink"
				d="M120 92 C 120 92 98 66 98 50 a22 22 0 0 1 44 0 C 142 66 120 92 120 92 Z"
			/>
			<circle className="AboutArt-on-ink" cx="120" cy="50" r="8" />
			<circle
				className="AboutArt-live AboutArt-pulse"
				cx="146"
				cy="30"
				r="6"
			/>
			<circle className="AboutArt-live" cx="146" cy="30" r="3.5" />
		</Art>
	)
}

/** The header search with a "/" key and mixed suggestions */
function SearchArt() {
	const results: [y: number, kind: string, w: number][] = [
		[56, "player", 72],
		[78, "team", 56],
		[100, "rink", 64],
	]
	return (
		<Art>
			<rect
				className="AboutArt-card"
				x="16"
				y="8"
				width="208"
				height="30"
				rx="15"
			/>
			<circle className="AboutArt-glass" cx="36" cy="22" r="6" />
			<path className="AboutArt-glass" d="M40.5 26.5 L45 31" />
			<rect
				className="AboutArt-muted"
				x="54"
				y="21"
				width="64"
				height="4"
				rx="2"
			/>
			<rect
				className="AboutArt-outline"
				x="196.5"
				y="15.5"
				width="17"
				height="15"
				rx="3"
			/>
			<text className="AboutArt-key" x="205" y="27" textAnchor="middle">
				/
			</text>
			{results.map(([y, kind, w]) => (
				<g key={y}>
					<rect
						className={`AboutArt-kind-${kind}`}
						x="24"
						y={y + 2}
						width="30"
						height="10"
						rx="5"
					/>
					<rect
						className="AboutArt-muted"
						x="66"
						y={y + 5}
						width={w}
						height="4"
						rx="2"
					/>
				</g>
			))}
		</Art>
	)
}

export const AboutRoute = {
	path: "/about",
	title: "About",
	description: `What ${STRINGS.PRODUCT_NAME} adds to the Kraken Hockey League's website.`,
	content: AboutPage,
} as const satisfies Route
