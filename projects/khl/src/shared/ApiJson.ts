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

/**
 * A registration key identifies a `PlayerRegistration`: one player on one
 * team, under one KHL player id. It's how a registration is passed around
 * and looked up (a person, with all of their registrations, is a `playerId`).
 * The id alone isn't enough, because a player can keep one id across several
 * teams (one player is on 8 teams under KHL player id 562354).
 * Keyed by id alone:
 *
 * - The team picker would open whichever of the 8 teams is listed first, no
 *   matter which team was chosen.
 * - The integrity report loads each team's KHL player page and compares it
 *   with what's stored for that team. It would keep only one of the 8 pages,
 *   so it would flag correct data on the other 7 teams as wrong, and a resync
 *   would overwrite it.
 */
export const RegistrationKeySchema = z
	.string()
	.regex(/^\d+-\d+$/, "expected <KHL player id>-<team id>")
	.brand("RegistrationKey")

/** "<KHL player id>-<team id>"; see toRegistrationKey */
export type RegistrationKey = z.infer<typeof RegistrationKeySchema>

export function toRegistrationKey(
	r: Pick<PlayerRegistration, "khlPlayerId" | "teamId">,
): RegistrationKey {
	return `${r.khlPlayerId}-${r.teamId}` as RegistrationKey
}

export function parseRegistrationKey(key: RegistrationKey): {
	khlPlayerId: string
	teamId: string
} {
	const [khlPlayerId, teamId] = key.split("-") as [string, string]
	return {khlPlayerId, teamId}
}

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
export interface ActivityResult {
	/** Newest first */
	games: ActivityGame[]
	/** Our player UUID for each KHL player id named in `games` */
	playerIds: Record<string, string>
	/**
	 * Games left out of `games` because they're still being loaded from the
	 * KHL site for the first time; ask again shortly to get them
	 */
	pendingGames: number
}

export const ActivityResultSchema = z.object({
	games: z.array(ActivityGameSchema),
	playerIds: z.record(z.string(), z.uuid()),
	pendingGames: z.number().int().nonnegative(),
}) satisfies z.ZodType<ActivityResult>

// Each endpoint gets its own copy of a shared shape (`.extend({})`), so the
// /api page names its response after it, as with every other endpoint.

export type GetPlayerActivityResponse = ActivityResult

export const GetPlayerActivityResponseSchema = ActivityResultSchema.extend(
	{},
) satisfies z.ZodType<GetPlayerActivityResponse>

export type GetTeamActivityResponse = ActivityResult

export const GetTeamActivityResponseSchema = ActivityResultSchema.extend(
	{},
) satisfies z.ZodType<GetTeamActivityResponse>

export interface GetPlayerResponse {
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

export const GetPlayerResponseSchema = z.object({
	playerId: z.uuid(),
	name: z.string(),
	currentSeason: KHLSeasonSchema,
	registrations: z.array(PlayerRegistrationSchema),
	games: z.array(FeedGameSchema),
	unavailableSchedules: z.array(UnavailableScheduleSchema),
	upcoming: z.array(UpcomingGameSchema),
}) satisfies z.ZodType<GetPlayerResponse>

export interface GetTeamResponse {
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

export const GetTeamResponseSchema = z.object({
	team: KHLTeamSchema,
	divisionName: z.string(),
	season: KHLSeasonSchema,
	seasons: z.array(KHLSeasonSchema),
	games: z.array(FeedGameSchema),
	upcoming: z.array(UpcomingGameSchema),
	roster: TeamRosterSchema,
}) satisfies z.ZodType<GetTeamResponse>

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
		"A player's profile and every game they've played, across all of their teams and seasons, plus upcoming games for their current teams. The KHL issues a new player id each time a player registers, and one id can carry on across several teams, so a person has many KHL ids; `playerId` is KHL+'s own id for the person, from search results and rosters.",
	exampleRequest: {playerId: "1f4d54d9-8b87-4b49-8880-04cd9497ef92"},
	requestSchema: GetPlayerRequestSchema,
	responseSchema: GetPlayerResponseSchema,
} satisfies ApiEndpoint<GetPlayerRequest, GetPlayerResponse>

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
		"A player's latest goals, assists, and penalties, or the games they played or skipped, newest first. Games whose scoresheets haven't been loaded yet are left out and counted in `pendingGames`; ask again shortly to get them.",
	exampleRequest: {
		playerId: "1f4d54d9-8b87-4b49-8880-04cd9497ef92",
		kinds: ["goal", "assist"],
	},
	requestSchema: GetPlayerActivityRequestSchema,
	responseSchema: GetPlayerActivityResponseSchema,
} satisfies ApiEndpoint<GetPlayerActivityRequest, GetPlayerActivityResponse>

/**
 * The cached KHL resources behind a player's page. Each is keyed by what it
 * is, not by who asked, so it's shared: a schedule serves every player on
 * the team (and the team's own page), a player page every profile with that
 * KHL id, and a search every profile with that name.
 */
