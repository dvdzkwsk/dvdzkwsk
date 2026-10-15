import {z} from "zod"

export interface KHLSeason {
	id: string
	name: string
}

export const KHLSeasonSchema = z.object({
	id: z.string(),
	name: z.string(),
}) satisfies z.ZodType<KHLSeason>

export interface KHLDivision {
	id: string
	name: string
	seasonId: string
}

export const KHLDivisionSchema = z.object({
	id: z.string(),
	name: z.string(),
	seasonId: z.string(),
}) satisfies z.ZodType<KHLDivision>

export interface KHLTeam {
	id: string
	name: string
	seasonId: string
	divisionId: string
	logoUrl: string | null
}

export const KHLTeamSchema = z.object({
	id: z.string(),
	name: z.string(),
	seasonId: z.string(),
	divisionId: z.string(),
	logoUrl: z.url().nullable(),
}) satisfies z.ZodType<KHLTeam>

export interface KHLTeamsPage {
	season: KHLSeason
	seasons: KHLSeason[]
	divisions: KHLDivision[]
	teams: KHLTeam[]
}

export const KHLTeamsPageSchema = z.object({
	season: KHLSeasonSchema,
	seasons: z.array(KHLSeasonSchema),
	divisions: z.array(KHLDivisionSchema),
	teams: z.array(KHLTeamSchema),
}) satisfies z.ZodType<KHLTeamsPage>

/** One row of /player-search: a player's registration on a single team. */
export interface KHLPlayerSearchResult {
	playerId: string
	name: string
	position: string | null
	teamId: string
	teamName: string
	teamLogoUrl: string | null
	seasonId: string
}

export const KHLPlayerSearchResultSchema = z.object({
	playerId: z.string(),
	name: z.string(),
	position: z.string().nullable(),
	teamId: z.string(),
	teamName: z.string(),
	teamLogoUrl: z.url().nullable(),
	seasonId: z.string(),
}) satisfies z.ZodType<KHLPlayerSearchResult>

export interface KHLStat {
	label: string
	value: string
	/** e.g. the date a career high was set */
	note: string | null
}

export const KHLStatSchema = z.object({
	label: z.string(),
	value: z.string(),
	note: z.string().nullable(),
}) satisfies z.ZodType<KHLStat>

/** A titled group of stat cards, e.g. the current season or "Career Stats". */
export interface KHLStatSection {
	title: string
	stats: KHLStat[]
}

export const KHLStatSectionSchema = z.object({
	title: z.string(),
	stats: z.array(KHLStatSchema),
}) satisfies z.ZodType<KHLStatSection>

export interface KHLSeasonStatsRow {
	seasonId: string
	seasonName: string
	teamId: string
	teamName: string
	/** Remaining columns keyed by header, e.g. {Division: "5B", GP: "11"} */
	stats: Record<string, string>
}

export const KHLSeasonStatsRowSchema = z.object({
	seasonId: z.string(),
	seasonName: z.string(),
	teamId: z.string(),
	teamName: z.string(),
	stats: z.record(z.string(), z.string()),
}) satisfies z.ZodType<KHLSeasonStatsRow>

/** A season-by-season table, e.g. "Regular Season" or "Playoffs". */
export interface KHLSeasonStatsTable {
	title: string
	columns: string[]
	rows: KHLSeasonStatsRow[]
}

export const KHLSeasonStatsTableSchema = z.object({
	title: z.string(),
	columns: z.array(z.string()),
	rows: z.array(KHLSeasonStatsRowSchema),
}) satisfies z.ZodType<KHLSeasonStatsTable>

export interface KHLPlayer {
	playerId: string
	teamId: string
	seasonId: string
	name: string
	number: string | null
	position: string | null
	/** e.g. "Brewzers OGB - Division 5B" */
	teamLine: string | null
	statSections: KHLStatSection[]
	seasonTables: KHLSeasonStatsTable[]
}

export const KHLPlayerSchema = z.object({
	playerId: z.string(),
	teamId: z.string(),
	seasonId: z.string(),
	name: z.string(),
	number: z.string().nullable(),
	position: z.string().nullable(),
	teamLine: z.string().nullable(),
	statSections: z.array(KHLStatSectionSchema),
	seasonTables: z.array(KHLSeasonStatsTableSchema),
}) satisfies z.ZodType<KHLPlayer>

export interface KHLArenaRef {
	id: string
	name: string
}

export const KHLArenaRefSchema = z.object({
	id: z.string(),
	name: z.string(),
}) satisfies z.ZodType<KHLArenaRef>

/** From /arena/:id */
export interface KHLArena {
	id: string
	name: string
	address: string | null
}

