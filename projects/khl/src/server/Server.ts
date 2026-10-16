import * as fs from "fs"
import * as path from "path"
import {ConsoleTransport, Logger, setLoggerTransports} from "@dvdzkwsk/logger"
import {ApiError, registerEndpoint} from "@dvdzkwsk/util/ApiServerUtil"
import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import compression from "compression"
import express from "express"
import {
	ArenaMapping,
	getArenaName,
	KHL_ARENA_LIVEBARN_SURFACES,
	LiveBarnSurfaceMapping,
	toDisplayArena,
} from "./Arenas.js"
import {openDatabase, Registration} from "./Database.js"
import {
	KHL_ALL_SEASONS,
	getKHLArena,
	getKHLBoxScore,
	getKHLGamePreviewStats,
	getKHLGameStats,
	getKHLScoreboard,
	getKHLLeagueSchedule,
	getKHLTeamStats,
	getKHLPlayer,
	getKHLStandings,
	getKHLTeamSchedule,
	getKHLTeamsPage,
	searchKHLPlayers,
} from "./KHL.js"
import {getLivebarnVenues} from "./LiveBarn.js"
import {DEPLOY_INFO, getStatus, startStatusChecks} from "./Status.js"
import {
	ActivityAttendance,
	ActivityEvent,
	ActivityGame,
	ActivityKind,
	ActivityResponse,
	DEFAULT_ACTIVITY_KINDS,
	FeedGame,
	GameResponse,
	GET_GAME_ENDPOINT,
	GET_MATCHUP_ENDPOINT,
	LIST_PLAYERS_ENDPOINT,
	LIST_TEAMS_ENDPOINT,
	LIST_TEAM_SEASONS_ENDPOINT,
	MatchupResponse,
	MatchupTeam,
	RecentGame,
	toRecentGame,
	TeamSeasonsResponse,
	TeamsResponse,
	HeadToHeadGame,
	GET_PLAYER_ENDPOINT,
	GET_PLAYER_ACTIVITY_ENDPOINT,
	GET_PLAYER_RECENT_PENALTIES_ENDPOINT,
	GET_TEAM_ACTIVITY_ENDPOINT,
	GET_TEAM_ENDPOINT,
	GET_RINK_ENDPOINT,
	GET_STATUS_ENDPOINT,
	GET_STANDINGS_ENDPOINT,
	LIST_GAMES_ENDPOINT,
	GamesResponse,
	LIST_RINKS_ENDPOINT,
	LOG_ENDPOINT,
	RUN_BENCHMARK_ENDPOINT,
	Rink,
	RinkGame,
	RecentRinkGame,
	RinkInfo,
	RinkResponse,
	RinkTeam,
	RosterPlayer,
	TeamRoster,
	UpcomingGame,
	LiveBarnLink,
	PlayerResponse,
	PlayersResponse,
	PlayerSearchGroup,
	RecentPenalties,
	SEARCH_ENDPOINT,
	UnavailableSchedule,
	SearchResponse,
	SeasonSummary,
	StandingsResponse,
	TeamResponse,
} from "../shared/ApiJson.js"
import {getCity} from "../shared/Cities.js"
import {LIMITS} from "../shared/KHLConfig.js"
import {
	compareGameEvents,
	getGoalsByTeam,
	getLineupAttendance,
	KHLBoxScore,
	KHLBoxScoreTeam,
	KHLGame,
	KHLGamePreviewStats,
	KHLGameStats,
	KHLGameTeamStats,
	KHLLeagueGame,
	KHLScoreboardGame,
	KHLScoreboardTeam,
	KHLLeagueTeam,
	KHLRosterRow,
	KHLSeason,
	KHLTeam,
	KHLTeamStats,
	KHLTeamsPage,
	normalizePlayerName,
} from "../shared/KHLJson.js"
import {
	DAY_MS as DAY,
	getLeagueDayKey,
	getLeagueLocalTime,
	HOUR_MS as HOUR,
	MINUTE_MS as MINUTE,
} from "../shared/LeagueTime.js"
import {getLiveBarnLiveUrl, getLiveBarnVodUrl} from "../shared/LiveBarn.js"
import {LiveBarnSurface, LiveBarnVenue} from "../shared/LiveBarnJson.js"

setLoggerTransports([new ConsoleTransport({verbose: true})])
const logger = new Logger("Server")

// Defaults suit local dev; the Fly.io image (see Dockerfile/fly.toml) runs a
// bundled copy of this file and points these at its own layout.
const PORT = Number(process.env.KHL_API_PORT ?? 3001)
// Relative to projects/khl, two levels above src/server/
const PROJECT_DIR = path.join(import.meta.dirname, "../..")
const DIST_DIR =
	process.env.KHL_STATIC_DIR ?? path.join(PROJECT_DIR, "dist/website")
const DB_PATH =
	process.env.KHL_DB_PATH ?? path.join(PROJECT_DIR, "data/khl.sqlite")

const db = openDatabase(DB_PATH)

const app = express()

// The league-wide players list is ~700kb of JSON, ~150kb gzipped
app.use(compression())

// Client log batches with stack traces can outgrow the 100kb default
app.use(express.json({limit: "512kb"}))

app.get("/api/health", (_req, res) => {
	res.json({ok: true, commit: DEPLOY_INFO.commit, dirty: DEPLOY_INFO.dirty})
})

registerEndpoint(app, GET_STATUS_ENDPOINT, async () => getStatus(db))

// Dev only: drives headless Chrome, which the deployed image doesn't have.
// Imported by path at request time so puppeteer stays out of the bundle.
if (process.env.NODE_ENV !== "production") {
	let benchmarkRunning = false
	registerEndpoint(app, RUN_BENCHMARK_ENDPOINT, async ({names}) => {
		if (benchmarkRunning) {
			throw new ApiError(409, "a benchmark is already running")
		}
		benchmarkRunning = true
		try {
			const benchmarkPath = path.join(PROJECT_DIR, "tools/Benchmark.ts")
			const {runBenchmark} = (await import(
				benchmarkPath
			)) as typeof import("../../tools/Benchmark.js")
			return await runBenchmark(names)
		} finally {
			benchmarkRunning = false
		}
	})
}

registerEndpoint(app, SEARCH_ENDPOINT, async ({q}) => {
	const query = q.trim()
	const teamsPage = await getTeamsPage()
	const response: SearchResponse = {
		season: teamsPage.season,
		players: [],
		teams: [],
		rinks: [],
	}
	if (query.length < 2) {
		return response
	}

	const registrations = await cached(
		`search:${query.toLowerCase()}:${teamsPage.season.id}`,
		10 * MINUTE,
		() => searchKHLPlayers(query, teamsPage.season.id),
	)
	const playerIds = db.recordRegistrations(registrations)
	const groups = new Map<string, PlayerSearchGroup>()
	for (const registration of registrations) {
		const playerId = playerIds.get(registration.playerId)!
		let group = groups.get(playerId)
		if (!group) {
			group = {playerId, name: registration.name, registrations: []}
			groups.set(playerId, group)
		}
		group.registrations.push(registration)
	}
	response.players = [...groups.values()]

	const needle = query.toLowerCase()
	response.rinks = Object.entries(KHL_ARENA_LIVEBARN_SURFACES)
		.filter(([, arena]) => {
			const cityName = getCity(arena.city)?.name ?? ""
			return (
				getMappedArenaName(arena).toLowerCase().includes(needle) ||
				cityName.toLowerCase().includes(needle)
			)
		})
		.map(([arenaId, arena]) => ({
			arenaId,
			name: getMappedArenaName(arena),
			city: arena.city,
		}))
	response.teams = teamsPage.teams
		.filter((team) => team.name.toLowerCase().includes(needle))
		.map((team) => {
			return {
				team,
				divisionName: getDivisionName(teamsPage, team.divisionId),
			}
		})
	return response
})

