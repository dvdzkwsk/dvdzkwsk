import {ApiEndpoint} from "@dvdzkwsk/util/ApiUtil"
import {z} from "zod"
import {
	KHLArenaRef,
	KHLArenaRefSchema,
	KHLBoxScore,
	KHLBoxScoreSchema,
	KHLGame,
	KHLGameSchema,
	KHLPlayer,
	KHLPlayerSchema,
	KHLPlayerSearchResult,
	KHLPlayerSearchResultSchema,
	KHLSeason,
	KHLSeasonSchema,
	KHLStandingsDivision,
	KHLStandingsDivisionSchema,
	KHLTeam,
	KHLTeamSchema,
} from "./KHLJson.js"

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

/** One KHL player id: the player on a single team, across seasons. */
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
}

export const RinkGameSchema = z.object({
	gameId: z.string(),
	startsAt: z.iso.datetime(),
	homeTeam: RinkTeamSchema,
	awayTeam: RinkTeamSchema,
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
	q: z.string(),
}) satisfies z.ZodType<SearchRequest>

/** Players and teams in the current season matching `q` (min. 2 chars). */
export const SEARCH_ENDPOINT = {
	method: "GET",
	uri: "/api/search",
	requestSchema: SearchRequestSchema,
	responseSchema: SearchResponseSchema,
} satisfies ApiEndpoint<SearchRequest, SearchResponse>

export interface GetPlayerRequest {
	/** Our player UUID */
	playerId: string
}

export const GetPlayerRequestSchema = z.object({
	playerId: z.uuid(),
}) satisfies z.ZodType<GetPlayerRequest>

export const GET_PLAYER_ENDPOINT = {
	method: "GET",
	uri: "/api/players/:playerId",
	requestSchema: GetPlayerRequestSchema,
	responseSchema: PlayerResponseSchema,
} satisfies ApiEndpoint<GetPlayerRequest, PlayerResponse>

export interface GetTeamRequest {
	teamId: string
	/** Defaults to the current season */
	season?: string
}

export const GetTeamRequestSchema = z.object({
	teamId: z.string().min(1),
	season: z.string().min(1).optional(),
}) satisfies z.ZodType<GetTeamRequest>

export const GET_TEAM_ENDPOINT = {
	method: "GET",
	uri: "/api/teams/:teamId",
	requestSchema: GetTeamRequestSchema,
	responseSchema: TeamResponseSchema,
} satisfies ApiEndpoint<GetTeamRequest, TeamResponse>

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
	/** Our player UUID for each KHL player id in the box score */
	playerIds: Record<string, string>
	/** Empty when the arena isn't on LiveBarn */
	livebarn: LiveBarnLink[]
	/** Finished games between the two teams, newest first */
	headToHead: HeadToHeadGame[]
	/** The teams' rosters for the game's season, until a box score is posted */
	rosters: {away: TeamRoster; home: TeamRoster} | null
}

export const GameResponseSchema = z.object({
	boxScore: KHLBoxScoreSchema,
	playerIds: z.record(z.string(), z.uuid()),
	livebarn: z.array(LiveBarnLinkSchema),
	headToHead: z.array(HeadToHeadGameSchema),
	rosters: z
		.object({away: TeamRosterSchema, home: TeamRosterSchema})
		.nullable(),
}) satisfies z.ZodType<GameResponse>

export interface GetGameRequest {
	/** KHL game id */
	gameId: string
}

export const GetGameRequestSchema = z.object({
	gameId: z.string().regex(/^\d+$/),
}) satisfies z.ZodType<GetGameRequest>

/** A game's box score: goals and shots by period, scoring and penalties. */
export const GET_GAME_ENDPOINT = {
	method: "GET",
	uri: "/api/games/:gameId",
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
	/** Defaults to the current season */
	season?: string
}

export const ListTeamsRequestSchema = z.object({
	season: z.string().min(1).optional(),
}) satisfies z.ZodType<ListTeamsRequest>

/** Every team in a season, by division, for team pickers. */
export const LIST_TEAMS_ENDPOINT = {
	method: "GET",
	uri: "/api/teams",
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
	/** Any season the team played; the team's page is looked up there */
	season: string
}

export const ListTeamSeasonsRequestSchema = z.object({
	teamId: z.string().min(1),
	season: z.string().min(1),
}) satisfies z.ZodType<ListTeamSeasonsRequest>