export const KHLArenaSchema = z.object({
	id: z.string(),
	name: z.string(),
	address: z.string().nullable(),
}) satisfies z.ZodType<KHLArena>

export interface KHLTeamRef {
	id: string
	name: string
}

export const KHLTeamRefSchema = z.object({
	id: z.string(),
	name: z.string(),
}) satisfies z.ZodType<KHLTeamRef>

export type KHLHomeAway = "home" | "away"

export interface KHLLeagueTeam {
	id: string
	name: string
	logoUrl: string | null
}

export const KHLLeagueTeamSchema = z.object({
	id: z.string(),
	name: z.string(),
	logoUrl: z.url().nullable(),
}) satisfies z.ZodType<KHLLeagueTeam>

/** A game from the league-wide schedule (/schedule), which lists upcoming games. */
export interface KHLLeagueGame {
	id: string
	/** League-local (Pacific) calendar date, "yyyy-MM-dd" */
	localDate: string
	/** League-local (Pacific) start time, "HH:mm" */
	localTime: string
	/** Start time as an ISO 8601 UTC instant */
	startsAt: string
	arena: KHLArenaRef | null
	homeTeam: KHLLeagueTeam
	awayTeam: KHLLeagueTeam
}

export const KHLLeagueGameSchema = z.object({
	id: z.string(),
	localDate: z.iso.date(),
	localTime: z.string().regex(/^\d{2}:\d{2}$/),
	startsAt: z.iso.datetime(),
	arena: KHLArenaRefSchema.nullable(),
	homeTeam: KHLLeagueTeamSchema,
	awayTeam: KHLLeagueTeamSchema,
}) satisfies z.ZodType<KHLLeagueGame>

/** A game from one team's point of view, as listed on its schedule. */
export interface KHLGame {
	/** Missing for some finished games the league never linked */
	id: string | null
	seasonId: string
	team: KHLTeamRef
	opponent: KHLTeamRef
	homeAway: KHLHomeAway
	/** League-local (Pacific) calendar date, "yyyy-MM-dd" */
	localDate: string
	/** League-local (Pacific) start time, "HH:mm" */
	localTime: string
	/** Start time as an ISO 8601 UTC instant */
	startsAt: string
	arena: KHLArenaRef | null
	/** "W", "L", "T", ... once the game is final */
	result: string | null
	/** As displayed by the league, e.g. "7 - 5" */
	score: string | null
	isFinal: boolean
}

export const KHLGameSchema = z.object({
	id: z.string().nullable(),
	seasonId: z.string(),
	team: KHLTeamRefSchema,
	opponent: KHLTeamRefSchema,
	homeAway: z.enum(["home", "away"]),
	localDate: z.iso.date(),
	localTime: z.string().regex(/^\d{2}:\d{2}$/),
	startsAt: z.iso.datetime(),
	arena: KHLArenaRefSchema.nullable(),
	result: z.string().nullable(),
	score: z.string().nullable(),
	isFinal: z.boolean(),
}) satisfies z.ZodType<KHLGame>

/** One row of a team's stats page: a player and their numbers that season. */
export interface KHLRosterRow {
	playerId: string
	number: string | null
	name: string
	/** Keyed by the league's column headers, e.g. {GP: "4", G: "3"} */
	stats: Record<string, string>
}

export const KHLRosterRowSchema = z.object({
	playerId: z.string(),
	number: z.string().nullable(),
	name: z.string(),
	stats: z.record(z.string(), z.string()),
}) satisfies z.ZodType<KHLRosterRow>

/** /team/:id/stats: the season's roster with stats, and every season the team played. */
export interface KHLTeamStats {
	teamId: string
	seasonId: string
	/** Every season the team has played, newest first */
	seasons: KHLSeason[]
	skaterColumns: string[]
	skaters: KHLRosterRow[]
	goalieColumns: string[]
	goalies: KHLRosterRow[]
}

export const KHLTeamStatsSchema = z.object({
	teamId: z.string(),
	seasonId: z.string(),
	seasons: z.array(KHLSeasonSchema),
	skaterColumns: z.array(z.string()),
	skaters: z.array(KHLRosterRowSchema),
	goalieColumns: z.array(z.string()),
	goalies: z.array(KHLRosterRowSchema),
}) satisfies z.ZodType<KHLTeamStats>

/** One row of a division's standings table. */
export interface KHLStandingsRow {
	teamId: string
	teamName: string
	logoUrl: string | null
	/** Keyed by the league's column headers, e.g. {GP: "7", PTS: "10"} */
	stats: Record<string, string>
}

export const KHLStandingsRowSchema = z.object({
	teamId: z.string(),
	teamName: z.string(),
	logoUrl: z.url().nullable(),
	stats: z.record(z.string(), z.string()),
}) satisfies z.ZodType<KHLStandingsRow>