registerEndpoint(app, GET_PLAYER_ENDPOINT, async ({playerId}) => {
	const {player, registrations} = await getPlayerRegistrations(playerId)

	const teamsPage = await getTeamsPage()
	const currentSeason = teamsPage.season

	// The KHL site 500s on some old pages, so one bad page shouldn't fail the
	// whole player: missing profiles and schedules are skipped and reported.
	const [profiles, schedules] = await Promise.all([
		Promise.all(
			registrations.map(async (r) => {
				try {
					return await getPlayer(
						r.khlPlayerId,
						r.teamId,
						r.seasonIds.at(-1)!,
					)
				} catch (error) {
					logger.warn("getPlayer", "KHL player page unavailable", {
						khlPlayerId: r.khlPlayerId,
						error,
					})
					return null
				}
			}),
		),
		getPlayerSchedules(registrations, teamsPage),
	])

	const response: PlayerResponse = {
		playerId,
		name: player.name,
		currentSeason,
		registrations: registrations.map((r, i) => {
			return {
				khlPlayerId: r.khlPlayerId,
				teamId: r.teamId,
				teamName: r.teamName,
				teamLogoUrl: r.teamLogoUrl,
				seasonIds: r.seasonIds,
				profile: profiles[i] ?? null,
			}
		}),
		games: await toFeedGames(schedules.games, [teamsPage]),
		unavailableSchedules: schedules.unavailable,
		upcoming: await getUpcomingGames(
			new Set(
				registrations
					.filter((r) => r.seasonIds.includes(currentSeason.id))
					.map((r) => r.teamId),
			),
		),
	}
	return response
})

// Separate from the player, since it reads a page per recent game
registerEndpoint(
	app,
	GET_PLAYER_RECENT_PENALTIES_ENDPOINT,
	async ({playerId}): Promise<RecentPenalties> => {
		const games = await getActivity(
			{kind: "player", playerId},
			{
				kinds: ["penalty", "played"],
				lookbackDays: LIMITS.BADGE_TREND_LOOKBACK_DAYS,
				maxEvents: Infinity,
			},
		)
		return {
			games: games.length,
			penalties: games.reduce((total, g) => total + g.events.length, 0),
		}
	},
)

registerEndpoint(
	app,
	GET_PLAYER_ACTIVITY_ENDPOINT,
	async ({playerId, kinds}) => {
		return toActivityResponse(
			await getActivity({kind: "player", playerId}, {kinds}),
		)
	},
)

/** The player's registrations, most recently active first. */
async function getPlayerRegistrations(playerId: string) {
	const player = db.getPlayer(playerId)
	if (!player) {
		throw new ApiError(404, `player ${playerId} not found`)
	}

	// Pick up registrations from every season (including teams the player
	// joined since we last looked) before reading them back.
	const nameKey = normalizePlayerName(player.name)
	await cached(`history:${nameKey}`, HOUR, async () => {
		const results = await searchKHLPlayers(player.name, KHL_ALL_SEASONS)
		db.recordRegistrations(
			results.filter((r) => normalizePlayerName(r.name) === nameKey),
		)
	})
	const registrations = db
		.getRegistrations(playerId)
		.filter((r) => r.seasonIds.length > 0)
		.sort((a, b) => Number(b.seasonIds.at(-1)) - Number(a.seasonIds.at(-1)))
	return {player, registrations}
}

/**
 * Every game of every team and season the player was on. A schedule the KHL
 * site fails to load is skipped and reported in `unavailable`.
 */
async function getPlayerSchedules(
	registrations: Registration[],
	teamsPage: KHLTeamsPage,
): Promise<{games: KHLGame[]; unavailable: UnavailableSchedule[]}> {
	// One schedule per team per season the player was on it
	const teamSeasons = new Map<
		string,
		{teamId: string; teamName: string; seasonId: string}
	>()
	for (const r of registrations) {
		for (const seasonId of r.seasonIds) {
			teamSeasons.set(`${r.teamId}:${seasonId}`, {
				teamId: r.teamId,
				teamName: r.teamName,
				seasonId,
			})
		}
	}
	const unavailable: UnavailableSchedule[] = []
	const schedules = await Promise.all(
		[...teamSeasons.values()].map(async ({teamId, teamName, seasonId}) => {
			try {
				return await getSchedule(
					teamId,
					seasonId,
					seasonId === teamsPage.season.id,
				)
			} catch (error) {
				logger.warn("getSchedule", "KHL schedule unavailable", {
					teamId,
					seasonId,
					error,
				})
				unavailable.push({
					teamId,
					teamName,
					seasonId,
					seasonName:
						teamsPage.seasons.find((s) => s.id === seasonId)
							?.name ?? null,
				})
				return []
			}
		}),
	)
	return {games: schedules.flat(), unavailable}
}

/** Whose activity it is, by our ids */
type ActivitySubject =
	| {kind: "player"; playerId: string}
	| {kind: "team"; teamId: string; season?: string}

/** A game in a subject's activity, before it's shaped for the API */
interface ActivityRow {
	game: KHLGame
	boxScore: KHLBoxScore
	/** The subject's side of the box score */
	team: KHLBoxScoreTeam
	attendance: ActivityAttendance
	/** Latest first */
	events: ActivityEvent[]
}

/**
 * The subject's final games from the `lookbackDays` before their latest one
 * that have a requested event or attendance (see ActivityKind), newest first,
 * with at most `maxEvents` events in all. A player's team schedules include
 * games they sat out, so each game's stats page says whether they dressed
 * before its box score is read. Pages are read a batch at a time, newest game
 * first, and a game whose pages fail to load is left out.
 */
async function getActivity(
	subject: ActivitySubject,
	{
		kinds = DEFAULT_ACTIVITY_KINDS,
		lookbackDays = LIMITS.ACTIVITY_MAX_LOOKBACK_DAYS,
		maxEvents = LIMITS.ACTIVITY_EVENTS,
	}: {kinds?: ActivityKind[]; lookbackDays?: number; maxEvents?: number} = {},
): Promise<ActivityRow[]> {
	const {games, getEvents, getAttendance} = await getActivitySubject(subject)
	const wanted = new Set(kinds)
	const wantsEvents = kinds.some((kind) => {
		return kind !== "played" && kind !== "skipped"
	})
	// Once there are enough events, older games can only add more, unless
	// games are wanted for their attendance alone
	const canStopEarly = !wanted.has("played") && !wanted.has("skipped")

	const finals = [
		...new Map(
			games
				.filter((game) => game.isFinal && game.id)
				.sort((a, b) => b.startsAt.localeCompare(a.startsAt))
				.map((game) => [game.id!, game]),
		).values(),
	]
	const since = finals[0]
		? Date.parse(finals[0].startsAt) - lookbackDays * DAY
		: 0
	const recent = finals.filter((game) => Date.parse(game.startsAt) >= since)

	const readRow = async (game: KHLGame): Promise<ActivityRow | null> => {
		const attendance = await getAttendance(game)
		const isWanted =
			attendance === "skipped"
				? wanted.has("skipped")
				: wantsEvents || wanted.has("played")
		if (!isWanted) {
			return null
		}
		const boxScore = await getBoxScore(game.id!).catch((error: unknown) => {
			logger.warn("getActivity", "box score unavailable", {
				gameId: game.id,
				error,
			})
			return null
		})
		const team = [boxScore?.away, boxScore?.home].find(
			(side) => side?.id === game.team.id,
		)
		if (!boxScore || !team) {
			return null
		}
		const events =
			attendance === "skipped"
				? []
				: getEvents(boxScore)
						.filter((event) => wanted.has(event.kind))
						.sort((a, b) =>
							compareGameEvents(getEventAt(b), getEventAt(a)),
						)
		return {game, boxScore, team, attendance, events}
	}

	const batchSize = canStopEarly ? 5 : 25
	const rows: ActivityRow[] = []
	let count = 0
	for (
		let i = 0;
		i < recent.length && (!canStopEarly || count < maxEvents);
		i += batchSize
	) {
		const batch = await Promise.all(
			recent.slice(i, i + batchSize).map(readRow),
		)
		for (const row of batch) {
			if (!row) {
				continue
			}
			row.events = row.events.slice(0, Math.max(0, maxEvents - count))
			if (row.events.length === 0 && !wanted.has(row.attendance)) {
				continue
			}
			count += row.events.length
			rows.push(row)
		}
	}
	return rows
}