/** The seasons a team played, for season pickers. */
export const LIST_TEAM_SEASONS_ENDPOINT = {
	method: "GET",
	uri: "/api/teams/:teamId/seasons",
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
	/** Defaults to the current season */
	season?: string
}

export const GetStandingsRequestSchema = z.object({
	season: z.string().min(1).optional(),
}) satisfies z.ZodType<GetStandingsRequest>

/** Every division's standings for a season. */
export const GET_STANDINGS_ENDPOINT = {
	method: "GET",
	uri: "/api/standings",
	requestSchema: GetStandingsRequestSchema,
	responseSchema: StandingsResponseSchema,
} satisfies ApiEndpoint<GetStandingsRequest, StandingsResponse>

/** A team's season (so far, if it's the current one), from its schedule and roster. */
export interface MatchupTeam {
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
	/** "W", "L" or "T" for the last 10 games, oldest first */
	recent: string[]
	/** The result of the last game, and how many in a row; null before any */
	streak: {result: string; count: number} | null
	roster: TeamRoster
}

export const MatchupTeamSchema = z.object({
	team: KHLTeamSchema,
	season: KHLSeasonSchema,
	divisionName: z.string(),
	gamesPlayed: z.number(),
	wins: z.number(),
	losses: z.number(),
	ties: z.number(),
	goalsFor: z.number(),
	goalsAgainst: z.number(),
	recent: z.array(z.string()),
	streak: z.object({result: z.string(), count: z.number()}).nullable(),
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
}

export const MatchupResponseSchema = z.object({
	currentSeason: KHLSeasonSchema,
	a: MatchupTeamSchema,
	b: MatchupTeamSchema,
	headToHead: z.array(HeadToHeadGameSchema),
	upcoming: z.array(UpcomingGameSchema),
}) satisfies z.ZodType<MatchupResponse>

export interface GetMatchupRequest {
	/** Team ids; the same id twice compares a team's seasons */
	a: string
	b: string
	/** Each team's season; defaults to the current season */
	aSeason?: string
	bSeason?: string
}

export const GetMatchupRequestSchema = z.object({
	a: z.string().min(1),
	b: z.string().min(1),
	aSeason: z.string().min(1).optional(),
	bSeason: z.string().min(1).optional(),
}) satisfies z.ZodType<GetMatchupRequest>

/** Two teams' seasons compared, like the league's game previews. */
export const GET_MATCHUP_ENDPOINT = {
	method: "GET",
	uri: "/api/matchup",
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

/** Every KHL rink with its upcoming games, for the home page. */
export const LIST_RINKS_ENDPOINT = {
	method: "GET",
	uri: "/api/rinks",
	requestSchema: ListRinksRequestSchema,
	responseSchema: RinksResponseSchema,
} satisfies ApiEndpoint<ListRinksRequest, RinksResponse>

export interface RinkResponse {
	season: KHLSeason
	rink: Rink
	/** From the KHL arena page */
	address: string | null
}

export const RinkResponseSchema = z.object({
	season: KHLSeasonSchema,
	rink: RinkSchema,
	address: z.string().nullable(),
}) satisfies z.ZodType<RinkResponse>

export interface GetRinkRequest {
	/** KHL arena id */
	arenaId: string
}

export const GetRinkRequestSchema = z.object({
	arenaId: z.string().min(1),
}) satisfies z.ZodType<GetRinkRequest>

export const GET_RINK_ENDPOINT = {
	method: "GET",
	uri: "/api/rinks/:arenaId",
	requestSchema: GetRinkRequestSchema,
	responseSchema: RinkResponseSchema,
} satisfies ApiEndpoint<GetRinkRequest, RinkResponse>

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
	/** Random per page load, to group one visit's logs */
	sessionId: string
	userAgent: string
	logs: ClientLog[]
}

export const LogRequestSchema = z.object({
	sessionId: z.string().max(100),
	userAgent: z.string().max(500),
	logs: z.array(ClientLogSchema).min(1).max(100),
}) satisfies z.ZodType<LogRequest>

export interface LogResponse {
	ok: true
}

export const LogResponseSchema = z.object({
	ok: z.literal(true),
}) satisfies z.ZodType<LogResponse>

/** Batches of browser logs, written to the server's log output. */
export const LOG_ENDPOINT = {
	method: "POST",
	uri: "/api/logs",
	requestSchema: LogRequestSchema,
	responseSchema: LogResponseSchema,
} satisfies ApiEndpoint<LogRequest, LogResponse>