export type IntegrityCacheKind = "search" | "profile" | "schedule"

export const IntegrityCacheKindSchema = z.enum([
	"search",
	"profile",
	"schedule",
])

/** A server cache entry behind a player's page */
export interface IntegrityCacheEntry {
	key: string
	kind: IntegrityCacheKind
	/** e.g. "Bullets · season 2143" */
	label: string
	/** Null if it wasn't cached (or was still loading) when the report began */
	cachedAt: string | null
	expiresAt: string | null
}

export const IntegrityCacheEntrySchema = z.object({
	key: z.string(),
	kind: IntegrityCacheKindSchema,
	label: z.string(),
	cachedAt: z.iso.datetime().nullable(),
	expiresAt: z.iso.datetime().nullable(),
}) satisfies z.ZodType<IntegrityCacheEntry>

/** Which KHL page a registration was compared against */
export type IntegritySource = "search" | "profile"

export const IntegritySourceSchema = z.enum(["search", "profile"])

/** One field where our stored registration disagrees with the KHL */
export interface IntegrityMismatch {
	source: IntegritySource
	/** e.g. "name", "position", "seasons" */
	field: string
	ours: string | null
	khl: string | null
	/** e.g. "Missing from ours: 93" */
	detail: string | null
}

export const IntegrityMismatchSchema = z.object({
	source: IntegritySourceSchema,
	field: z.string(),
	ours: z.string().nullable(),
	khl: z.string().nullable(),
	detail: z.string().nullable(),
}) satisfies z.ZodType<IntegrityMismatch>

/** Any JSON, e.g. a cached KHL page as the scraper parsed it */
export const JsonValueSchema = z.json()

export type JsonValue = z.infer<typeof JsonValueSchema>

/**
 * One value that differs between our copy and the KHL's: a cached page and
 * the KHL's page now, or a stored registration and what the KHL implies
 */
export interface JsonDifference {
	/** e.g. "[3].startsAt", or "seasonIds (length)" for an array */
	path: string
	/** JSON, shortened; null if absent */
	ours: string | null
	khl: string | null
}

export const JsonDifferenceSchema = z.object({
	path: z.string(),
	ours: z.string().nullable(),
	khl: z.string().nullable(),
}) satisfies z.ZodType<JsonDifference>

/** A registration's fields, as we store them or as the KHL implies them */
export const IntegrityRecordSchema = z.object({
	name: z.string(),
	position: z.string().nullable(),
	teamId: z.string(),
	teamName: z.string(),
	teamLogoUrl: z.url().nullable(),
	/** Oldest first */
	seasonIds: z.array(z.string()),
})

// A type alias (not an interface), so it's assignable to JsonValue
export type IntegrityRecord = z.infer<typeof IntegrityRecordSchema>

/** One KHL player id attached to the profile, as stored and as the KHL has it */
export interface IntegrityRegistration {
	khlPlayerId: string
	name: string
	position: string | null
	teamId: string
	teamName: string
	teamLogoUrl: string | null
	/** Oldest first */
	seasonIds: string[]
	/** When we last recorded it */
	updatedAt: string
	/** The KHL page it was compared against; null with no seasons recorded */
	profileUrl: string | null
	/** Null if the KHL page failed; see `profileError` */
	profile: KHLPlayer | null
	profileError: string | null
	/** This id's rows in the KHL's all-seasons search for the player's name */
	searchResults: KHLPlayerSearchResult[]
	/** Where each KHL page disagrees with what's stored, field by field */
	mismatches: IntegrityMismatch[]
	/** What's stored, in the same shape as `expected` */
	stored: IntegrityRecord
	/**
	 * What the KHL's pages imply, and so what applying the resync stores.
	 * Where the pages disagree it keeps what's stored; see `reconcileRegistration`.
	 */
	expected: IntegrityRecord
	/** `stored` against `expected`; empty when they match */
	differences: JsonDifference[]
	/** The `cache` entries the player's page loads for it */
	cacheKeys: IntegrityRegistrationCacheKeys
}

export interface IntegrityRegistrationCacheKeys {
	/** Its KHL player page for the latest season; null with no seasons */
	profile: string | null
	/** Its team's schedule for each of its seasons, oldest first */
	schedules: string[]
}

export const IntegrityRegistrationCacheKeysSchema = z.object({
	profile: z.string().nullable(),
	schedules: z.array(z.string()),
}) satisfies z.ZodType<IntegrityRegistrationCacheKeys>

export const IntegrityRegistrationSchema = z.object({
	khlPlayerId: z.string(),
	name: z.string(),
	position: z.string().nullable(),
	teamId: z.string(),
	teamName: z.string(),
	teamLogoUrl: z.url().nullable(),
	seasonIds: z.array(z.string()),
	updatedAt: z.iso.datetime(),
	profileUrl: z.url().nullable(),
	profile: KHLPlayerSchema.nullable(),
	profileError: z.string().nullable(),
	searchResults: z.array(KHLPlayerSearchResultSchema),
	mismatches: z.array(IntegrityMismatchSchema),
	stored: IntegrityRecordSchema,
	expected: IntegrityRecordSchema,
	differences: z.array(JsonDifferenceSchema),
	cacheKeys: IntegrityRegistrationCacheKeysSchema,
}) satisfies z.ZodType<IntegrityRegistration>