/**
 * A subject's games, its events in a box score (in any order), and whether it
 * dressed for a game. A player can have a KHL player id per team they were on.
 */
async function getActivitySubject(subject: ActivitySubject): Promise<{
	games: KHLGame[]
	getEvents: (boxScore: KHLBoxScore) => ActivityEvent[]
	getAttendance: (game: KHLGame) => Promise<ActivityAttendance>
}> {
	if (subject.kind === "team") {
		const {team, isCurrentSeason} = await getListedTeam(
			subject.teamId,
			subject.season,
		)
		return {
			games: await getSchedule(team.id, team.seasonId, isCurrentSeason),
			getEvents: (boxScore) => [
				...boxScore.goals
					.filter((goal) => goal.teamId === team.id)
					.map((goal): ActivityEvent => ({kind: "goal", goal})),
				...boxScore.penalties
					.filter((penalty) => penalty.teamId === team.id)
					.map((penalty): ActivityEvent => ({
						kind: "penalty",
						penalty,
					})),
			],
			getAttendance: async () => "played",
		}
	}

	const {registrations} = await getPlayerRegistrations(subject.playerId)
	const {games} = await getPlayerSchedules(
		registrations,
		await getTeamsPage(),
	)
	const khlPlayerIds = new Set(registrations.map((r) => r.khlPlayerId))
	const isPlayer = (player: {id: string} | null) => {
		return !!player && khlPlayerIds.has(player.id)
	}
	return {
		games,
		getEvents: (boxScore) => [
			...boxScore.goals.flatMap((goal): ActivityEvent[] => {
				if (isPlayer(goal.scorer)) {
					return [{kind: "goal", goal}]
				}
				return goal.assists.some(isPlayer)
					? [{kind: "assist", goal}]
					: []
			}),
			...boxScore.penalties
				.filter((penalty) => isPlayer(penalty.player))
				.map((penalty): ActivityEvent => ({kind: "penalty", penalty})),
		],
		getAttendance: async (game) => {
			try {
				const stats = await getGameStats(game.id!)
				// Not posted yet: count it, so a late lineup never hides goals
				return (
					getLineupAttendance(khlPlayerIds, stats[game.homeAway]) ??
					"played"
				)
			} catch (error) {
				logger.warn("getActivity", "game stats unavailable", {
					gameId: game.id,
					error,
				})
				return "played"
			}
		},
	}
}

/** Activity rows as the API returns them, with replay and player links */
async function toActivityResponse(
	rows: ActivityRow[],
): Promise<ActivityResponse> {
	const surfacesByArena = await getSurfacesByArena(rows.map((r) => r.game))
	const playerIds = new Map<string, string>()
	const toActivityTeam = (side: KHLBoxScoreTeam) => ({
		id: side.id,
		name: side.name,
		logoUrl: side.logoUrl,
		seasonId: side.seasonId,
		goals: side.goals,
	})
	const games = rows.map(
		({boxScore, team, attendance, events}): ActivityGame => {
			for (const [khlPlayerId, playerId] of recordBoxScorePlayers(
				boxScore,
			)) {
				playerIds.set(khlPlayerId, playerId)
			}
			const opponent =
				team === boxScore.home ? boxScore.away : boxScore.home
			return {
				gameId: boxScore.gameId,
				startsAt: boxScore.startsAt,
				homeAway: team === boxScore.home ? "home" : "away",
				team: toActivityTeam(team),
				opponent: toActivityTeam(opponent),
				livebarn: toLiveBarnLinks(
					boxScore.arena
						? (surfacesByArena.get(boxScore.arena.id) ?? [])
						: [],
					boxScore,
				),
				attendance,
				events,
			}
		},
	)
	return {games, playerIds: Object.fromEntries(playerIds)}
}

/** When an activity event happened on the scoresheet */
function getEventAt(event: ActivityEvent) {
	return event.kind === "penalty" ? event.penalty : event.goal
}

/** A team as listed in `season` (default: the current one), or a 404 */
async function getListedTeam(teamId: string, season: string | undefined) {
	const [teamsPage, currentSeason] = await Promise.all([
		getTeamsPage(season),
		getCurrentSeason(),
	])
	const team = findListedTeam(teamsPage, teamId)
	if (!team) {
		throw new ApiError(404, `team ${teamId} not found`)
	}
	return {
		team,
		teamsPage,
		isCurrentSeason: team.seasonId === currentSeason.id,
	}
}

registerEndpoint(app, GET_TEAM_ENDPOINT, async ({teamId, season}) => {
	const {team, teamsPage, isCurrentSeason} = await getListedTeam(
		teamId,
		season,
	)
	const [schedule, stats, upcoming] = await Promise.all([
		getSchedule(team.id, team.seasonId, isCurrentSeason),
		getTeamStats(team.id, team.seasonId, isCurrentSeason),
		isCurrentSeason ? getUpcomingGames(new Set([team.id])) : [],
	])
	const response: TeamResponse = {
		team,
		divisionName: getDivisionName(teamsPage, team.divisionId),
		season: teamsPage.season,
		seasons: stats.seasons,
		games: await toFeedGames(schedule, [teamsPage]),
		upcoming,
		roster: await getRoster(team.id, team.name, team.logoUrl, stats),
	}
	return response
})

// Separate from the team, since it reads a page per recent game
registerEndpoint(
	app,
	GET_TEAM_ACTIVITY_ENDPOINT,
	async ({teamId, season, kinds}) => {
		return toActivityResponse(
			await getActivity({kind: "team", teamId, season}, {kinds}),
		)
	},
)

registerEndpoint(app, GET_GAME_ENDPOINT, async ({gameId}) => {
	const [boxScore, currentSeason] = await Promise.all([
		getBoxScore(gameId),
		getCurrentSeason(),
	])
	const {away, home} = boxScore
	// Team pages are extras: if the KHL site fails on one, still show the game
	const getStats = (team: KHLBoxScoreTeam) => {
		const isCurrentSeason = team.seasonId === currentSeason.id
		return getTeamStats(team.id, team.seasonId, isCurrentSeason).catch(
			(error: unknown) => {
				logger.warn("getGame", "KHL team stats unavailable", {
					teamId: team.id,
					seasonId: team.seasonId,
					error,
				})
				return null
			},
		)
	}
	const [surfaces, awayStats, homeStats] = await Promise.all([
		boxScore.arena ? getVerifiedSurfaces(boxScore.arena.id) : [],
		getStats(away),
		getStats(home),
	])
	const [headToHead, rosters, lineups, awayForm, homeForm, previewStats] =
		await Promise.all([
			awayStats && homeStats
				? getHeadToHead(awayStats, homeStats, currentSeason.id, {
						excludeGameId: boxScore.gameId,
					})
				: [],
			awayStats && homeStats
				? Promise.all([
						getRoster(away.id, away.name, away.logoUrl, awayStats),
						getRoster(home.id, home.name, home.logoUrl, homeStats),
					]).then(([away, home]) => ({away, home}))
				: null,
			boxScore.hasSummary ? getGameLineups(boxScore) : null,
			getGameSeasonSummary(away, boxScore.startsAt, currentSeason.id),
			getGameSeasonSummary(home, boxScore.startsAt, currentSeason.id),
			// Extras for the comparison; the game shows without them
			getPreviewStats(gameId),
		])
	const response: GameResponse = {
		boxScore: {...boxScore, arena: toDisplayArena(boxScore.arena)},
		previewStats,
		score: await getFinalScore(boxScore),
		playerIds: Object.fromEntries(recordBoxScorePlayers(boxScore)),
		livebarn: toLiveBarnLinks(surfaces, boxScore),
		headToHead,
		rosters,
		lineups,
		form: {away: awayForm, home: homeForm},
		currentSeason,
	}
	return response
})

