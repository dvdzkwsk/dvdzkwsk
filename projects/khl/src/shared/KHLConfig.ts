/** App-wide settings, shared by the server and client. */

export const STRINGS = {
	PRODUCT_NAME: "KHL+",
	/** The header logo's text; the mark after it is the "+" */
	LOGO_TEXT: "KHL",
	/** The game page's view toggle */
	GAME_PREVIEW: "Game Preview",
	GAME_RESULT: "Game Result",
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
	/** The repo this site's code lives in; commits link here */
	GITHUB_REPO: "https://github.com/dvdzkwsk/dvdzkwsk",
	/** This site's source code, linked from the footer */
	GITHUB: "https://github.com/dvdzkwsk/dvdzkwsk/tree/master/projects/khl",
	/** Google Form for help requests and feedback, linked from the footer */
	FEEDBACK_FORM:
		"https://docs.google.com/forms/d/e/1FAIpQLScmYQDDkokzGcqSw1TkNqoJI0l6LXKZQmVh5L6YEbN5sOvnwg/viewform?usp=publish-editor",
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
	/**
	 * Three 18-minute periods: the first two on a running clock, the third
	 * (and overtime) on stop time. Used to place scoresheet events in a
	 * LiveBarn recording.
	 */
	PERIOD_MINUTES: 18,
	/**
	 * Estimated time from the scheduled start to puck drop. The league only
	 * publishes scheduled starts, not when a game actually started.
	 */
	WARMUP_MINUTES: 3,
	/** Estimated time between periods; teams just change ends */
	INTERMISSION_MINUTES: 1,
	/** Periods from this one on (the 3rd, then overtime) run on stop time */
	FIRST_STOP_TIME_PERIOD: 3,
	/**
	 * Estimated wall-clock minutes per minute on a stop-time clock, which
	 * stops for whistles, penalties, and goals. A guess (about 15s of
	 * stoppage per minute) to tune against real recordings.
	 */
	STOP_TIME_FACTOR: 1.25,
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
	/**
	 * How many days of a player's games, back from their latest, the Angel and
	 * Devil badges judge
	 */
	BADGE_TREND_LOOKBACK_DAYS: 365,
	/** The fewest games in that window for the Angel or Devil badge */
	BADGE_TREND_MIN_GAMES: 10,
	/** How many goals, assists, and penalties an activity feed shows */
	ACTIVITY_EVENTS: 10,
	/**
	 * How many days of a player's or team's games, back from their latest, an
	 * activity feed reads; a quiet player may have fewer events than that.
	 */
	ACTIVITY_MAX_LOOKBACK_DAYS: 180,
}
