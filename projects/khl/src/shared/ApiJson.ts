import {ApiEndpoint, ApiRequest} from "@dvdzkwsk/util/ApiUtil"
import {z} from "zod"
import {LIMITS} from "./KHLConfig.js"
import {
	KHLArenaRef,
	KHLArenaRefSchema,
	KHLBoxScore,
	KHLBoxScoreSchema,
	KHLBoxScoreTeamSchema,
	KHLGame,
	KHLGamePreviewStats,
	KHLGamePreviewStatsSchema,
	KHLGameSchema,
	KHLGoal,
	KHLGoalSchema,
	KHLHomeAway,
	KHLHomeAwaySchema,
	KHLPenalty,
	KHLPenaltySchema,
	KHLPlayer,
	KHLPlayerSchema,
	KHLPlayerSearchResult,
	KHLPlayerSearchResultSchema,
	KHLSeason,
	KHLSeasonSchema,
	KHLStandingsDivision,
	KHLStandingsDivisionSchema,
	KHLTeam,
	KHLTeamRef,
	KHLTeamRefSchema,
	KHLTeamSchema,
	getGoalsByTeam,
} from "./KHLJson.js"
import {getDaysBetween} from "./LeagueTime.js"

/**
 * KHL has no person-level id: every team registration gets its own player id.
 * We assign each person a UUID (see Database.ts) and group results by it.
 */
export interface PlayerSearchGroup {
	/** Our player UUID */
	playerId: string
	name: string
	registrations: KHLPlayerSearchResult[]
}

export const PlayerSearchGroupSchema = z.object({
	playerId: z.uuid(),
	name: z.string(),
	registrations: z.array(KHLPlayerSearchResultSchema),
}) satisfies z.ZodType<PlayerSearchGroup>

export interface TeamSearchResult {
	team: KHLTeam
	divisionName: string
}

export const TeamSearchResultSchema = z.object({
	team: KHLTeamSchema,
	divisionName: z.string(),
}) satisfies z.ZodType<TeamSearchResult>

export interface RinkSearchResult {
	/** KHL arena id */
	arenaId: string
	name: string
	/** Id into CITIES (shared/Cities.ts) */
	city: string
}

export const RinkSearchResultSchema = z.object({
	arenaId: z.string(),
	name: z.string(),
	city: z.string(),
}) satisfies z.ZodType<RinkSearchResult>

export interface SearchResponse {
	season: KHLSeason
	players: PlayerSearchGroup[]
	teams: TeamSearchResult[]
	/** Matched by rink name or city */
	rinks: RinkSearchResult[]
}

export const SearchResponseSchema = z.object({
	season: KHLSeasonSchema,
	players: z.array(PlayerSearchGroupSchema),
	teams: z.array(TeamSearchResultSchema),
	rinks: z.array(RinkSearchResultSchema),
}) satisfies z.ZodType<SearchResponse>

export interface LiveBarnLink {
	surfaceId: number
	venueName: string
	surfaceName: string
	liveUrl: string
	/** Deep link to the recording at the game's start time */
	vodUrl: string
}

export const LiveBarnLinkSchema = z.object({
	surfaceId: z.number(),
	venueName: z.string(),
	surfaceName: z.string(),
	liveUrl: z.url(),
	vodUrl: z.url(),
}) satisfies z.ZodType<LiveBarnLink>

export interface FeedGame {
	game: KHLGame
	/** From the season's teams page; null if that page failed or has none */
	opponentLogoUrl: string | null
	/** Empty when the arena isn't on LiveBarn */
	livebarn: LiveBarnLink[]
}

export const FeedGameSchema = z.object({
	game: KHLGameSchema,
	opponentLogoUrl: z.url().nullable(),
	livebarn: z.array(LiveBarnLinkSchema),
}) satisfies z.ZodType<FeedGame>

/** The player on one team, across seasons, under one KHL player id. */
export interface PlayerRegistration {
	khlPlayerId: string
	teamId: string
	teamName: string
	teamLogoUrl: string | null
	/** Oldest first */
	seasonIds: string[]
	/** KHL's profile as of the latest season; null if the KHL page failed */
	profile: KHLPlayer | null
}

export const PlayerRegistrationSchema = z.object({
	khlPlayerId: z.string(),
	teamId: z.string(),
	teamName: z.string(),
	teamLogoUrl: z.url().nullable(),
	seasonIds: z.array(z.string()),
	profile: KHLPlayerSchema.nullable(),
}) satisfies z.ZodType<PlayerRegistration>

/** A team's season whose KHL schedule page failed to load */
export interface UnavailableSchedule {
	teamId: string
	teamName: string
	seasonId: string
	seasonName: string | null
}

export const UnavailableScheduleSchema = z.object({
	teamId: z.string(),
	teamName: z.string(),
	seasonId: z.string(),
	seasonName: z.string().nullable(),
}) satisfies z.ZodType<UnavailableSchedule>

export interface RinkTeam {
	id: string
	name: string
	logoUrl: string | null
	/** Current-season division, if the team is listed on the teams page */
	divisionName: string | null
}

export const RinkTeamSchema = z.object({
	id: z.string(),
	name: z.string(),
	logoUrl: z.url().nullable(),
	divisionName: z.string().nullable(),
}) satisfies z.ZodType<RinkTeam>

export interface RinkGame {
	gameId: string
	/** ISO 8601 UTC instant */
	startsAt: string
	homeTeam: RinkTeam
	awayTeam: RinkTeam
	/** The final score, once the league posts it; upcoming games have none */
	score?: {away: number; home: number} | null
}

export const RinkGameSchema = z.object({
	gameId: z.string(),
	startsAt: z.iso.datetime(),
	homeTeam: RinkTeamSchema,
	awayTeam: RinkTeamSchema,
	score: z.object({away: z.number(), home: z.number()}).nullish(),
}) satisfies z.ZodType<RinkGame>

export interface RinkLiveBarnSurface {
	surfaceId: number
	surfaceName: string
	liveUrl: string
}