/**
 * A KHL player id with the profile's name that isn't attached to it: a
 * namesake split off by hand, or one we've never recorded.
 */
export interface IntegrityUnlinked {
	khlPlayerId: string
	name: string
	teamId: string
	teamName: string
	/** Oldest first */
	seasonIds: string[]
	/** The other profile it's attached to; null if we haven't recorded it */
	playerId: string | null
	/** Its KHL player page, as of its latest season */
	khlUrl: string
}

export const IntegrityUnlinkedSchema = z.object({
	khlPlayerId: z.string(),
	name: z.string(),
	teamId: z.string(),
	teamName: z.string(),
	seasonIds: z.array(z.string()),
	playerId: z.uuid().nullable(),
	khlUrl: z.url(),
}) satisfies z.ZodType<IntegrityUnlinked>

/** How our stored profile compares with the KHL's pages for it */
export interface IntegrityReport {
	playerId: string
	name: string
	/** When the profile was first recorded */
	createdAt: string
	checkedAt: string
	/** The cache entries behind the player's page, as of `checkedAt` */
	cache: IntegrityCacheEntry[]
	/** Every KHL player id attached to the profile, most recently active first */
	registrations: IntegrityRegistration[]
	unlinked: IntegrityUnlinked[]
	/** KHL search URL for the player's name across all seasons */
	searchUrl: string
	/** Set if the KHL search failed, so nothing was compared against it */
	searchError: string | null
}

export const IntegrityReportSchema = z.object({
	playerId: z.uuid(),
	name: z.string(),
	createdAt: z.iso.datetime(),
	checkedAt: z.iso.datetime(),
	cache: z.array(IntegrityCacheEntrySchema),
	registrations: z.array(IntegrityRegistrationSchema),
	unlinked: z.array(IntegrityUnlinkedSchema),
	searchUrl: z.url(),
	searchError: z.string().nullable(),
}) satisfies z.ZodType<IntegrityReport>

export type GetPlayerIntegrityRequest = GetPlayerRequest

export const GetPlayerIntegrityRequestSchema = GetPlayerRequestSchema.extend(
	{},
) satisfies z.ZodType<GetPlayerIntegrityRequest>

export type GetPlayerIntegrityResponse = IntegrityReport

export const GetPlayerIntegrityResponseSchema = IntegrityReportSchema.extend(
	{},
) satisfies z.ZodType<GetPlayerIntegrityResponse>

/** Compares the stored profile with the KHL's pages; at /players/:id?integrity */
export const GET_PLAYER_INTEGRITY_ENDPOINT = {
	method: "GET",
	uri: "/api/players/:playerId/integrity",
	name: "Get player integrity",
	description:
		"Compares what KHL+ has stored for a player with the KHL's search and player pages, and lists the cached pages behind it. Read-only.",
	exampleRequest: GET_PLAYER_ENDPOINT.exampleRequest,
	requestSchema: GetPlayerIntegrityRequestSchema,
	responseSchema: GetPlayerIntegrityResponseSchema,
} satisfies ApiEndpoint<GetPlayerIntegrityRequest, GetPlayerIntegrityResponse>

export interface CheckCacheRequest {
	/** An IntegrityCacheEntry key */
	key: string
}

export const CheckCacheRequestSchema = z.object({
	key: z
		.string()
		.min(1)
		.describe("A cache key from a player's integrity report"),
}) satisfies z.ZodType<CheckCacheRequest>

/**
 * Whether a cache entry still matches the KHL: `match`, `differs`,
 * `not-cached` (nothing to compare), or `failed` (the KHL page didn't load)
 */
export type CacheCheckStatus = "match" | "differs" | "not-cached" | "failed"

export interface CheckCacheResponse {
	key: string
	status: CacheCheckStatus
	checkedAt: string
	/** The first differences, up to LIMITS.CACHE_CHECK_DIFFERENCES */
	differences: JsonDifference[]
	differenceCount: number
	/** The KHL's page now, parsed; null unless it loaded */
	khl: JsonValue | null
	error: string | null
}

export const CheckCacheResponseSchema = z.object({
	key: z.string(),
	status: z.enum(["match", "differs", "not-cached", "failed"]),
	checkedAt: z.iso.datetime(),
	differences: z.array(JsonDifferenceSchema),
	differenceCount: z.number().int().nonnegative(),
	khl: JsonValueSchema.nullable(),
	error: z.string().nullable(),
}) satisfies z.ZodType<CheckCacheResponse>

/** What a cache entry holds, for inspecting it */
export interface GetCacheEntryResponse {
	key: string
	/** Null if it isn't cached (or is still loading) */
	cachedAt: string | null
	expiresAt: string | null
	value: JsonValue | null
}