registerEndpoint(app, LIST_TEAMS_ENDPOINT, async ({season}) => {
	const teamsPage = await getTeamsPage(season)
	const response: TeamsResponse = {
		season: teamsPage.season,
		seasons: teamsPage.seasons,
		divisions: teamsPage.divisions
			.map((division) => ({
				name: division.name,
				teams: teamsPage.teams
					.filter((t) => t.divisionId === division.id)
					.sort((a, b) => a.name.localeCompare(b.name)),
			}))
			.filter((division) => division.teams.length > 0),
	}
	return response
})

registerEndpoint(app, GET_STANDINGS_ENDPOINT, async ({season}) => {
	const page = await cached(
		`standings:${season ?? "current"}`,
		10 * MINUTE,
		() => {
			return getKHLStandings(season)
		},
	)
	const response: StandingsResponse = {
		season: page.season,
		seasons: page.seasons,
		divisions: page.divisions.filter((d) => d.rows.length > 0),
	}
	return response
})

registerEndpoint(app, LIST_PLAYERS_ENDPOINT, async ({season}) => {
	const [teamsPage, currentSeason] = await Promise.all([
		getTeamsPage(season),
		getCurrentSeason(),
	])
	const isCurrentSeason = teamsPage.season.id === currentSeason.id
	// Built from every team's stats page (~175 of them), so the whole list is
	// kept longer than any one page rather than refetched every 10 minutes
	const ttl = isCurrentSeason ? HOUR : 24 * HOUR
	return cached(
		`players:${teamsPage.season.id}`,
		ttl,
		async () => {
			// One team's page failing leaves it out rather than failing the list
			const unavailableTeams: KHLTeam[] = []
			const rosters = await Promise.all(
				teamsPage.teams.map(async (team) => {
					try {
						const stats = await getTeamStats(
							team.id,
							team.seasonId,
							isCurrentSeason,
						)
						const roster = await getRoster(
							team.id,
							team.name,
							team.logoUrl,
							stats,
						)
						return {team, roster}
					} catch (error) {
						logger.warn(
							"listPlayers",
							"KHL team stats unavailable",
							{
								teamId: team.id,
								seasonId: team.seasonId,
								error,
							},
						)
						unavailableTeams.push(team)
						return null
					}
				}),
			)
			const loaded = rosters.filter((r) => r !== null)
			// Registered players who haven't played (backups, most goalies) have
			// no stats to compare, and would be a third of the list
			const toRows = (team: KHLTeam, players: RosterPlayer[]) => {
				return players
					.filter((p) => Number(p.stats["GP"]) > 0)
					.map((p) => ({...p, teamId: team.id}))
			}
			const response: PlayersResponse = {
				season: teamsPage.season,
				seasons: teamsPage.seasons,
				teams: loaded.map(({team}) => ({
					team,
					divisionName: getDivisionName(teamsPage, team.divisionId),
				})),
				skaters: loaded.flatMap(({team, roster}) =>
					toRows(team, roster.skaters),
				),
				goalies: loaded.flatMap(({team, roster}) =>
					toRows(team, roster.goalies),
				),
				unavailableTeams,
			}
			return response
		},
		// Don't hold on to a partial list for the full hour
		(response) =>
			response.unavailableTeams.length > 0 ? 10 * MINUTE : ttl,
	)
})

registerEndpoint(app, LIST_TEAM_SEASONS_ENDPOINT, async ({teamId, season}) => {
	const currentSeason = await getCurrentSeason()
	const stats = await getTeamStats(
		teamId,
		season,
		season === currentSeason.id,
	)
	const response: TeamSeasonsResponse = {seasons: stats.seasons}
	return response
})

registerEndpoint(
	app,
	GET_MATCHUP_ENDPOINT,
	async ({a, b, aSeason, bSeason}) => {
		const [pageA, pageB, currentSeason] = await Promise.all([
			getTeamsPage(aSeason),
			getTeamsPage(bSeason),
			getCurrentSeason(),
		])
		if (a === b && pageA.season.id === pageB.season.id) {
			throw new ApiError(400, "pick two different teams or seasons")
		}
		const getTeam = (teamsPage: KHLTeamsPage, teamId: string) => {
			const team = findListedTeam(teamsPage, teamId)
			if (!team) {
				throw new ApiError(
					404,
					`team ${teamId} not found in season ${teamsPage.season.id}`,
				)
			}
			return team
		}
		const teamA = getTeam(pageA, a)
		const teamB = getTeam(pageB, b)
		const isCurrentA = teamA.seasonId === currentSeason.id
		const isCurrentB = teamB.seasonId === currentSeason.id
		const [statsA, statsB, scheduleA, scheduleB, upcoming] =
			await Promise.all([
				getTeamStats(teamA.id, teamA.seasonId, isCurrentA),
				getTeamStats(teamB.id, teamB.seasonId, isCurrentB),
				getSchedule(teamA.id, teamA.seasonId, isCurrentA),
				getSchedule(teamB.id, teamB.seasonId, isCurrentB),
				isCurrentA && isCurrentB
					? getUpcomingGames(new Set([teamA.id]))
					: [],
			])
		const toMatchupTeam = async (
			teamsPage: KHLTeamsPage,
			team: KHLTeam,
			stats: KHLTeamStats,
			schedule: KHLGame[],
		): Promise<MatchupTeam> => {
			return {
				team,
				season: teamsPage.season,
				divisionName: getDivisionName(teamsPage, team.divisionId),
				...getSeasonRecord(schedule),
				roster: await getRoster(
					team.id,
					team.name,
					team.logoUrl,
					stats,
				),
			}
		}
		const [matchupA, matchupB, headToHead, previewA, previewB] =
			await Promise.all([
				toMatchupTeam(pageA, teamA, statsA, scheduleA),
				toMatchupTeam(pageB, teamB, statsB, scheduleB),
				// A team against its own past season has no head-to-head
				teamA.id === teamB.id
					? []
					: getHeadToHead(statsA, statsB, currentSeason.id, {
							// The matchup shows each picked season's meetings
							includeSeasonIds: [teamA.seasonId, teamB.seasonId],
						}),
				getSeasonPreviewStats(scheduleA),
				getSeasonPreviewStats(scheduleB),
			])
		const response: MatchupResponse = {
			currentSeason,
			a: matchupA,
			b: matchupB,
			headToHead,
			previewStats: combinePreviewStats(previewA, previewB),
			upcoming: upcoming.filter(({game}) => {
				return (
					game.homeTeam.id === teamB.id ||
					game.awayTeam.id === teamB.id
				)
			}),
		}
		return response
	},
)