export const RinkLiveBarnSurfaceSchema = z.object({
	surfaceId: z.number(),
	surfaceName: z.string(),
	liveUrl: z.url(),
}) satisfies z.ZodType<RinkLiveBarnSurface>

export interface RinkInfo {
	/** KHL arena id */
	arenaId: string
	name: string
	/** Id into CITIES (shared/Cities.ts) */
	city: string
	/** Empty when the rink isn't on LiveBarn */
	livebarn: RinkLiveBarnSurface[]
}

export const RinkInfoSchema = z.object({
	arenaId: z.string(),
	name: z.string(),
	city: z.string(),
	livebarn: z.array(RinkLiveBarnSurfaceSchema),
}) satisfies z.ZodType<RinkInfo>

export interface Rink extends RinkInfo {
	/** Today's and upcoming games, soonest first. The client decides which
	    one is in progress so cards update without refetching. */
	games: RinkGame[]
}

export const RinkSchema = RinkInfoSchema.extend({
	games: z.array(RinkGameSchema),
}) satisfies z.ZodType<Rink>

/** A league-schedule game and the rink it's at, for game cards. */
export interface UpcomingGame {
	rink: RinkInfo
	game: RinkGame
}

export const UpcomingGameSchema = z.object({
	rink: RinkInfoSchema,
	game: RinkGameSchema,
}) satisfies z.ZodType<UpcomingGame>

export interface RosterPlayer {
	/** Our player UUID */
	playerId: string
	khlPlayerId: string
	number: string | null
	name: string
	/** Keyed by the league's column headers */
	stats: Record<string, string>
}

export const RosterPlayerSchema = z.object({
	playerId: z.uuid(),
	khlPlayerId: z.string(),
	number: z.string().nullable(),
	name: z.string(),
	stats: z.record(z.string(), z.string()),
}) satisfies z.ZodType<RosterPlayer>

export interface TeamRoster {
	skaterColumns: string[]
	skaters: RosterPlayer[]
	goalieColumns: string[]
	goalies: RosterPlayer[]
}

export const TeamRosterSchema = z.object({
	skaterColumns: z.array(z.string()),
	skaters: z.array(RosterPlayerSchema),
	goalieColumns: z.array(z.string()),
	goalies: z.array(RosterPlayerSchema),
}) satisfies z.ZodType<TeamRoster>

/** One side of a game in an activity feed */
export interface ActivityTeam {
	id: string
	name: string
	logoUrl: string | null
	/** The season the game's team links point at */
	seasonId: string
	/** Final goals, or null until the summary is posted */
	goals: number | null
}

export const ActivityTeamSchema = KHLBoxScoreTeamSchema.pick({
	id: true,
	name: true,
	logoUrl: true,
	seasonId: true,
	goals: true,
}) satisfies z.ZodType<ActivityTeam>

/**
 * A goal, assist, or penalty in an activity feed. "assist" is only in a
 * player's feed, for someone else's goal they assisted on.
 */
export type ActivityEvent =
	| {kind: "goal" | "assist"; goal: KHLGoal}
	| {kind: "penalty"; penalty: KHLPenalty}

export const ActivityEventSchema = z.union([
	z.object({kind: z.enum(["goal", "assist"]), goal: KHLGoalSchema}),
	z.object({kind: z.literal("penalty"), penalty: KHLPenaltySchema}),
]) satisfies z.ZodType<ActivityEvent>

/**
 * Whether a player dressed for a game. A team always played its own games, and
 * a game whose lineup isn't posted yet counts as played.
 */
export type ActivityAttendance = "played" | "skipped"

export const ActivityAttendanceSchema = z.enum([
	"played",
	"skipped",
]) satisfies z.ZodType<ActivityAttendance>

/**
 * What an activity request asks for: events ("goal", "assist", "penalty")
 * pick a game's events, and attendance ("played", "skipped") includes a game
 * by attendance alone, even with no events. A game is in the response if it
 * has a requested event or a requested attendance.
 */
export type ActivityKind = ActivityEvent["kind"] | ActivityAttendance

export const ActivityKindSchema = z.enum([
	"goal",
	"assist",
	"penalty",
	"played",
	"skipped",
]) satisfies z.ZodType<ActivityKind>

/** The feed: events only */
export const DEFAULT_ACTIVITY_KINDS: ActivityKind[] = [
	"goal",
	"assist",
	"penalty",
]

/** `kinds`: a list, sent in the query string as "goal,penalty" */
const ActivityKindsSchema = z.preprocess(
	(value) => (typeof value === "string" ? value.split(",") : value),
	z.array(ActivityKindSchema).min(1),
)

/** A game in an activity feed, and the player's or team's events in it */
export interface ActivityGame {
	gameId: string
	/** Start time as an ISO 8601 UTC instant */
	startsAt: string
	homeAway: KHLHomeAway
	/** The team itself, or the player's team in this game */
	team: ActivityTeam
	opponent: ActivityTeam
	/** The rink's LiveBarn surfaces; empty when it isn't on LiveBarn */
	livebarn: LiveBarnLink[]
	attendance: ActivityAttendance
	/** Latest first; always empty for a skipped game */
	events: ActivityEvent[]
}

export const ActivityGameSchema = z.object({
	gameId: z.string(),
	startsAt: z.iso.datetime(),
	homeAway: KHLHomeAwaySchema,
	team: ActivityTeamSchema,
	opponent: ActivityTeamSchema,
	livebarn: z.array(LiveBarnLinkSchema),
	attendance: ActivityAttendanceSchema,
	events: z.array(ActivityEventSchema),
}) satisfies z.ZodType<ActivityGame>

/**
 * A player's or team's games with the requested kinds, from the requested
 * days before their latest game, and at most the requested number of events
 * (see ActivityOptions)
 */
export interface ActivityResponse {
	/** Newest first */
	games: ActivityGame[]
	/** Our player UUID for each KHL player id named in `games` */
	playerIds: Record<string, string>
}