export const GetCacheEntryResponseSchema = z.object({
	key: z.string(),
	cachedAt: z.iso.datetime().nullable(),
	expiresAt: z.iso.datetime().nullable(),
	value: JsonValueSchema.nullable(),
}) satisfies z.ZodType<GetCacheEntryResponse>

export type GetCacheEntryRequest = CheckCacheRequest

export const GetCacheEntryRequestSchema = CheckCacheRequestSchema.extend(
	{},
) satisfies z.ZodType<GetCacheEntryRequest>

/** A cache entry's contents; only for the kinds an integrity report lists */
export const GET_CACHE_ENTRY_ENDPOINT = {
	method: "GET",
	uri: "/api/cache/entry",
	name: "Get a cache entry",
	description:
		"What one cached KHL page holds, by the key an integrity report lists.",
	exampleRequest: {key: "history:brandon smith"},
	requestSchema: GetCacheEntryRequestSchema,
	responseSchema: GetCacheEntryResponseSchema,
} satisfies ApiEndpoint<GetCacheEntryRequest, GetCacheEntryResponse>

/**
 * Loads a cached page from the KHL again and compares it with the cached
 * copy, which it leaves in place
 */
export const CHECK_CACHE_ENDPOINT = {
	method: "POST",
	uri: "/api/cache/check",
	name: "Check a cache entry",
	description:
		"Loads a cached KHL page again and compares it with the cached copy, which it leaves in place.",
	exampleRequest: {key: "history:brandon smith"},
	requestSchema: CheckCacheRequestSchema,
	responseSchema: CheckCacheResponseSchema,
} satisfies ApiEndpoint<CheckCacheRequest, CheckCacheResponse>

export type ReloadPlayerIntegrityRequest = GetPlayerRequest

export const ReloadPlayerIntegrityRequestSchema = GetPlayerRequestSchema.extend(
	{},
) satisfies z.ZodType<ReloadPlayerIntegrityRequest>

export type ReloadPlayerIntegrityResponse = IntegrityReport

export const ReloadPlayerIntegrityResponseSchema = IntegrityReportSchema.extend(
	{},
) satisfies z.ZodType<ReloadPlayerIntegrityResponse>

/**
 * Drops the cached KHL search and player pages behind the report, then
 * reports again. Like the report, it changes nothing we've stored.
 */
export const RELOAD_PLAYER_INTEGRITY_ENDPOINT = {
	method: "POST",
	uri: "/api/players/:playerId/integrity/reload",
	name: "Reload player integrity",
	description:
		"Drops the cached KHL pages behind a player's integrity report, then reports again.",
	exampleRequest: GET_PLAYER_ENDPOINT.exampleRequest,
	requestSchema: ReloadPlayerIntegrityRequestSchema,
	responseSchema: ReloadPlayerIntegrityResponseSchema,
} satisfies ApiEndpoint<
	ReloadPlayerIntegrityRequest,
	ReloadPlayerIntegrityResponse
>

export type ResyncPlayerRequest = GetPlayerRequest

export const ResyncPlayerRequestSchema = GetPlayerRequestSchema.extend(
	{},
) satisfies z.ZodType<ResyncPlayerRequest>

export type ResyncPlayerResponse = IntegrityReport

export const ResyncPlayerResponseSchema = IntegrityReportSchema.extend(
	{},
) satisfies z.ZodType<ResyncPlayerResponse>

/**
 * Applies the report's pending changes: records new KHL ids and seasons from
 * the search, then stores each registration as the KHL has it. Returns the
 * report afterward.
 */
export const RESYNC_PLAYER_ENDPOINT = {
	method: "POST",
	uri: "/api/players/:playerId/resync",
	name: "Resync a player",
	description:
		"Stores a player's registrations as the KHL has them, then returns the integrity report.",
	exampleRequest: GET_PLAYER_ENDPOINT.exampleRequest,
	requestSchema: ResyncPlayerRequestSchema,
	responseSchema: ResyncPlayerResponseSchema,
} satisfies ApiEndpoint<ResyncPlayerRequest, ResyncPlayerResponse>

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
	responseSchema: GetTeamResponseSchema,
} satisfies ApiEndpoint<GetTeamRequest, GetTeamResponse>

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
		"A team's latest goals and penalties in a season, newest first. Games whose scoresheets haven't been loaded yet are left out and counted in `pendingGames`; ask again shortly to get them.",
	exampleRequest: {teamId: "20868", season: "2143"},
	requestSchema: GetTeamActivityRequestSchema,
	responseSchema: GetTeamActivityResponseSchema,
} satisfies ApiEndpoint<GetTeamActivityRequest, GetTeamActivityResponse>

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

export interface GetGameResponse {
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

export const GetGameResponseSchema = z.object({
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
}) satisfies z.ZodType<GetGameResponse>

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
	responseSchema: GetGameResponseSchema,
} satisfies ApiEndpoint<GetGameRequest, GetGameResponse>

