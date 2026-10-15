/** App-wide settings, shared by the server and client. */

export const STRINGS = {
	PRODUCT_NAME: "KHL+",
	/** Our game page's result: its tab, and links to it */
	GAME_RESULT: "Result",
	/** Links to the league's official scoresheet */
	KHL_SCORESHEET: "KHL Scoresheet",
	/** A finished (or past) game whose scoresheet isn't up yet */
	SCORESHEET_NOT_POSTED:
		"The league hasn't posted a scoresheet for this game yet.",
}

export const URLS = {
	/** The league's site, which every page and stat is scraped from */
	KHL: "https://krakenhockeyleague.com",
	/** Our own domain, for canonical and og:url tags; empty until we have one */
	WEBSITE_DOMAIN: "",
}

export const LEAGUE = {
	/** The league is in Seattle; schedule times are listed in local time. */
	TIME_ZONE: "America/Los_Angeles",
	/**
	 * The schedule only lists start times. Adult league ice slots run about an
	 * hour and a quarter including warmup, so a game counts as "now" for that
	 * long.
	 */
	GAME_DURATION_MINUTES: 75,
}

export const LIMITS = {
	/**
	 * Some teams go back dozens of seasons, and each season is a page fetch, so
	 * only the most recent seasons both teams played are searched.
	 */
	HEAD_TO_HEAD_SEASONS: 10,
	/** How many results a game page's "Last 5" form shows */
	GAME_RECENT_GAMES: 5,
	/** How many results a matchup's "Last 10" form shows */
	MATCHUP_RECENT_GAMES: 10,
	/** How many of a season's meetings a matchup's head-to-head row shows */
	MATCHUP_HEAD_TO_HEAD_GAMES: 5,
}