export const ActivityResponseSchema = z.object({
	games: z.array(ActivityGameSchema),
	playerIds: z.record(z.string(), z.uuid()),
}) satisfies z.ZodType<ActivityResponse>

export interface PlayerResponse {
	/** Our player UUID */
	playerId: string
	name: string
	currentSeason: KHLSeason
	/** Most recently active first */
	registrations: PlayerRegistration[]
	/** Every game for every team and season the player was on, oldest first */
	games: FeedGame[]
	/** Seasons missing from `games` because the KHL site errored */
	unavailableSchedules: UnavailableSchedule[]
	/** League-schedule games for the player's current teams, soonest first */
	upcoming: UpcomingGame[]
}

export const PlayerResponseSchema = z.object({
	playerId: z.uuid(),
	name: z.string(),
	currentSeason: KHLSeasonSchema,
	registrations: z.array(PlayerRegistrationSchema),
	games: z.array(FeedGameSchema),
	unavailableSchedules: z.array(UnavailableScheduleSchema),
	upcoming: z.array(UpcomingGameSchema),
}) satisfies z.ZodType<PlayerResponse>

export interface TeamResponse {
	team: KHLTeam
	divisionName: string
	/** The season being shown */
	season: KHLSeason
	/** Every season the team has played, newest first */
	seasons: KHLSeason[]
	/** Oldest first */
	games: FeedGame[]
	/** League-schedule games, soonest first; empty for past seasons */
	upcoming: UpcomingGame[]
	roster: TeamRoster
}

export const TeamResponseSchema = z.object({
	team: KHLTeamSchema,
	divisionName: z.string(),
	season: KHLSeasonSchema,
	seasons: z.array(KHLSeasonSchema),
	games: z.array(FeedGameSchema),
	upcoming: z.array(UpcomingGameSchema),
	roster: TeamRosterSchema,
}) satisfies z.ZodType<TeamResponse>

export interface SearchRequest {
	q: string
}

export const SearchRequestSchema = z.object({
	q: z.string().describe("At least 2 characters"),
}) satisfies z.ZodType<SearchRequest>

export const SEARCH_ENDPOINT = {
	method: "GET",
	uri: "/api/search",
	name: "Search",
	description:
		"Players, teams, and rinks in the current season whose names contain `q`, ignoring case. Rinks also match by city. A `q` shorter than 2 characters returns empty lists.",
	exampleRequest: {q: "flamingos"},
	requestSchema: SearchRequestSchema,
	responseSchema: SearchResponseSchema,
} satisfies ApiEndpoint<SearchRequest, SearchResponse>

export interface GetPlayerRequest {
	playerId: string
}

export const GetPlayerRequestSchema = z.object({
	playerId: z
		.uuid()
		.describe("KHL+'s player id (not the KHL's), from search or a roster"),
}) satisfies z.ZodType<GetPlayerRequest>

export const GET_PLAYER_ENDPOINT = {
	method: "GET",
	uri: "/api/players/:playerId",
	name: "Get player details",
	description:
		"A player's profile and every game they've played, across all of their teams and seasons, plus upcoming games for their current teams. The KHL usually issues a new player id for every team registration (though one id can span several teams); `playerId` is KHL+'s own id for the person, from search results and rosters.",
	exampleRequest: {playerId: "1f4d54d9-8b87-4b49-8880-04cd9497ef92"},
	requestSchema: GetPlayerRequestSchema,
	responseSchema: PlayerResponseSchema,
} satisfies ApiEndpoint<GetPlayerRequest, PlayerResponse>

/** What a player's or team's activity request asks for */
export interface ActivityOptions {
	/** Defaults to DEFAULT_ACTIVITY_KINDS */
	kinds?: ActivityKind[]
	/** Defaults to LIMITS.ACTIVITY_LOOKBACK_DAYS */
	days?: number
	/** Defaults to LIMITS.ACTIVITY_EVENTS */
	limit?: number
}

/** Numbers come in the query string as text, hence `coerce` */
const ActivityOptionsShape = {
	kinds: ActivityKindsSchema.optional().describe(
		'Comma-separated in the query string, e.g. "goal,penalty". A game is included if it has a requested event, or the requested attendance ("played" or "skipped"). Defaults to goals, assists, and penalties.',
	),
	days: z.coerce
		.number()
		.int()
		.min(1)
		.max(LIMITS.ACTIVITY_MAX_LOOKBACK_DAYS)
		.optional()
		.describe(
			`How many days of games to read, back from the latest one. Defaults to ${LIMITS.ACTIVITY_LOOKBACK_DAYS}, at most ${LIMITS.ACTIVITY_MAX_LOOKBACK_DAYS}.`,
		),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(LIMITS.ACTIVITY_MAX_EVENTS)
		.optional()
		.describe(
			`The most events to return. Defaults to ${LIMITS.ACTIVITY_EVENTS}, at most ${LIMITS.ACTIVITY_MAX_EVENTS}. Games wanted for their attendance are returned even past it, with no events.`,
		),
}

export interface GetPlayerActivityRequest
	extends GetPlayerRequest, ActivityOptions {}

export const GetPlayerActivityRequestSchema = GetPlayerRequestSchema.extend(
	ActivityOptionsShape,
) satisfies z.ZodType<GetPlayerActivityRequest>

export const GET_PLAYER_ACTIVITY_ENDPOINT = {
	method: "GET",
	uri: "/api/players/:playerId/activity",
	name: "Get player activity",
	description:
		"A player's latest goals, assists, and penalties, or the games they played or skipped, newest first. Slow on a cold cache, since it reads each game's scoresheet.",
	exampleRequest: {
		playerId: "1f4d54d9-8b87-4b49-8880-04cd9497ef92",
		kinds: ["goal", "assist"],
	},
	requestSchema: GetPlayerActivityRequestSchema,
	responseSchema: ActivityResponseSchema,
} satisfies ApiEndpoint<GetPlayerActivityRequest, ActivityResponse>

export interface GetTeamRequest {
	teamId: string
	season?: string
}

/** A KHL season id, for endpoints that default to the current season */
const SeasonParamSchema = z
	.string()
	.min(1)
	.optional()
	.describe("KHL season id; defaults to the current season")