export interface TeamsDivision {
	name: string
	/** By name */
	teams: KHLTeam[]
}

export const TeamsDivisionSchema = z.object({
	name: z.string(),
	teams: z.array(KHLTeamSchema),
}) satisfies z.ZodType<TeamsDivision>

export interface ListTeamsResponse {
	/** The season being listed */
	season: KHLSeason
	/** Every league season, newest first */
	seasons: KHLSeason[]
	/** In the league's order */
	divisions: TeamsDivision[]
}

export const ListTeamsResponseSchema = z.object({
	season: KHLSeasonSchema,
	seasons: z.array(KHLSeasonSchema),
	divisions: z.array(TeamsDivisionSchema),
}) satisfies z.ZodType<ListTeamsResponse>

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
	responseSchema: ListTeamsResponseSchema,
} satisfies ApiEndpoint<ListTeamsRequest, ListTeamsResponse>

export interface ListTeamSeasonsResponse {
	/** Every season the team played, newest first */
	seasons: KHLSeason[]
}

export const ListTeamSeasonsResponseSchema = z.object({
	seasons: z.array(KHLSeasonSchema),
}) satisfies z.ZodType<ListTeamSeasonsResponse>

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
	responseSchema: ListTeamSeasonsResponseSchema,
} satisfies ApiEndpoint<ListTeamSeasonsRequest, ListTeamSeasonsResponse>

export interface GetStandingsResponse {
	/** The season being shown */
	season: KHLSeason
	/** Every league season, newest first */
	seasons: KHLSeason[]
	/** In the league's order; divisions without teams are left out */
	divisions: KHLStandingsDivision[]
}

export const GetStandingsResponseSchema = z.object({
	season: KHLSeasonSchema,
	seasons: z.array(KHLSeasonSchema),
	divisions: z.array(KHLStandingsDivisionSchema),
}) satisfies z.ZodType<GetStandingsResponse>

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
	responseSchema: GetStandingsResponseSchema,
} satisfies ApiEndpoint<GetStandingsRequest, GetStandingsResponse>

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

export interface ListPlayersResponse {
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
	/** Teams missing from the lists because their stats haven't synced */
	unsyncedTeams: KHLTeam[]
	/**
	 * Whether the server's background sync is running, so unsynced teams
	 * will load on their own (always in production; dev runs it on request)
	 */
	isSyncing: boolean
}

export const ListPlayersResponseSchema = z.object({
	season: KHLSeasonSchema,
	seasons: z.array(KHLSeasonSchema),
	teams: z.array(PlayersTeamSchema),
	skaters: z.array(LeaguePlayerSchema),
	goalies: z.array(LeaguePlayerSchema),
	unavailableTeams: z.array(KHLTeamSchema),
	unsyncedTeams: z.array(KHLTeamSchema),
	isSyncing: z.boolean(),
}) satisfies z.ZodType<ListPlayersResponse>

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
	responseSchema: ListPlayersResponseSchema,
} satisfies ApiEndpoint<ListPlayersRequest, ListPlayersResponse>

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

export interface GetMatchupResponse {
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

export const GetMatchupResponseSchema = z.object({
	currentSeason: KHLSeasonSchema,
	a: MatchupTeamSchema,
	b: MatchupTeamSchema,
	headToHead: z.array(HeadToHeadGameSchema),
	upcoming: z.array(UpcomingGameSchema),
	previewStats: KHLGamePreviewStatsSchema.nullable(),
}) satisfies z.ZodType<GetMatchupResponse>

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
	name: "Get matchup",
	description:
		"Two teams' seasons side by side, like the league's game previews: records, recent form, rosters, special teams, and the games between them. Pass the same team twice with different seasons to compare a team with itself.",
	exampleRequest: {a: "303", b: "684"},
	requestSchema: GetMatchupRequestSchema,
	responseSchema: GetMatchupResponseSchema,
} satisfies ApiEndpoint<GetMatchupRequest, GetMatchupResponse>

export interface GetHeadToHeadResponse {
	/** Finished games between the two teams, newest first */
	headToHead: HeadToHeadGame[]
}

export const GetHeadToHeadResponseSchema = z.object({
	headToHead: z.array(HeadToHeadGameSchema),
}) satisfies z.ZodType<GetHeadToHeadResponse>

export interface GetHeadToHeadRequest {
	a: string
	b: string
}

export const GetHeadToHeadRequestSchema = z.object({
	a: z.string().min(1).describe("KHL team id, from the current season"),
	b: z.string().min(1).describe("KHL team id, from the current season"),
}) satisfies z.ZodType<GetHeadToHeadRequest>