export interface KHLStandingsDivision {
	name: string
	/** Stat columns after rank and team, e.g. ["GP", "W", "L", ...] */
	columns: string[]
	/** By rank */
	rows: KHLStandingsRow[]
}

export const KHLStandingsDivisionSchema = z.object({
	name: z.string(),
	columns: z.array(z.string()),
	rows: z.array(KHLStandingsRowSchema),
}) satisfies z.ZodType<KHLStandingsDivision>

/** /standings: every division's table for one season. */
export interface KHLStandingsPage {
	season: KHLSeason
	/** Every league season, newest first */
	seasons: KHLSeason[]
	/** In the league's order */
	divisions: KHLStandingsDivision[]
}

export const KHLStandingsPageSchema = z.object({
	season: KHLSeasonSchema,
	seasons: z.array(KHLSeasonSchema),
	divisions: z.array(KHLStandingsDivisionSchema),
}) satisfies z.ZodType<KHLStandingsPage>

export interface KHLPlayerRef {
	/** KHL player id: one registration on one team */
	id: string
	name: string
}

export const KHLPlayerRefSchema = z.object({
	id: z.string(),
	name: z.string(),
}) satisfies z.ZodType<KHLPlayerRef>

/** One side of a game summary, with per-period goals and shots. */
export interface KHLBoxScoreTeam {
	id: string
	name: string
	logoUrl: string | null
	/** The season the game's team links point at */
	seasonId: string
	/** Parallel to KHLBoxScore.periods; empty until the summary is posted */
	goalsByPeriod: number[]
	goals: number | null
	shotsByPeriod: number[]
	shots: number | null
}

export const KHLBoxScoreTeamSchema = z.object({
	id: z.string(),
	name: z.string(),
	logoUrl: z.url().nullable(),
	seasonId: z.string(),
	goalsByPeriod: z.array(z.number()),
	goals: z.number().nullable(),
	shotsByPeriod: z.array(z.number()),
	shots: z.number().nullable(),
}) satisfies z.ZodType<KHLBoxScoreTeam>

export interface KHLGoal {
	/** As labelled by the league, e.g. "1st", "OT" */
	period: string
	/** Clock time remaining in the period, e.g. "16:16" */
	time: string
	teamId: string
	scorer: KHLPlayerRef
	/** The scorer's season goal total after this goal */
	scorerSeasonGoals: number | null
	assists: KHLPlayerRef[]
	/** "PPG", "SHG", ... or null at even strength */
	type: string | null
}

export const KHLGoalSchema = z.object({
	period: z.string(),
	time: z.string(),
	teamId: z.string(),
	scorer: KHLPlayerRefSchema,
	scorerSeasonGoals: z.number().nullable(),
	assists: z.array(KHLPlayerRefSchema),
	type: z.string().nullable(),
}) satisfies z.ZodType<KHLGoal>

export interface KHLPenalty {
	period: string
	/** Clock time remaining in the period */
	time: string
	teamId: string
	/** Null for bench penalties */
	player: KHLPlayerRef | null
	infraction: string
	/** e.g. "2:00" */
	duration: string
}

export const KHLPenaltySchema = z.object({
	period: z.string(),
	time: z.string(),
	teamId: z.string(),
	player: KHLPlayerRefSchema.nullable(),
	infraction: z.string(),
	duration: z.string(),
}) satisfies z.ZodType<KHLPenalty>

/** /game/:id/summary */
export interface KHLBoxScore {
	gameId: string
	/** League-local (Pacific) calendar date, "yyyy-MM-dd" */
	localDate: string
	/** League-local (Pacific) start time, "HH:mm" */
	localTime: string
	/** Start time as an ISO 8601 UTC instant */
	startsAt: string
	arena: KHLArenaRef | null
	away: KHLBoxScoreTeam
	home: KHLBoxScoreTeam
	/** False until the league posts the game's summary */
	hasSummary: boolean
	/** Period column headers, e.g. ["1", "2", "3"] */
	periods: string[]
	/** In game order */
	goals: KHLGoal[]
	/** In game order */
	penalties: KHLPenalty[]
}

export const KHLBoxScoreSchema = z.object({
	gameId: z.string(),
	localDate: z.iso.date(),
	localTime: z.string().regex(/^\d{2}:\d{2}$/),
	startsAt: z.iso.datetime(),
	arena: KHLArenaRefSchema.nullable(),
	away: KHLBoxScoreTeamSchema,
	home: KHLBoxScoreTeamSchema,
	hasSummary: z.boolean(),
	periods: z.array(z.string()),
	goals: z.array(KHLGoalSchema),
	penalties: z.array(KHLPenaltySchema),
}) satisfies z.ZodType<KHLBoxScore>