/** A game's preview stats; null if the KHL site fails, as they're extras. */
async function getPreviewStats(
	gameId: string,
): Promise<KHLGamePreviewStats | null> {
	try {
		return await cached(`game-preview:${gameId}`, 10 * MINUTE, () =>
			getKHLGamePreviewStats(gameId),
		)
	} catch (error) {
		logger.warn("getPreviewStats", "KHL preview stats unavailable", {
			gameId,
			error,
		})
		return null
	}
}

/** One team's side of a game's preview stats */
type TeamPreviewStats = Record<keyof KHLGamePreviewStats, number | null>

/**
 * A team's PP%, PK%, shots and PIM for its season. The league only shows these
 * on game previews, but every preview in a season shows the season to date,
 * so any of the team's games will do: its latest.
 */
async function getSeasonPreviewStats(
	schedule: KHLGame[],
): Promise<TeamPreviewStats | null> {
	const game = schedule
		.filter((g) => g.id)
		.reduce<KHLGame | null>(
			(latest, g) =>
				!latest || g.startsAt > latest.startsAt ? g : latest,
			null,
		)
	if (!game?.id) {
		return null
	}
	const stats = await getPreviewStats(game.id)
	if (!stats) {
		return null
	}
	const side = game.homeAway
	return {
		powerPlayPct: stats.powerPlayPct?.[side] ?? null,
		penaltyKillPct: stats.penaltyKillPct?.[side] ?? null,
		shotsPerGame: stats.shotsPerGame?.[side] ?? null,
		shotsAgainstPerGame: stats.shotsAgainstPerGame?.[side] ?? null,
		penaltyMinutesPerGame: stats.penaltyMinutesPerGame?.[side] ?? null,
	}
}

/** Two teams' preview stats as a game's: a as "away", b as "home" */
function combinePreviewStats(
	a: TeamPreviewStats | null,
	b: TeamPreviewStats | null,
): KHLGamePreviewStats | null {
	if (!a && !b) {
		return null
	}
	const pair = (key: keyof KHLGamePreviewStats) => {
		const away = a?.[key] ?? null
		const home = b?.[key] ?? null
		return away === null && home === null ? null : {away, home}
	}
	return {
		powerPlayPct: pair("powerPlayPct"),
		penaltyKillPct: pair("penaltyKillPct"),
		shotsPerGame: pair("shotsPerGame"),
		shotsAgainstPerGame: pair("shotsAgainstPerGame"),
		penaltyMinutesPerGame: pair("penaltyMinutesPerGame"),
	}
}

registerEndpoint(app, LOG_ENDPOINT, async ({sessionId, userAgent, logs}) => {
	for (const log of logs) {
		// Keep the client's own context, prefixed so it's clear where it came from
		new Logger(`client.${log.context}`)[log.level](
			log.subcontext,
			log.message,
			{
				...log.aux,
				client: {
					sessionId,
					url: log.url,
					timestamp: log.timestamp,
					userAgent,
				},
			},
		)
	}
	return {ok: true}
})

registerEndpoint(app, LIST_RINKS_ENDPOINT, async () => {
	const teamsPage = await getTeamsPage()
	const rinks = await Promise.all(
		Object.keys(KHL_ARENA_LIVEBARN_SURFACES).map((arenaId) => {
			return getRink(arenaId, teamsPage)
		}),
	)
	return {season: teamsPage.season, rinks}
})

registerEndpoint(app, LIST_GAMES_ENDPOINT, async ({date}) => {
	const teamsPage = await getTeamsPage()
	const response: GamesResponse = {
		season: teamsPage.season,
		games: await getDayGames(date, teamsPage),
	}
	return response
})

/** A day's games from the scoreboard, with their rinks, soonest first. */
async function getDayGames(
	date: string,
	teamsPage: KHLTeamsPage,
): Promise<UpcomingGame[]> {
	const scoreboard = await getScoreboard(date)
	const games = await Promise.all(
		scoreboard.map(async (game): Promise<UpcomingGame | null> => {
			// Final games' cards drop their start time and rink; the box
			// score has both
			let {startsAt, arena} = game
			if (!startsAt || !arena) {
				const boxScore = await getBoxScore(game.gameId).catch(
					(error: unknown) => {
						logger.warn("listGames", "box score unavailable", {
							gameId: game.gameId,
							error,
						})
						return null
					},
				)
				startsAt ??= boxScore?.startsAt ?? null
				arena ??= boxScore?.arena ?? null
			}
			if (!startsAt) {
				return null
			}
			const toRinkTeam = (team: KHLScoreboardTeam): RinkTeam => ({
				id: team.id,
				// The scoreboard doubles apostrophes ("Carl''s"); prefer the teams page
				name:
					findListedTeam(teamsPage, team.id)?.name ??
					team.name.replaceAll("''", "'"),
				logoUrl: team.logoUrl,
				divisionName:
					getListedDivisionName(teamsPage, team.id) ??
					team.divisionName,
			})
			const {away, home} = game
			return {
				rink: await getRinkInfoOrFallback(arena),
				game: {
					gameId: game.gameId,
					startsAt,
					awayTeam: toRinkTeam(away),
					homeTeam: toRinkTeam(home),
					score:
						game.isFinal &&
						away.goals !== null &&
						home.goals !== null
							? {away: away.goals, home: home.goals}
							: null,
				},
			}
		}),
	)
	return games
		.filter((g) => g !== null)
		.sort((a, b) => a.game.startsAt.localeCompare(b.game.startsAt))
}

/** How many finished games a rink page lists, and how far back it looks */
const RECENT_RINK_GAMES = 5
const RECENT_RINK_DAYS = 14

/**
 * A rink's latest finished games, newest first. Walks the scoreboard back a
 * day at a time, stopping once it has enough: finished games' cards lack the
 * rink, so each day costs a box score per game, and asking for weeks at once
 * gets the KHL site to block us. Quiet rinks may have fewer than five.
 */
async function getRecentRinkGames(
	arenaId: string,
	teamsPage: KHLTeamsPage,
): Promise<RecentRinkGame[]> {
	const surfaces = await getVerifiedSurfaces(arenaId)
	const now = new Date()
	const found: UpcomingGame[] = []
	for (
		let i = 0;
		i < RECENT_RINK_DAYS && found.length < RECENT_RINK_GAMES;
		i++
	) {
		const date = getLeagueDayKey(new Date(now.getTime() - i * DAY))
		const games = await getDayGames(date, teamsPage).catch(
			(error: unknown) => {
				logger.warn("getRink", "scoreboard unavailable", {date, error})
				return []
			},
		)
		found.push(
			...games.filter((g) => g.rink.arenaId === arenaId && g.game.score),
		)
	}
	return found
		.sort((a, b) => b.game.startsAt.localeCompare(a.game.startsAt))
		.slice(0, RECENT_RINK_GAMES)
		.map(({game}) => ({
			game,
			livebarn: toLiveBarnLinks(
				surfaces,
				getLeagueLocalTime(game.startsAt),
			),
		}))
}

registerEndpoint(app, GET_RINK_ENDPOINT, async ({arenaId}) => {
	if (!KHL_ARENA_LIVEBARN_SURFACES[arenaId]) {
		throw new ApiError(404, `rink ${arenaId} not found`)
	}
	const teamsPage = await getTeamsPage()
	const [rink, arena, recent] = await Promise.all([
		getRink(arenaId, teamsPage),
		cached(`arena-page:${arenaId}`, 24 * HOUR, () => getKHLArena(arenaId)),
		getRecentRinkGames(arenaId, teamsPage),
	])
	const response: RinkResponse = {
		season: teamsPage.season,
		rink,
		address: arena.address,
		recent,
	}
	return response
})