export const GET_HEAD_TO_HEAD_ENDPOINT = {
	method: "GET",
	uri: "/api/head-to-head",
	name: "Get head-to-head",
	description:
		"Finished games between two current-season teams in recent seasons, newest first. The lighter half of the matchup endpoint, for game cards.",
	exampleRequest: {a: "303", b: "684"},
	requestSchema: GetHeadToHeadRequestSchema,
	responseSchema: GetHeadToHeadResponseSchema,
} satisfies ApiEndpoint<GetHeadToHeadRequest, GetHeadToHeadResponse>

export interface ListRinksResponse {
	season: KHLSeason
	rinks: Rink[]
}

export const ListRinksResponseSchema = z.object({
	season: KHLSeasonSchema,
	rinks: z.array(RinkSchema),
}) satisfies z.ZodType<ListRinksResponse>

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
	responseSchema: ListRinksResponseSchema,
} satisfies ApiEndpoint<ListRinksRequest, ListRinksResponse>

export interface ListGamesResponse {
	season: KHLSeason
	/** The days' games, earliest first */
	games: UpcomingGame[]
}

export const ListGamesResponseSchema = z.object({
	season: KHLSeasonSchema,
	games: z.array(UpcomingGameSchema),
}) satisfies z.ZodType<ListGamesResponse>

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
	responseSchema: ListGamesResponseSchema,
} satisfies ApiEndpoint<ListGamesRequest, ListGamesResponse>

/** A finished game at a rink, with its replay */
export interface RecentRinkGame {
	game: RinkGame
	livebarn: LiveBarnLink[]
}

export const RecentRinkGameSchema = z.object({
	game: RinkGameSchema,
	livebarn: z.array(LiveBarnLinkSchema),
}) satisfies z.ZodType<RecentRinkGame>

export interface GetRinkResponse {
	season: KHLSeason
	rink: Rink
	/** From the KHL arena page */
	address: string | null
	/** The latest finished games here, newest first */
	recent: RecentRinkGame[]
}

export const GetRinkResponseSchema = z.object({
	season: KHLSeasonSchema,
	rink: RinkSchema,
	address: z.string().nullable(),
	recent: z.array(RecentRinkGameSchema),
}) satisfies z.ZodType<GetRinkResponse>

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
	responseSchema: GetRinkResponseSchema,
} satisfies ApiEndpoint<GetRinkRequest, GetRinkResponse>

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

/** A component's checks over one bar of the history */
export interface StatusBucket {
	/** When the bar starts, ISO 8601 UTC; it covers `bucketMinutes` */
	start: string
	checks: number
	degraded: number
	outages: number
}

export const StatusBucketSchema = z.object({
	start: z.string(),
	checks: z.number(),
	degraded: z.number(),
	outages: z.number(),
}) satisfies z.ZodType<StatusBucket>

export interface StatusComponent {
	id: string
	name: string
	description: string
	/** Null until the first check has run */
	latest: StatusCheck | null
	/** Buckets with checks, oldest first; ones without any are left out */
	buckets: StatusBucket[]
}

export const StatusComponentSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	latest: StatusCheckSchema.nullable(),
	buckets: z.array(StatusBucketSchema),
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

/**
 * How a background job is doing: failing once its last run failed, stalled
 * once a run is well past its timeout or the next one is well overdue
 */
export type JobHealth = "ok" | "failing" | "stalled"

export const JobHealthSchema = z.enum([
	"ok",
	"failing",
	"stalled",
]) satisfies z.ZodType<JobHealth>

/** A background job on the server (see server/Jobs.ts) */
export interface JobStatus {
	id: string
	name: string
	description: string
	health: JobHealth
	/** Whether a run is in flight */
	running: boolean
	/** Runs since the server started */
	runs: number
	/** ISO 8601; null until it first runs */
	lastStartedAt: string | null
	/** ISO 8601; null until a run finishes */
	lastFinishedAt: string | null
	lastDurationMs: number | null
	/** The last run's error; null if it succeeded */
	lastError: string | null
	/** Failed runs in a row */
	consecutiveFailures: number
	/** ISO 8601; null while a run is in flight */
	nextRunAt: string | null
}

export const JobStatusSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	health: JobHealthSchema,
	running: z.boolean(),
	runs: z.number(),
	lastStartedAt: z.string().nullable(),
	lastFinishedAt: z.string().nullable(),
	lastDurationMs: z.number().nullable(),
	lastError: z.string().nullable(),
	consecutiveFailures: z.number(),
	nextRunAt: z.string().nullable(),
}) satisfies z.ZodType<JobStatus>
/** A kind of KHL page the syncer keeps (see server/SyncPages.ts) */
export type SyncPageKind =
	"teams" | "schedule" | "team-stats" | "player" | "game"

export const SyncPageKindSchema = z.enum([
	"teams",
	"schedule",
	"team-stats",
	"player",
	"game",
]) satisfies z.ZodType<SyncPageKind>

/** How far the sync has got with one kind of page */
export interface SyncKindStatus {
	kind: SyncPageKind
	/** Pages queued */
	total: number
	/** Pages synced at least once */
	synced: number
	/** Pages whose last sync failed, waiting to be retried */
	failing: number
	/** Pages due now, waiting their turn */
	due: number
	/** Pages queued, synced, and failing for the current season */
	current: {total: number; synced: number; failing: number}
}