export const GetTeamRequestSchema = z.object({
	teamId: z.string().min(1).describe("KHL team id"),
	season: SeasonParamSchema,
}) satisfies z.ZodType<GetTeamRequest>

export const GET_TEAM_ENDPOINT = {
	method: "GET",
	uri: "/api/teams/:teamId",
	name: "Get team details",
	description:
		"A team's season: its games with LiveBarn links, upcoming games, and roster with season stats.",
	exampleRequest: {teamId: "20868", season: "2143"},
	requestSchema: GetTeamRequestSchema,
	responseSchema: TeamResponseSchema,
} satisfies ApiEndpoint<GetTeamRequest, TeamResponse>

export interface GetTeamActivityRequest
	extends GetTeamRequest, ActivityOptions {}

export const GetTeamActivityRequestSchema = GetTeamRequestSchema.extend(
	ActivityOptionsShape,
) satisfies z.ZodType<GetTeamActivityRequest>

export const GET_TEAM_ACTIVITY_ENDPOINT = {
	method: "GET",
	uri: "/api/teams/:teamId/activity",
	name: "Get team activity",
	description:
		"A team's latest goals and penalties in a season, newest first. Slow on a cold cache, since it reads each game's scoresheet.",
	exampleRequest: {teamId: "20868", season: "2143"},
	requestSchema: GetTeamActivityRequestSchema,
	responseSchema: ActivityResponseSchema,
} satisfies ApiEndpoint<GetTeamActivityRequest, ActivityResponse>

/** An earlier game between the same two teams. */
export interface HeadToHeadGame {
	/** Missing for some finished games the league never linked */
	gameId: string | null
	seasonId: string
	/** ISO 8601 UTC instant */
	startsAt: string
	arena: KHLArenaRef | null
	/** Which of the two teams was at home that day */
	homeTeamId: string
	/** Goals by team id; null if the league never posted a score */
	goals: Record<string, number> | null
	/** Replays; empty when the arena isn't on LiveBarn */
	livebarn: LiveBarnLink[]
}

export const HeadToHeadGameSchema = z.object({
	gameId: z.string().nullable(),
	seasonId: z.string(),
	startsAt: z.iso.datetime(),
	arena: KHLArenaRefSchema.nullable(),
	homeTeamId: z.string(),
	goals: z.record(z.string(), z.number()).nullable(),
	livebarn: z.array(LiveBarnLinkSchema),
}) satisfies z.ZodType<HeadToHeadGame>

export interface GameResponse {
	boxScore: KHLBoxScore
	/** From the league's preview page; null if it failed */
	previewStats: KHLGamePreviewStats | null
	/**
	 * Once the game is final. Can come before the box score's summary: the
	 * scoreboard often posts it first.
	 */
	score: {away: number; home: number} | null
	/** Our player UUID for each KHL player id in the box score */
	playerIds: Record<string, string>
	/** Empty when the arena isn't on LiveBarn */
	livebarn: LiveBarnLink[]
	/** Finished games between the two teams, newest first */
	headToHead: HeadToHeadGame[]
	/** The teams' rosters with season stats; null if the KHL site failed */
	rosters: {away: TeamRoster; home: TeamRoster} | null
	/** Who played and their stats in this game, once the summary is posted */
	lineups: {away: TeamRoster; home: TeamRoster} | null
	/** Each team's season going into the game; null if the KHL site failed */
	form: {away: SeasonSummary | null; home: SeasonSummary | null}
	currentSeason: KHLSeason
}

export const GameResponseSchema = z.object({
	boxScore: KHLBoxScoreSchema,
	previewStats: KHLGamePreviewStatsSchema.nullable(),
	score: z.object({away: z.number(), home: z.number()}).nullable(),
	playerIds: z.record(z.string(), z.uuid()),
	livebarn: z.array(LiveBarnLinkSchema),
	headToHead: z.array(HeadToHeadGameSchema),
	rosters: z
		.object({away: TeamRosterSchema, home: TeamRosterSchema})
		.nullable(),
	lineups: z
		.object({away: TeamRosterSchema, home: TeamRosterSchema})
		.nullable(),
	form: z.object({
		away: z.lazy(() => SeasonSummarySchema).nullable(),
		home: z.lazy(() => SeasonSummarySchema).nullable(),
	}),
	currentSeason: KHLSeasonSchema,
}) satisfies z.ZodType<GameResponse>

export interface GetGameRequest {
	gameId: string
}

export const GetGameRequestSchema = z.object({
	gameId: z.string().regex(/^\d+$/).describe("KHL game id"),
}) satisfies z.ZodType<GetGameRequest>

export const GET_GAME_ENDPOINT = {
	method: "GET",
	uri: "/api/games/:gameId",
	name: "Get game details",
	description:
		"A game's box score (goals and shots by period, scoring, and penalties), with lineups, rosters, each team's form going in, earlier meetings between the teams, and LiveBarn links.",
	exampleRequest: {gameId: "57050"},
	requestSchema: GetGameRequestSchema,
	responseSchema: GameResponseSchema,
} satisfies ApiEndpoint<GetGameRequest, GameResponse>

export interface TeamsDivision {
	name: string
	/** By name */
	teams: KHLTeam[]
}

export const TeamsDivisionSchema = z.object({
	name: z.string(),
	teams: z.array(KHLTeamSchema),
}) satisfies z.ZodType<TeamsDivision>

export interface TeamsResponse {
	/** The season being listed */
	season: KHLSeason
	/** Every league season, newest first */
	seasons: KHLSeason[]
	/** In the league's order */
	divisions: TeamsDivision[]
}

export const TeamsResponseSchema = z.object({
	season: KHLSeasonSchema,
	seasons: z.array(KHLSeasonSchema),
	divisions: z.array(TeamsDivisionSchema),
}) satisfies z.ZodType<TeamsResponse>

export interface ListTeamsRequest {
	season?: string
}