app.use("/api", (_req, res) => {
	res.status(404).json({error: "not found"})
})

// Serve the built app when it exists (`build`); in dev, Vite serves it.
if (fs.existsSync(DIST_DIR)) {
	// Pages that moved; the client redirects these too (App.tsx)
	app.get("/matchup", (req, res) => {
		res.redirect(301, req.originalUrl.replace(/^\/matchup/, "/compare"))
	})
	app.use(express.static(DIST_DIR))
	app.get("/{*path}", (_req, res) => {
		res.sendFile(path.join(DIST_DIR, "index.html"))
	})
}

app.use(
	(
		error: unknown,
		_req: express.Request,
		res: express.Response,
		_next: express.NextFunction,
	) => {
		logger.error("request", "request failed", {error})
		// 502 when the KHL (or LiveBarn) site failed us; else it's our bug
		res.status(error instanceof FetchError ? 502 : 500).json({
			error: error instanceof Error ? error.message : String(error),
		})
	},
)

app.listen(PORT, () => {
	logger.info("listen", `server listening on http://localhost:${PORT}`, {
		commit: DEPLOY_INFO.commit,
	})
	startStatusChecks(db)
})

function getTeamsPage(seasonId?: string): Promise<KHLTeamsPage> {
	return cached(`teams:${seasonId ?? "current"}`, HOUR, () => {
		return getKHLTeamsPage(seasonId)
	})
}

async function getCurrentSeason(): Promise<KHLSeason> {
	return (await getTeamsPage()).season
}

/** Past seasons' pages don't change, so they're kept much longer */
function getSeasonTtl(isCurrentSeason: boolean): number {
	return isCurrentSeason ? 10 * MINUTE : 24 * HOUR
}

function getPlayer(playerId: string, teamId: string, seasonId: string) {
	return cached(
		`player:${playerId}:${teamId}:${seasonId}`,
		10 * MINUTE,
		() => {
			return getKHLPlayer(playerId, teamId, seasonId)
		},
	)
}

function getSchedule(
	teamId: string,
	seasonId: string,
	isCurrentSeason: boolean,
): Promise<KHLGame[]> {
	return cached(
		`schedule:${teamId}:${seasonId}`,
		getSeasonTtl(isCurrentSeason),
		() => {
			return getKHLTeamSchedule(teamId, seasonId)
		},
	)
}

function getTeamStats(
	teamId: string,
	seasonId: string,
	isCurrentSeason: boolean,
): Promise<KHLTeamStats> {
	return cached(
		`team-stats:${teamId}:${seasonId}`,
		getSeasonTtl(isCurrentSeason),
		() => getKHLTeamStats(teamId, seasonId),
	)
}

/** Finished games between two teams, newest first. */
async function getHeadToHead(
	awayStats: KHLTeamStats,
	homeStats: KHLTeamStats,
	currentSeasonId: string,
	options: {
		/** The game being previewed, which isn't its own head-to-head */
		excludeGameId?: string
		/** Searched even if they're older than the most recent shared seasons */
		includeSeasonIds?: string[]
	} = {},
): Promise<HeadToHeadGame[]> {
	const {excludeGameId, includeSeasonIds = []} = options
	const awayId = awayStats.teamId
	const homeId = homeStats.teamId
	const homeSeasonIds = new Set(homeStats.seasons.map((s) => s.id))
	// Both lists are newest first
	const sharedSeasons = awayStats.seasons
		.filter((s) => homeSeasonIds.has(s.id))
		.filter((s, i) => {
			return (
				i < LIMITS.HEAD_TO_HEAD_SEASONS ||
				includeSeasonIds.includes(s.id)
			)
		})
	const schedules = await Promise.all(
		sharedSeasons.map(async (season) => {
			try {
				return await getSchedule(
					awayId,
					season.id,
					season.id === currentSeasonId,
				)
			} catch (error) {
				logger.warn("getHeadToHead", "KHL schedule unavailable", {
					teamId: awayId,
					seasonId: season.id,
					error,
				})
				return []
			}
		}),
	)
	const games = schedules
		.flat()
		.filter((game) => {
			return (
				game.opponent.id === homeId &&
				game.isFinal &&
				game.id !== excludeGameId
			)
		})
		.sort((a, b) => b.startsAt.localeCompare(a.startsAt))
	const surfacesByArena = await getSurfacesByArena(games)
	return games.map((game) => {
		const surfaces = game.arena
			? (surfacesByArena.get(game.arena.id) ?? [])
			: []
		return toHeadToHeadGame(game, toLiveBarnLinks(surfaces, game))
	})
}

function toHeadToHeadGame(
	game: KHLGame,
	livebarn: LiveBarnLink[],
): HeadToHeadGame {
	return {
		gameId: game.id,
		seasonId: game.seasonId,
		startsAt: game.startsAt,
		arena: toDisplayArena(game.arena),
		homeTeamId: game.homeAway === "home" ? game.team.id : game.opponent.id,
		goals: getGoalsByTeam(game),
		livebarn,
	}
}

/**
 * A team's season going into a game, from its schedule. Null if the KHL site
 * fails: the game page shows without it.
 */
async function getGameSeasonSummary(
	team: KHLBoxScoreTeam,
	startsAt: string,
	currentSeasonId: string,
): Promise<SeasonSummary | null> {
	try {
		const [teamsPage, schedule] = await Promise.all([
			getTeamsPage(team.seasonId),
			getSchedule(
				team.id,
				team.seasonId,
				team.seasonId === currentSeasonId,
			),
		])
		const listed = findListedTeam(teamsPage, team.id)
		return {
			team: listed ?? {
				id: team.id,
				name: team.name,
				seasonId: team.seasonId,
				divisionId: "",
				logoUrl: team.logoUrl,
			},
			season: teamsPage.season,
			divisionName: getListedDivisionName(teamsPage, team.id) ?? "",
			// For a past game, its season going in rather than what came after
			...getSeasonRecord(
				schedule.filter((game) => game.startsAt < startsAt),
			),
		}
	} catch (error) {
		logger.warn("getGameSeasonSummary", "KHL schedule unavailable", {
			teamId: team.id,
			seasonId: team.seasonId,
			error,
		})
		return null
	}
}

type SeasonRecord = Pick<
	MatchupTeam,
	| "gamesPlayed"
	| "wins"
	| "losses"
	| "ties"
	| "goalsFor"
	| "goalsAgainst"
	| "recent"
	| "streak"
>

/** Record, goals, and form from a team's schedule (oldest first). */
function getSeasonRecord(schedule: KHLGame[]): SeasonRecord {
	const record: SeasonRecord = {
		gamesPlayed: 0,
		wins: 0,
		losses: 0,
		ties: 0,
		goalsFor: 0,
		goalsAgainst: 0,
		recent: [],
		streak: null,
	}
	const results: RecentGame[] = []
	for (const game of schedule) {
		const recent = toRecentGame({
			...game,
			arena: toDisplayArena(game.arena),
		})
		if (!recent) {
			continue
		}
		record.gamesPlayed += 1
		record.goalsFor += recent.goalsFor
		record.goalsAgainst += recent.goalsAgainst
		if (recent.result === "W") {
			record.wins += 1
		} else if (recent.result === "L") {
			record.losses += 1
		} else {
			record.ties += 1
		}
		results.push(recent)
	}
	record.recent = results.slice(-LIMITS.MATCHUP_RECENT_GAMES)
	const last = results.at(-1)?.result
	if (last) {
		let count = 0
		while (results[results.length - 1 - count]?.result === last) {
			count += 1
		}
		record.streak = {result: last, count}
	}
	return record
}