export const SyncKindStatusSchema = z.object({
	kind: SyncPageKindSchema,
	total: z.number(),
	synced: z.number(),
	failing: z.number(),
	due: z.number(),
	current: z.object({
		total: z.number(),
		synced: z.number(),
		failing: z.number(),
	}),
}) satisfies z.ZodType<SyncKindStatus>

/** A page whose last sync failed */
export interface SyncFailure {
	kind: SyncPageKind
	/** The KHL page */
	url: string
	/** The last error, cut short if it's long */
	error: string
	/** Failures in a row */
	attempts: number
	/** When it's tried again, ISO 8601 */
	retryAt: string
}

export const SyncFailureSchema = z.object({
	kind: SyncPageKindSchema,
	url: z.string(),
	error: z.string(),
	attempts: z.number(),
	retryAt: z.string(),
}) satisfies z.ZodType<SyncFailure>

/** How the synced copy of the league is doing */
export interface SyncStatus {
	/** Null until the league's default teams page has synced */
	currentSeason: {id: string; name: string} | null
	/** Each kind of page that's queued */
	kinds: SyncKindStatus[]
	/** When a page last synced, ISO 8601; null if none has */
	lastSyncedAt: string | null
	/** When the next page that isn't due yet is, ISO 8601; null if none */
	nextDueAt: string | null
	/** The most urgent failing pages (all of them are counted in `kinds`) */
	failures: SyncFailure[]
}

export const SyncStatusSchema = z.object({
	currentSeason: z.object({id: z.string(), name: z.string()}).nullable(),
	kinds: z.array(SyncKindStatusSchema),
	lastSyncedAt: z.string().nullable(),
	nextDueAt: z.string().nullable(),
	failures: z.array(SyncFailureSchema),
}) satisfies z.ZodType<SyncStatus>

export interface GetStatusResponse {
	/** When each bucket of the history starts, oldest first (ISO 8601 UTC) */
	historyBuckets: string[]
	/** How long each bucket covers */
	bucketMinutes: number
	/** How often each component is checked */
	intervalMinutes: number
	components: StatusComponent[]
	jobs: JobStatus[]
	sync: SyncStatus
	deploy: DeployInfo
}

export const GetStatusResponseSchema = z.object({
	historyBuckets: z.array(z.string()),
	bucketMinutes: z.number(),
	intervalMinutes: z.number(),
	components: z.array(StatusComponentSchema),
	jobs: z.array(JobStatusSchema),
	sync: SyncStatusSchema,
	deploy: DeployInfoSchema,
}) satisfies z.ZodType<GetStatusResponse>

export type GetStatusRequest = Record<string, never>

export const GetStatusRequestSchema = z.object(
	{},
) satisfies z.ZodType<GetStatusRequest>

export const GET_STATUS_ENDPOINT = {
	method: "GET",
	uri: "/api/status",
	name: "Get site status",
	description:
		"The site's health: each component's latest check and daily history, how far the sync with the KHL has got, and which build is running.",
	exampleRequest: {},
	requestSchema: GetStatusRequestSchema,
	responseSchema: GetStatusResponseSchema,
} satisfies ApiEndpoint<GetStatusRequest, GetStatusResponse>

export type ClientLogLevel = "debug" | "info" | "warn" | "error"

/** One log message from the browser, as sent to SEND_LOGS_ENDPOINT. */
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

export interface SendLogsRequest {
	sessionId: string
	userAgent: string
	logs: ClientLog[]
}

export const SendLogsRequestSchema = z.object({
	sessionId: z
		.string()
		.max(100)
		.describe("Random per page load, to group one visit's logs"),
	userAgent: z.string().max(500).describe("The browser's user agent"),
	logs: z.array(ClientLogSchema).min(1).max(100).describe("1 to 100 logs"),
}) satisfies z.ZodType<SendLogsRequest>

export interface SendLogsResponse {
	ok: true
}

export const SendLogsResponseSchema = z.object({
	ok: z.literal(true),
}) satisfies z.ZodType<SendLogsResponse>

export const SEND_LOGS_ENDPOINT = {
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
	requestSchema: SendLogsRequestSchema,
	responseSchema: SendLogsResponseSchema,
} satisfies ApiEndpoint<SendLogsRequest, SendLogsResponse>

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

export interface RunBenchmarkResponse {
	runs: BenchmarkRun[]
	summaries: BenchmarkSummary[]
}

export const RunBenchmarkResponseSchema = z.object({
	runs: z.array(BenchmarkRunSchema),
	summaries: z.array(BenchmarkSummarySchema),
}) satisfies z.ZodType<RunBenchmarkResponse>