export const ListTeamsRequestSchema = z.object({
	season: SeasonParamSchema,
}) satisfies z.ZodType<ListTeamsRequest>

export const LIST_TEAMS_ENDPOINT = {
	method: "GET",
	uri: "/api/teams",
	name: "List teams",
	description: "Every team in a season, grouped by division.",
	exampleRequest: {},
	requestSchema: ListTeamsRequestSchema,
	responseSchema: TeamsResponseSchema,
} satisfies ApiEndpoint<ListTeamsRequest, TeamsResponse>

export interface TeamSeasonsResponse {
	/** Every season the team played, newest first */
	seasons: KHLSeason[]
}

export const TeamSeasonsResponseSchema = z.object({
	seasons: z.array(KHLSeasonSchema),
}) satisfies z.ZodType<TeamSeasonsResponse>

export interface ListTeamSeasonsRequest {
	teamId: string
	season: string
}

export const ListTeamSeasonsRequestSchema = z.object({
	teamId: z.string().min(1).describe("KHL team id"),
	season: z
		.string()
		.min(1)
		.describe(
			"Any KHL season id the team played; the team's page is looked up there",
		),
}) satisfies z.ZodType<ListTeamSeasonsRequest>

export const LIST_TEAM_SEASONS_ENDPOINT = {
	method: "GET",
	uri: "/api/teams/:teamId/seasons",
	name: "List team seasons",
	description: "Every season a team has played, newest first.",
	exampleRequest: {teamId: "20868", season: "2143"},
	requestSchema: ListTeamSeasonsRequestSchema,
	responseSchema: TeamSeasonsResponseSchema,
} satisfies ApiEndpoint<ListTeamSeasonsRequest, TeamSeasonsResponse>

export interface StandingsResponse {
	/** The season being shown */
	season: KHLSeason
	/** Every league season, newest first */
	seasons: KHLSeason[]
	/** In the league's order; divisions without teams are left out */
	divisions: KHLStandingsDivision[]
}

export const StandingsResponseSchema = z.object({
	season: KHLSeasonSchema,
	seasons: z.array(KHLSeasonSchema),
	divisions: z.array(KHLStandingsDivisionSchema),
}) satisfies z.ZodType<StandingsResponse>

export interface GetStandingsRequest {
	season?: string
}

export const GetStandingsRequestSchema = z.object({
	season: SeasonParamSchema,
}) satisfies z.ZodType<GetStandingsRequest>

export const GET_STANDINGS_ENDPOINT = {
	method: "GET",
	uri: "/api/standings",
	name: "Get standings",
	description: "Every division's standings for a season.",
	exampleRequest: {},
	requestSchema: GetStandingsRequestSchema,
	responseSchema: StandingsResponseSchema,
} satisfies ApiEndpoint<GetStandingsRequest, StandingsResponse>

export interface PlayersTeam {
	team: KHLTeam
	divisionName: string
}

export const PlayersTeamSchema = z.object({
	team: KHLTeamSchema,
	divisionName: z.string(),
}) satisfies z.ZodType<PlayersTeam>

/** A roster row from one team's stats page, for the league-wide list */
export interface LeaguePlayer extends RosterPlayer {
	teamId: string
}

export const LeaguePlayerSchema = RosterPlayerSchema.extend({
	teamId: z.string(),
}) satisfies z.ZodType<LeaguePlayer>

export interface PlayersResponse {
	/** The season being shown */
	season: KHLSeason
	/** Every league season, newest first */
	seasons: KHLSeason[]
	/** Every team whose roster loaded, with its division */
	teams: PlayersTeam[]
	/**
	 * Players who've played a game, one row per team registration (so a
	 * player on two teams is listed twice)
	 */
	skaters: LeaguePlayer[]
	goalies: LeaguePlayer[]
	/** Teams missing from the lists because the KHL site errored */
	unavailableTeams: KHLTeam[]
}

export const PlayersResponseSchema = z.object({
	season: KHLSeasonSchema,
	seasons: z.array(KHLSeasonSchema),
	teams: z.array(PlayersTeamSchema),
	skaters: z.array(LeaguePlayerSchema),
	goalies: z.array(LeaguePlayerSchema),
	unavailableTeams: z.array(KHLTeamSchema),
}) satisfies z.ZodType<PlayersResponse>

export interface ListPlayersRequest {
	season?: string
}

export const ListPlayersRequestSchema = z.object({
	season: SeasonParamSchema,
}) satisfies z.ZodType<ListPlayersRequest>

export const LIST_PLAYERS_ENDPOINT = {
	method: "GET",
	uri: "/api/players",
	name: "List players",
	description:
		"Every player in a season with their stats, from each team's roster. One row per team registration, so a player on two teams is listed twice. Large: about 700 KB of JSON for a full season.",
	exampleRequest: {},
	requestSchema: ListPlayersRequestSchema,
	responseSchema: PlayersResponseSchema,
} satisfies ApiEndpoint<ListPlayersRequest, PlayersResponse>

/** One of a team's finished games, from its side */
export interface RecentGame {
	/** Missing for some finished games the league never linked */
	gameId: string | null
	/** ISO 8601 UTC instant */
	startsAt: string
	arena: KHLArenaRef | null
	opponent: KHLTeamRef
	homeAway: KHLHomeAway
	/** "W", "L", or "T" */
	result: string
	goalsFor: number
	goalsAgainst: number
}

export const RecentGameSchema = z.object({
	gameId: z.string().nullable(),
	startsAt: z.iso.datetime(),
	arena: KHLArenaRefSchema.nullable(),
	opponent: KHLTeamRefSchema,
	homeAway: KHLHomeAwaySchema,
	result: z.string(),
	goalsFor: z.number(),
	goalsAgainst: z.number(),
}) satisfies z.ZodType<RecentGame>