function getGameStats(gameId: string): Promise<KHLGameStats> {
	// Like box scores: check again soon until the lineups are posted
	return cached(
		`game-stats:${gameId}`,
		10 * MINUTE,
		() => {
			return getKHLGameStats(gameId)
		},
		(stats) => {
			const isPosted =
				stats.away.skaters.length + stats.home.skaters.length > 0
			return isPosted ? 6 * HOUR : 10 * MINUTE
		},
	)
}

function getBoxScore(gameId: string): Promise<KHLBoxScore> {
	// Summaries are posted (and sometimes corrected) after the game, so check
	// again soon until there's one; after that, corrections are rare
	return cached(
		`box-score:${gameId}`,
		10 * MINUTE,
		() => {
			return getKHLBoxScore(gameId)
		},
		(boxScore) => (boxScore.hasSummary ? 6 * HOUR : 10 * MINUTE),
	)
}

/**
 * Records everyone named in the box score so they link to player pages.
 * Returns our player UUID for each KHL player id.
 */
function recordBoxScorePlayers(boxScore: KHLBoxScore): Map<string, string> {
	const teams = new Map<string, KHLBoxScoreTeam>(
		[boxScore.away, boxScore.home].map((t) => [t.id, t]),
	)
	const entries = [
		...boxScore.goals.flatMap((g) => {
			return [g.scorer, ...g.assists].map((player) => ({
				player,
				teamId: g.teamId,
			}))
		}),
		...boxScore.penalties.flatMap((p) => {
			return p.player ? [{player: p.player, teamId: p.teamId}] : []
		}),
	]
	return db.recordRegistrations(
		entries.flatMap(({player, teamId}) => {
			const team = teams.get(teamId)
			if (!team) {
				return []
			}
			return [
				{
					playerId: player.id,
					name: player.name,
					position: null,
					teamId: team.id,
					teamName: team.name,
					teamLogoUrl: team.logoUrl,
					seasonId: team.seasonId,
				},
			]
		}),
	)
}

function getMappedArenaName(arena: ArenaMapping): string {
	return arena.displayName ?? arena.khlArenaName
}

/** A KHL arena with its LiveBarn surfaces and upcoming league games. */
async function getRink(
	arenaId: string,
	teamsPage: KHLTeamsPage,
): Promise<Rink> {
	const [info, leagueGames] = await Promise.all([
		getRinkInfo(arenaId),
		getLeagueSchedule(),
	])
	return {
		...info,
		games: leagueGames
			.filter((g) => g.arena?.id === arenaId)
			.map((g) => toRinkGame(g, teamsPage)),
	}
}

/** A day's games from the league's scoreboard, "yyyy-MM-dd" */
function getScoreboard(date: string): Promise<KHLScoreboardGame[]> {
	// A finished day's scores only change when the league corrects one
	const isPast = date < getLeagueDayKey(new Date())
	return cached(`scoreboard:${date}`, isPast ? HOUR : 5 * MINUTE, () => {
		return getKHLScoreboard(date)
	})
}

/**
 * The game's final score. The scoreboard often has it before the league
 * posts the box score's summary.
 */
async function getFinalScore(
	boxScore: KHLBoxScore,
): Promise<{away: number; home: number} | null> {
	const {away, home} = boxScore
	if (boxScore.hasSummary && away.goals !== null && home.goals !== null) {
		return {away: away.goals, home: home.goals}
	}
	if (Date.parse(boxScore.startsAt) > Date.now()) {
		return null
	}
	const scoreboard = await getScoreboard(boxScore.localDate).catch(
		(error: unknown) => {
			logger.warn("getGame", "KHL scoreboard unavailable", {
				date: boxScore.localDate,
				error,
			})
			return []
		},
	)
	const game = scoreboard.find((g) => g.gameId === boxScore.gameId)
	if (
		!game?.isFinal ||
		game.away.goals === null ||
		game.home.goals === null
	) {
		return null
	}
	return {away: game.away.goals, home: game.home.goals}
}

/** A rink we track, or a bare one for rinks off our list (or not set) */
async function getRinkInfoOrFallback(
	arena: {id: string; name: string} | null,
	/** The name when there's no arena at all */
	missingName = "Unknown rink",
): Promise<RinkInfo> {
	if (arena && KHL_ARENA_LIVEBARN_SURFACES[arena.id]) {
		return getRinkInfo(arena.id)
	}
	return {
		arenaId: arena?.id ?? "",
		name: arena ? getArenaName(arena) : missingName,
		city: "",
		livebarn: [],
	}
}

function findListedTeam(
	teamsPage: KHLTeamsPage,
	teamId: string,
): KHLTeam | undefined {
	return teamsPage.teams.find((t) => t.id === teamId)
}

/** The team's division in the page's season, if the teams page lists it */
function getListedDivisionName(
	teamsPage: KHLTeamsPage,
	teamId: string,
): string | null {
	const listed = findListedTeam(teamsPage, teamId)
	return listed ? getDivisionName(teamsPage, listed.divisionId) : null
}

async function getRinkInfo(arenaId: string): Promise<RinkInfo> {
	const surfaces = await getVerifiedSurfaces(arenaId)
	return {
		arenaId,
		name: getMappedArenaName(KHL_ARENA_LIVEBARN_SURFACES[arenaId]!),
		city: KHL_ARENA_LIVEBARN_SURFACES[arenaId]!.city,
		livebarn: surfaces.map((s) => ({
			surfaceId: s.surfaceId,
			surfaceName: s.surfaceName,
			liveUrl: getLiveBarnLiveUrl(s.surfaceId),
		})),
	}
}