export const RUN_BENCHMARK_ENDPOINT = {
	method: "POST",
	uri: "/api/admin/benchmark",
	name: "Run the benchmark",
	description:
		"Dev only: times KHL+ against the league's site in headless Chrome (see tools/Benchmark.ts). Takes several seconds per name.",
	exampleRequest: {names: DEFAULT_BENCHMARK_NAMES.slice(0, 1)},
	requestSchema: RunBenchmarkRequestSchema,
	responseSchema: RunBenchmarkResponseSchema,
} satisfies ApiEndpoint<RunBenchmarkRequest, RunBenchmarkResponse>

export interface DevSettings {
	offline: boolean
}

export const DevSettingsSchema = z.object({
	offline: z
		.boolean()
		.describe(
			"Never fetch from the KHL or LiveBarn; serve only stored pages",
		),
}) satisfies z.ZodType<DevSettings>

export interface DevSettingsState extends DevSettings {
	/** Whether the background sync loop runs (KHL_SYNC; always in production) */
	syncLoop: boolean
}

export const DevSettingsStateSchema = DevSettingsSchema.extend({
	syncLoop: z.boolean(),
}) satisfies z.ZodType<DevSettingsState>

export type GetDevSettingsResponse = DevSettingsState

export const GetDevSettingsResponseSchema = DevSettingsStateSchema.extend(
	{},
) satisfies z.ZodType<GetDevSettingsResponse>

export type GetDevSettingsRequest = Record<string, never>

export const GetDevSettingsRequestSchema = z.object(
	{},
) satisfies z.ZodType<GetDevSettingsRequest>

export const GET_DEV_SETTINGS_ENDPOINT = {
	method: "GET",
	uri: "/api/admin/settings",
	name: "Get dev settings",
	description:
		"Dev only: whether the server is in offline mode, and whether the background sync loop runs.",
	exampleRequest: {},
	requestSchema: GetDevSettingsRequestSchema,
	responseSchema: GetDevSettingsResponseSchema,
} satisfies ApiEndpoint<GetDevSettingsRequest, GetDevSettingsResponse>

export type UpdateDevSettingsRequest = DevSettings

export const UpdateDevSettingsRequestSchema = DevSettingsSchema.extend(
	{},
) satisfies z.ZodType<UpdateDevSettingsRequest>

export type UpdateDevSettingsResponse = DevSettingsState

export const UpdateDevSettingsResponseSchema = DevSettingsStateSchema.extend(
	{},
) satisfies z.ZodType<UpdateDevSettingsResponse>

export const UPDATE_DEV_SETTINGS_ENDPOINT = {
	method: "PUT",
	uri: "/api/admin/settings",
	name: "Update dev settings",
	description:
		"Dev only: turns offline mode on or off. Kept in data/dev-settings.json, so it survives restarts.",
	exampleRequest: {offline: true},
	requestSchema: UpdateDevSettingsRequestSchema,
	responseSchema: UpdateDevSettingsResponseSchema,
} satisfies ApiEndpoint<UpdateDevSettingsRequest, UpdateDevSettingsResponse>

export interface PullProdDataRequest {
	sources: boolean
}

export const PullProdDataRequestSchema = z.object({
	sources: z
		.boolean()
		.describe(
			"Also pull every stored page (1.5-3 GB), to reprocess after a parser change",
		),
}) satisfies z.ZodType<PullProdDataRequest>

export interface PulledDatabase {
	name: "khl" | "sources"
	/** The snapshot's size, in megabytes */
	mb: number
}

export interface PullProdDataResponse {
	pulled: PulledDatabase[]
	/** Where the dev database was backed up before it was replaced */
	backupPath: string
	ms: number
}

export const PullProdDataResponseSchema = z.object({
	pulled: z.array(
		z.object({name: z.enum(["khl", "sources"]), mb: z.number()}),
	),
	backupPath: z.string(),
	ms: z.number(),
}) satisfies z.ZodType<PullProdDataResponse>

export const PULL_PROD_DATA_ENDPOINT = {
	method: "POST",
	uri: "/api/admin/pull-prod-data",
	name: "Pull production's data",
	description:
		"Dev only: replaces the dev server's league tables and player ids (and, with sources, its stored pages) with snapshots of production's. Takes a minute or more.",
	exampleRequest: {sources: false},
	requestSchema: PullProdDataRequestSchema,
	responseSchema: PullProdDataResponseSchema,
} satisfies ApiEndpoint<PullProdDataRequest, PullProdDataResponse>

export interface ApiDocsSection {
	title: string
	endpoints: ApiEndpoint<ApiRequest, unknown>[]
}

/**
 * The /api page, in order. Endpoints are internal (left off the page) unless
 * listed here, so a new endpoint is only public once it's added.
 */
export const API_DOCS_SECTIONS: ApiDocsSection[] = [
	{title: "Search", endpoints: [SEARCH_ENDPOINT]},
	{
		title: "Games",
		endpoints: [
			LIST_GAMES_ENDPOINT,
			GET_GAME_ENDPOINT,
			GET_MATCHUP_ENDPOINT,
			GET_HEAD_TO_HEAD_ENDPOINT,
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
