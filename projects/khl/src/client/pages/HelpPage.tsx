import * as React from "react"
import {STRINGS, URLS} from "../../shared/KHLConfig.js"
import {Link, PageShell} from "../Components.js"
import {getAchievementsHref, Route} from "../Util.js"

// --- /help: a table of contents, then every FAQ answer

interface Question {
	/** The anchor the table of contents links to */
	id: string
	question: string
	answer: React.ReactNode
}

const LEAGUE_HOST = new URL(URLS.KHL).host

/** Plain anchors, so the browser scrolls to the question */
const QuestionLink = ({id, children}: {id: string; children: string}) => {
	return <a href={`#${id}`}>{children}</a>
}

const FAQ: Question[] = [
	{
		id: "official",
		question: `Is ${STRINGS.PRODUCT_NAME} official?`,
		answer: (
			<p>
				No. It's run independently of the Kraken Hockey League. Every
				schedule, score, and stat comes from{" "}
				<Link href={URLS.KHL}>{LEAGUE_HOST} ↗</Link>, which is the
				official record.
			</p>
		),
	},
	{
		id: "career-stats",
		question: "How do I see my career stats?",
		answer: (
			<p>
				Search for your name (press <code>/</code> from any page) and
				open your player page. It combines every team and season you've
				played, and the team picker narrows it to one.
			</p>
		),
	},
	{
		id: "duplicate-players",
		question: "Why do I see the same player twice (or more)?",
		answer: (
			<>
				<p>
					The league gives a player a new ID for every team they
					register with, so {STRINGS.PRODUCT_NAME} combines them by
					name. If a player registered under different spellings (say,
					"Mike" one season and "Michael" the next), they show up as
					separate players.
				</p>
				<p>
					It can go the other way too: two people with the same name
					can end up combined. Either way,{" "}
					<Link href={URLS.FEEDBACK_FORM}>let us know ↗</Link> with
					links to the player pages and we'll merge or split them.
				</p>
			</>
		),
	},
	{
		id: "achievements",
		question: "What are achievements, and how do I get one?",
		answer: (
			<p>
				Achievements show on player pages. Most are earned automatically
				from career stats, like playing your first game, and a few are
				awarded by hand. See them all, or suggest or request one, on the{" "}
				<Link href={getAchievementsHref()}>Achievements page</Link>.
			</p>
		),
	},
	{
		id: "livebarn-in-khl-plus",
		question: `Why can't I see the LiveBarn feed directly in ${STRINGS.PRODUCT_NAME}?`,
		answer: (
			<>
				<p>
					LiveBarn doesn't allow its video player to be embedded on
					other sites, so {STRINGS.PRODUCT_NAME} can't play the feed
					itself.
				</p>
				<p>
					Instead, every LiveBarn link opens watch.livebarn.com on the
					right rink, and for finished games, at the game's start
					time. You'll need to be signed in to a LiveBarn subscription
					to watch.
				</p>
			</>
		),
	},
	{
		id: "missing-livebarn-link",
		question: "Why doesn't my location have a LiveBarn link?",
		answer: (
			<p>
				Not every location is on LiveBarn. For those that are,{" "}
				{STRINGS.PRODUCT_NAME} only links a feed when it can match it to
				the right location and sheet of ice, so a link never opens the
				wrong game.
			</p>
		),
	},
	{
		id: "missing-scoresheet",
		question: "Why is a finished game missing its goals and stats?",
		answer: (
			<p>
				The league posts scoresheets after the game, sometimes hours
				later. {STRINGS.PRODUCT_NAME} shows the final score as soon as
				the league's scoreboard has it, then fills in goals, penalties
				and stats once the scoresheet is up.
			</p>
		),
	},
	{
		id: "stats-dont-match",
		question: "Why doesn't a score or stat match the league's site?",
		answer: (
			<p>
				{STRINGS.PRODUCT_NAME} rechecks the league's site every few
				minutes: today's scores about every 5 minutes, most other pages
				every 10. If something still looks wrong after that,{" "}
				<Link href={URLS.FEEDBACK_FORM}>let us know ↗</Link>.
			</p>
		),
	},
	{
		id: "report-a-problem",
		question: "How do I report a problem or send feedback?",
		answer: (
			<>
				<p>
					Fill out the{" "}
					<Link href={URLS.FEEDBACK_FORM}>feedback form ↗</Link>.
					Bugs, wrong stats, and ideas are all welcome.
				</p>
				<p>
					For a problem, include a link to the page and what you
					expected to see. It makes it much faster to track down.
				</p>
			</>
		),
	},
]

const HelpPage = () => {
	return (
		<PageShell>
			<div className="HelpPage">
				<header className="HelpPage-hero">
					<h1 className="HelpPage-title">Help & feedback</h1>
					<p className="HelpPage-lede">
						Answers to common questions. Something else?{" "}
						<Link href={URLS.FEEDBACK_FORM}>
							Report a problem ↗
						</Link>
						.
					</p>
				</header>

				<nav className="HelpPage-toc" aria-labelledby="help-toc-title">
					<h2 id="help-toc-title" className="SectionLabel">
						Frequently asked questions
					</h2>
					<ol className="HelpPage-toc-list">
						{FAQ.map(({id, question}) => (
							<li key={id}>
								<QuestionLink id={id}>{question}</QuestionLink>
							</li>
						))}
					</ol>
				</nav>

				<div className="HelpPage-faq">
					{FAQ.map(({id, question, answer}) => (
						<section key={id} id={id} className="HelpPage-item">
							<h2 className="HelpPage-question">{question}</h2>
							<div className="HelpPage-answer">{answer}</div>
						</section>
					))}
				</div>
			</div>
		</PageShell>
	)
}

export const HelpRoute = {
	path: "/help",
	title: "Help",
	description: `Answers to common questions about ${STRINGS.PRODUCT_NAME}, and how to send feedback.`,
	content: HelpPage,
} as const satisfies Route