/** A finished game from its team's side; null until it has a usable score */
export function toRecentGame(game: KHLGame): RecentGame | null {
	const goals = game.isFinal ? getGoalsByTeam(game) : null
	if (!goals) {
		return null
	}
	const goalsFor = goals[game.team.id]!
	const goalsAgainst = goals[game.opponent.id]!
	return {
		gameId: game.id,
		startsAt: game.startsAt,
		arena: game.arena,
		opponent: {id: game.opponent.id, name: game.opponent.name},
		homeAway: game.homeAway,
		result:
			goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "T",
		goalsFor,
		goalsAgainst,
	}
}

/**
 * A team's season (so far, if it's the current one, or up to a game), from
 * its schedule: record, goals, and form.
 */
export interface SeasonSummary {
	team: KHLTeam
	season: KHLSeason
	divisionName: string
	/** Finished games with a posted score */
	gamesPlayed: number
	wins: number
	losses: number
	ties: number
	goalsFor: number
	goalsAgainst: number
	/** The last 10 games, oldest first */
	recent: RecentGame[]
	/** The result of the last game, and how many in a row; null before any */
	streak: {result: string; count: number} | null
}

export const SeasonSummarySchema = z.object({
	team: KHLTeamSchema,
	season: KHLSeasonSchema,
	divisionName: z.string(),
	gamesPlayed: z.number(),
	wins: z.number(),
	losses: z.number(),
	ties: z.number(),
	goalsFor: z.number(),
	goalsAgainst: z.number(),
	recent: z.array(RecentGameSchema),
	streak: z.object({result: z.string(), count: z.number()}).nullable(),
}) satisfies z.ZodType<SeasonSummary>

/** A team's season and roster, for one side of a matchup. */
export interface MatchupTeam extends SeasonSummary {
	roster: TeamRoster
}

export const MatchupTeamSchema = SeasonSummarySchema.extend({
	roster: TeamRosterSchema,
}) satisfies z.ZodType<MatchupTeam>

export interface MatchupResponse {
	currentSeason: KHLSeason
	a: MatchupTeam
	b: MatchupTeam
	/** Finished games between the two teams in any season, newest first;
	    empty when both sides are the same team */
	headToHead: HeadToHeadGame[]
	/** Scheduled games between the two teams, soonest first; only when both
	    sides are from the current season */
	upcoming: UpcomingGame[]
	/** The league's PP%, PK%, shots and PIM for each side's season, with a
	    as "away" and b as "home"; null when neither side's could be loaded */
	previewStats: KHLGamePreviewStats | null
}

export const MatchupResponseSchema = z.object({
	currentSeason: KHLSeasonSchema,
	a: MatchupTeamSchema,
	b: MatchupTeamSchema,
	headToHead: z.array(HeadToHeadGameSchema),
	upcoming: z.array(UpcomingGameSchema),
	previewStats: KHLGamePreviewStatsSchema.nullable(),
}) satisfies z.ZodType<MatchupResponse>

export interface GetMatchupRequest {
	a: string
	b: string
	aSeason?: string
	bSeason?: string
}

export const GetMatchupRequestSchema = z.object({
	a: z.string().min(1).describe("KHL team id"),
	b: z
		.string()
		.min(1)
		.describe("KHL team id; the same as `a` compares the team's seasons"),
	aSeason: SeasonParamSchema,
	bSeason: SeasonParamSchema,
}) satisfies z.ZodType<GetMatchupRequest>

export const GET_MATCHUP_ENDPOINT = {
	method: "GET",
	uri: "/api/matchup",
	name: "Compare two teams",
	description:
		"Two teams' seasons side by side, like the league's game previews: records, recent form, rosters, special teams, and the games between them. Pass the same team twice with different seasons to compare a team with itself.",
	exampleRequest: {a: "303", b: "684"},
	requestSchema: GetMatchupRequestSchema,
	responseSchema: MatchupResponseSchema,
} satisfies ApiEndpoint<GetMatchupRequest, MatchupResponse>

export interface RinksResponse {
	season: KHLSeason
	rinks: Rink[]
}

export const RinksResponseSchema = z.object({
	season: KHLSeasonSchema,
	rinks: z.array(RinkSchema),
}) satisfies z.ZodType<RinksResponse>

export type ListRinksRequest = Record<string, never>

export const ListRinksRequestSchema = z.object(
	{},
) satisfies z.ZodType<ListRinksRequest>

export const LIST_RINKS_ENDPOINT = {
	method: "GET",
	uri: "/api/rinks",
	name: "List rinks",
	description:
		"Every KHL rink with its LiveBarn surfaces and today's and upcoming games.",
	exampleRequest: {},
	requestSchema: ListRinksRequestSchema,
	responseSchema: RinksResponseSchema,
} satisfies ApiEndpoint<ListRinksRequest, RinksResponse>

export interface GamesResponse {
	season: KHLSeason
	/** The days' games, earliest first */
	games: UpcomingGame[]
}

export const GamesResponseSchema = z.object({
	season: KHLSeasonSchema,
	games: z.array(UpcomingGameSchema),
}) satisfies z.ZodType<GamesResponse>

export interface ListGamesRequest {
	from: string
	/** Defaults to `from` */
	to?: string
}

export const ListGamesRequestSchema = z
	.object({
		from: z.iso
			.date()
			.describe('The first league-local (Seattle) day, "yyyy-MM-dd"'),
		to: z.iso
			.date()
			.optional()
			.describe(
				`The last day, included; defaults to \`from\`. At most ${LIMITS.GAMES_MAX_RANGE_DAYS} days after it, counting both.`,
			),
	})
	// These run even when a date is malformed; leave that to its own error
	.refine(({from, to = from}) => !areDays(from, to) || from <= to, {
		path: ["to"],
		message: "must be on or after `from`",
	})
	.refine(
		({from, to = from}) =>
			!areDays(from, to) ||
			getDaysBetween(from, to) <= LIMITS.GAMES_MAX_RANGE_DAYS,
		{
			path: ["to"],
			message: `the range can cover at most ${LIMITS.GAMES_MAX_RANGE_DAYS} days`,
		},
	) satisfies z.ZodType<ListGamesRequest>

/** Whether every value is a "yyyy-MM-dd" day */
function areDays(...values: string[]): boolean {
	return values.every((value) => z.iso.date().safeParse(value).success)
}