/** League-wide upcoming games, soonest first. */
async function getLeagueSchedule(): Promise<KHLLeagueGame[]> {
	const games = await cached(
		"league-schedule",
		5 * MINUTE,
		getKHLLeagueSchedule,
	)
	return [...games].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

function toRinkGame(game: KHLLeagueGame, teamsPage: KHLTeamsPage): RinkGame {
	const toRinkTeam = (team: KHLLeagueTeam): RinkTeam => ({
		...team,
		divisionName: getListedDivisionName(teamsPage, team.id),
	})
	return {
		gameId: game.id,
		startsAt: game.startsAt,
		homeTeam: toRinkTeam(game.homeTeam),
		awayTeam: toRinkTeam(game.awayTeam),
	}
}

/** League-schedule games involving any of `teamIds`, as game cards. */
async function getUpcomingGames(teamIds: Set<string>): Promise<UpcomingGame[]> {
	if (teamIds.size === 0) {
		return []
	}
	const [teamsPage, leagueGames] = await Promise.all([
		getTeamsPage(),
		getLeagueSchedule(),
	])
	const games = leagueGames.filter((g) => {
		return teamIds.has(g.homeTeam.id) || teamIds.has(g.awayTeam.id)
	})
	return Promise.all(
		games.map(async (g): Promise<UpcomingGame> => {
			return {
				// Not yet assigned a rink
				rink: await getRinkInfoOrFallback(g.arena, "TBD"),
				game: toRinkGame(g, teamsPage),
			}
		}),
	)
}

/**
 * Who played for each team in a game, with their stats in it. Null if the
 * KHL site fails: the box score shows without it.
 */
async function getGameLineups(
	boxScore: KHLBoxScore,
): Promise<{away: TeamRoster; home: TeamRoster} | null> {
	try {
		const stats = await getGameStats(boxScore.gameId)
		const lineup = (team: KHLBoxScoreTeam, teamStats: KHLGameTeamStats) => {
			return getRoster(team.id, team.name, team.logoUrl, {
				...teamStats,
				seasonId: team.seasonId,
			})
		}
		const [away, home] = await Promise.all([
			lineup(boxScore.away, stats.away),
			lineup(boxScore.home, stats.home),
		])
		return {away, home}
	} catch (error) {
		logger.warn("getGameLineups", "KHL game stats unavailable", {
			gameId: boxScore.gameId,
			error,
		})
		return null
	}
}

/**
 * The team's roster for a season, with each player recorded in the database
 * so they link to a player page.
 */
async function getRoster(
	teamId: string,
	teamName: string,
	teamLogoUrl: string | null,
	stats: Pick<
		KHLTeamStats,
		"seasonId" | "skaterColumns" | "skaters" | "goalieColumns" | "goalies"
	>,
): Promise<TeamRoster> {
	const goalieIds = new Set(stats.goalies.map((g) => g.playerId))
	const playerIds = db.recordRegistrations(
		[...stats.skaters, ...stats.goalies].map((row) => ({
			playerId: row.playerId,
			name: row.name,
			position: goalieIds.has(row.playerId) ? "Goalie" : "Skater",
			teamId,
			teamName,
			teamLogoUrl,
			seasonId: stats.seasonId,
		})),
	)
	const toRosterPlayer = (row: KHLRosterRow): RosterPlayer => ({
		playerId: playerIds.get(row.playerId)!,
		khlPlayerId: row.playerId,
		number: row.number,
		name: row.name,
		stats: row.stats,
	})
	return {
		skaterColumns: stats.skaterColumns,
		// Goalies appear in the skater table too, with empty skater stats
		skaters: stats.skaters
			.filter((row) => !goalieIds.has(row.playerId))
			.map(toRosterPlayer),
		goalieColumns: stats.goalieColumns,
		goalies: stats.goalies.map(toRosterPlayer),
	}
}

function getDivisionName(teamsPage: KHLTeamsPage, divisionId: string): string {
	return teamsPage.divisions.find((d) => d.id === divisionId)?.name ?? ""
}

interface LiveBarnSurfaceEntry {
	venue: LiveBarnVenue
	surface: LiveBarnSurface
}

async function getLiveBarnSurfaces(): Promise<
	Map<number, LiveBarnSurfaceEntry>
> {
	return cached("livebarn:surfaces", 24 * HOUR, async () => {
		const venues = await getLivebarnVenues()
		const surfaces = new Map<number, LiveBarnSurfaceEntry>()
		for (const venue of venues) {
			for (const surface of venue.surfaces) {
				surfaces.set(surface.id, {venue, surface})
			}
		}
		return surfaces
	})
}

async function toFeedGames(
	games: KHLGame[],
	/** For opponent logos */
	teamsPages: KHLTeamsPage[],
): Promise<FeedGame[]> {
	const surfacesByArena = await getSurfacesByArena(games)
	const logos = getTeamLogos(teamsPages)
	return [...games]
		.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
		.map((game) => {
			const surfaces = game.arena
				? (surfacesByArena.get(game.arena.id) ?? [])
				: []
			return {
				game: {...game, arena: toDisplayArena(game.arena)},
				opponentLogoUrl: logos.get(game.opponent.id) ?? null,
				livebarn: toLiveBarnLinks(surfaces, game),
			}
		})
}

/** Verified LiveBarn surfaces for each arena the games were played at. */
async function getSurfacesByArena(
	games: KHLGame[],
): Promise<Map<string, LiveBarnSurfaceMapping[]>> {
	const arenaIds = [...new Set(games.flatMap((g) => g.arena?.id ?? []))]
	return new Map(
		await Promise.all(
			arenaIds.map(async (arenaId) => {
				return [arenaId, await getVerifiedSurfaces(arenaId)] as const
			}),
		),
	)
}

/** Live and replay links for a game on each of its arena's surfaces. */
function toLiveBarnLinks(
	surfaces: LiveBarnSurfaceMapping[],
	game: {localDate: string; localTime: string},
): LiveBarnLink[] {
	return surfaces.map((surface): LiveBarnLink => {
		return {
			...surface,
			liveUrl: getLiveBarnLiveUrl(surface.surfaceId),
			// KHL and every mapped venue are on Pacific time, so the
			// league-local start time is also venue-local.
			vodUrl: getLiveBarnVodUrl(
				surface.surfaceId,
				game.localDate,
				game.localTime,
			),
		}
	})
}

/**
 * Team logos by id, from teams pages the caller already has (schedule rows
 * don't carry logos). Fetching a page per season of a long player history
 * would trip the KHL site's 403s, so teams missing from these pages (e.g.
 * folded ones) just show initials. Earlier pages win.
 */
function getTeamLogos(teamsPages: KHLTeamsPage[]): Map<string, string> {
	const logos = new Map<string, string>()
	for (const page of teamsPages) {
		for (const team of page.teams) {
			if (team.logoUrl && !logos.has(team.id)) {
				logos.set(team.id, team.logoUrl)
			}
		}
	}
	return logos
}

/**
 * The arena's mapped LiveBarn surfaces, keeping only those whose names still
 * match on both sites. Never throws: a failed check just means no links.
 */
async function getVerifiedSurfaces(
	arenaId: string,
): Promise<LiveBarnSurfaceMapping[]> {
	try {
		return await cached(`arena:${arenaId}`, 24 * HOUR, () => {
			return verifyArenaMapping(arenaId)
		})
	} catch (error) {
		logger.error("getVerifiedSurfaces", "could not verify arena", {
			arenaId,
			error,
		})
		return []
	}
}

async function verifyArenaMapping(
	arenaId: string,
): Promise<LiveBarnSurfaceMapping[]> {
	const mapping = KHL_ARENA_LIVEBARN_SURFACES[arenaId]
	if (!mapping) {
		const arena = await getKHLArena(arenaId)
		logger.warn("verifyArenaMapping", "arena has no LiveBarn mapping", {
			arena,
		})
		return []
	}

	const arena = await getKHLArena(arenaId)
	if (arena.name !== mapping.khlArenaName) {
		logger.error("verifyArenaMapping", "KHL arena name changed", {
			arenaId,
			expected: mapping.khlArenaName,
			actual: arena.name,
		})
		return []
	}

	const surfaces = await getLiveBarnSurfaces()
	return mapping.livebarnSurfaces.filter((expected) => {
		const actual = surfaces.get(expected.surfaceId)
		const matches =
			actual?.venue.name === expected.venueName &&
			actual.surface.name === expected.surfaceName
		if (!matches) {
			logger.error("verifyArenaMapping", "LiveBarn surface changed", {
				arenaId,
				expected,
				actual: actual
					? {
							venueName: actual.venue.name,
							surfaceName: actual.surface.name,
						}
					: null,
			})
		}
		return matches
	})
}

const cache = new Map<string, {expiresAt: number; value: Promise<unknown>}>()

/**
 * Memoizes `load` for `ttlMs`. Concurrent callers share one in-flight request,
 * and failures aren't cached.
 */
function cached<T>(
	key: string,
	ttlMs: number,
	load: () => Promise<T>,
	/** Once loaded, how long to keep this value instead of `ttlMs` */
	getTtlMs?: (value: T) => number,
): Promise<T> {
	const hit = cache.get(key)
	if (hit && hit.expiresAt > Date.now()) {
		return hit.value as Promise<T>
	}
	const value = load()
	const entry = {expiresAt: Date.now() + ttlMs, value}
	cache.set(key, entry)
	if (getTtlMs) {
		void value.then(
			(loaded) => {
				entry.expiresAt = Date.now() + getTtlMs(loaded)
			},
			() => {},
		)
	}
	value.catch(() => {
		if (cache.get(key)?.value === value) {
			cache.delete(key)
		}
	})
	return value
}