export const LIST_GAMES_ENDPOINT = {
	method: "GET",
	uri: "/api/games",
	name: "List games",
	description:
		"Every game on the league-local days `from` through `to`, earliest first, with final scores once posted. Leave out `to` for a single day.",
	exampleRequest: {from: "2026-10-05", to: "2026-10-11"},
	requestSchema: ListGamesRequestSchema,
	responseSchema: GamesResponseSchema,
} satisfies ApiEndpoint<ListGamesRequest, GamesResponse>

/** A finished game at a rink, with its replay */
export interface RecentRinkGame {
	game: RinkGame
	livebarn: LiveBarnLink[]
}

export const RecentRinkGameSchema = z.object({
	game: RinkGameSchema,
	livebarn: z.array(LiveBarnLinkSchema),
}) satisfies z.ZodType<RecentRinkGame>

export interface RinkResponse {
	season: KHLSeason
	rink: Rink
	/** From the KHL arena page */
	address: string | null
	/** The latest finished games here, newest first */
	recent: RecentRinkGame[]
}

export const RinkResponseSchema = z.object({
	season: KHLSeasonSchema,
	rink: RinkSchema,
	address: z.string().nullable(),
	recent: z.array(RecentRinkGameSchema),
}) satisfies z.ZodType<RinkResponse>

export interface GetRinkRequest {
	arenaId: string
}

export const GetRinkRequestSchema = z.object({
	arenaId: z.string().min(1).describe("KHL arena id, from List rinks"),
}) satisfies z.ZodType<GetRinkRequest>

export const GET_RINK_ENDPOINT = {
	method: "GET",
	uri: "/api/rinks/:arenaId",
	name: "Get rink details",
	description:
		"A rink's address, LiveBarn surfaces, upcoming games, and latest finished games with replay links.",
	exampleRequest: {arenaId: "13"},
	requestSchema: GetRinkRequestSchema,
	responseSchema: RinkResponseSchema,
} satisfies ApiEndpoint<GetRinkRequest, RinkResponse>

/** How a component is doing, worst last */
export type StatusLevel = "operational" | "degraded" | "outage"

export const StatusLevelSchema = z.enum([
	"operational",
	"degraded",
	"outage",
]) satisfies z.ZodType<StatusLevel>

/** One run of a component's check */
export interface StatusCheck {
	/** ISO 8601 UTC instant */
	checkedAt: string
	status: StatusLevel
	/** Null when the check never got a response */
	latencyMs: number | null
	/** What went wrong, e.g. "HTTP 503" or "timed out" */
	error: string | null
}

export const StatusCheckSchema = z.object({
	checkedAt: z.string(),
	status: StatusLevelSchema,
	latencyMs: z.number().nullable(),
	error: z.string().nullable(),
}) satisfies z.ZodType<StatusCheck>

/** A league-local day of a component's checks */
export interface StatusDay {
	/** "yyyy-MM-dd" */
	day: string
	checks: number
	degraded: number
	outages: number
}

export const StatusDaySchema = z.object({
	day: z.string(),
	checks: z.number(),
	degraded: z.number(),
	outages: z.number(),
}) satisfies z.ZodType<StatusDay>

export interface StatusComponent {
	id: string
	name: string
	description: string
	/** Null until the first check has run */
	latest: StatusCheck | null
	/** Days with checks, oldest first; days without any are left out */
	days: StatusDay[]
}

export const StatusComponentSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	latest: StatusCheckSchema.nullable(),
	days: z.array(StatusDaySchema),
}) satisfies z.ZodType<StatusComponent>

/** Which build is running */
export interface DeployInfo {
	/** Git commit the build came from; null if unknown */
	commit: string | null
	/** Whether the build had uncommitted changes */
	dirty: boolean
	/** ISO 8601; null for local builds */
	deployedAt: string | null
	/** When this server process started, ISO 8601 */
	startedAt: string
}

export const DeployInfoSchema = z.object({
	commit: z.string().nullable(),
	dirty: z.boolean(),
	deployedAt: z.string().nullable(),
	startedAt: z.string(),
}) satisfies z.ZodType<DeployInfo>

export interface StatusResponse {
	/** The days the history covers, oldest first ("yyyy-MM-dd") */
	historyDays: string[]
	/** How often each component is checked */
	intervalMinutes: number
	components: StatusComponent[]
	deploy: DeployInfo
}

export const StatusResponseSchema = z.object({
	historyDays: z.array(z.string()),
	intervalMinutes: z.number(),
	components: z.array(StatusComponentSchema),
	deploy: DeployInfoSchema,
}) satisfies z.ZodType<StatusResponse>

export type GetStatusRequest = Record<string, never>

export const GetStatusRequestSchema = z.object(
	{},
) satisfies z.ZodType<GetStatusRequest>

export const GET_STATUS_ENDPOINT = {
	method: "GET",
	uri: "/api/status",
	name: "Get site status",
	description:
		"The site's health: each component's latest check and daily history, and which build is running.",
	exampleRequest: {},
	requestSchema: GetStatusRequestSchema,
	responseSchema: StatusResponseSchema,
} satisfies ApiEndpoint<GetStatusRequest, StatusResponse>

export type ClientLogLevel = "debug" | "info" | "warn" | "error"

/** One log message from the browser, as sent to LOG_ENDPOINT. */
export interface ClientLog {
	/** ISO 8601, from the browser's clock */
	timestamp: string
	level: ClientLogLevel
	context: string
	subcontext: string
	message: string
	/** Extra data, with Errors flattened to {name, message, stack, ...} */
	aux: Record<string, unknown> | null
	/** The page the log came from */
	url: string
}

export const ClientLogSchema = z.object({
	timestamp: z.iso.datetime(),
	level: z.enum(["debug", "info", "warn", "error"]),
	context: z.string().max(200),
	subcontext: z.string().max(200),
	message: z.string().max(5_000),
	aux: z.record(z.string(), z.unknown()).nullable(),
	url: z.string().max(2_000),
}) satisfies z.ZodType<ClientLog>

export interface LogRequest {
	sessionId: string
	userAgent: string
	logs: ClientLog[]
}

export const LogRequestSchema = z.object({
	sessionId: z
		.string()
		.max(100)
		.describe("Random per page load, to group one visit's logs"),
	userAgent: z.string().max(500).describe("The browser's user agent"),
	logs: z.array(ClientLogSchema).min(1).max(100).describe("1 to 100 logs"),
}) satisfies z.ZodType<LogRequest>

export interface LogResponse {
	ok: true
}

export const LogResponseSchema = z.object({
	ok: z.literal(true),
}) satisfies z.ZodType<LogResponse>

export const LOG_ENDPOINT = {
	method: "POST",
	uri: "/api/logs",
	name: "Send logs",
	description:
		"Batches of browser logs from KHL+'s own pages, written to the server's log output.",
	exampleRequest: {
		sessionId: "c0ffee",
		userAgent: "curl",
		logs: [
			{
				timestamp: "2026-10-15T12:00:00.000Z",
				level: "info",
				context: "Example",
				subcontext: "docs",
				message: "hello",
				aux: null,
				url: "https://khl.dvdzkwsk.com/",
			},
		],
	},
	requestSchema: LogRequestSchema,
	responseSchema: LogResponseSchema,
} satisfies ApiEndpoint<LogRequest, LogResponse>

export type BenchmarkSite = "khl-plus" | "khl"

export const BENCHMARK_SITE_LABELS: Record<BenchmarkSite, string> = {
	"khl-plus": "KHL+",
	khl: "League site",
}

/** Common surnames, so both sites return several matches to pick from */
export const DEFAULT_BENCHMARK_NAMES = [
	"Ashley Johnson",
	"Michael Nguyen",
	"Ami Miller",
	"Zach Garcia",
	"Camille Anderson",
]

/** Milliseconds for each step of "open the site, search, open a player" */
export interface BenchmarkTiming {
	/** Until the search box shows */
	open: number
	/** From typing the name until the first result shows */
	results: number
	/** From opening that result until the player's stats show */
	player: number
	total: number
}

export const BenchmarkTimingSchema = z.object({
	open: z.number(),
	results: z.number(),
	player: z.number(),
	total: z.number(),
}) satisfies z.ZodType<BenchmarkTiming>

/** One site's run for one player name; `error` instead of `timing` if it failed */
export interface BenchmarkRun {
	site: BenchmarkSite
	name: string
	timing: BenchmarkTiming | null
	error: string | null
}

export const BenchmarkRunSchema = z.object({
	site: z.enum(["khl-plus", "khl"]),
	name: z.string(),
	timing: BenchmarkTimingSchema.nullable(),
	error: z.string().nullable(),
}) satisfies z.ZodType<BenchmarkRun>

/** Per-step medians over a site's successful runs, or null if none succeeded */
export interface BenchmarkSummary {
	site: BenchmarkSite
	runs: number
	median: BenchmarkTiming | null
}

export const BenchmarkSummarySchema = z.object({
	site: z.enum(["khl-plus", "khl"]),
	runs: z.number(),
	median: BenchmarkTimingSchema.nullable(),
}) satisfies z.ZodType<BenchmarkSummary>

export interface RunBenchmarkRequest {
	names: string[]
}

export const RunBenchmarkRequestSchema = z.object({
	names: z
		.array(z.string().trim().min(2).max(100))
		.min(1)
		.max(10)
		.describe("Player names to search for, each on both sites"),
}) satisfies z.ZodType<RunBenchmarkRequest>

export interface BenchmarkResponse {
	runs: BenchmarkRun[]
	summaries: BenchmarkSummary[]
}

export const BenchmarkResponseSchema = z.object({
	runs: z.array(BenchmarkRunSchema),
	summaries: z.array(BenchmarkSummarySchema),
}) satisfies z.ZodType<BenchmarkResponse>

export const RUN_BENCHMARK_ENDPOINT = {
	method: "POST",
	uri: "/api/admin/benchmark",
	name: "Run the benchmark",
	description:
		"Dev only: times KHL+ against the league's site in headless Chrome (see tools/Benchmark.ts). Takes several seconds per name.",
	exampleRequest: {names: DEFAULT_BENCHMARK_NAMES.slice(0, 1)},
	requestSchema: RunBenchmarkRequestSchema,
	responseSchema: BenchmarkResponseSchema,
} satisfies ApiEndpoint<RunBenchmarkRequest, BenchmarkResponse>

export interface ApiDocsSection {
	title: string
	endpoints: ApiEndpoint<ApiRequest, unknown>[]
}

/**
 * The /api page, in order. Every endpoint is listed except the ones only this
 * site's own pages use (LOG_ENDPOINT and RUN_BENCHMARK_ENDPOINT);
 * ApiJson.test.ts checks that none is forgotten.
 */
export const API_DOCS_SECTIONS: ApiDocsSection[] = [
	{title: "Search", endpoints: [SEARCH_ENDPOINT]},
	{
		title: "Games",
		endpoints: [
			LIST_GAMES_ENDPOINT,
			GET_GAME_ENDPOINT,
			GET_MATCHUP_ENDPOINT,
		],
	},
	{
		title: "Teams",
		endpoints: [
			LIST_TEAMS_ENDPOINT,
			GET_TEAM_ENDPOINT,
			LIST_TEAM_SEASONS_ENDPOINT,
			GET_TEAM_ACTIVITY_ENDPOINT,
			GET_STANDINGS_ENDPOINT,
		],
	},
	{
		title: "Players",
		endpoints: [
			LIST_PLAYERS_ENDPOINT,
			GET_PLAYER_ENDPOINT,
			GET_PLAYER_ACTIVITY_ENDPOINT,
		],
	},
	{title: "Rinks", endpoints: [LIST_RINKS_ENDPOINT, GET_RINK_ENDPOINT]},
	{title: "Site", endpoints: [GET_STATUS_ENDPOINT]},
]
