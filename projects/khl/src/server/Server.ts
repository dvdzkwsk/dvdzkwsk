import * as fs from "fs"
import * as path from "path"
import {ConsoleTransport, Logger, setLoggerTransports} from "@dvdzkwsk/logger"
import {ApiError, registerEndpoint} from "@dvdzkwsk/util/ApiServerUtil"
import express from "express"
import {
	FeedGame,
	GameResponse,
	GET_GAME_ENDPOINT,
	GET_MATCHUP_ENDPOINT,
	LIST_TEAMS_ENDPOINT,
	LIST_TEAM_SEASONS_ENDPOINT,
	MatchupResponse,
	MatchupTeam,
	TeamSeasonsResponse,
	TeamsResponse,
	HeadToHeadGame,
	GET_PLAYER_ENDPOINT,
	GET_TEAM_ENDPOINT,
	GET_RINK_ENDPOINT,
	GET_STANDINGS_ENDPOINT,
	LIST_RINKS_ENDPOINT,
	LOG_ENDPOINT,
	Rink,
	RinkGame,
	RinkInfo,
	RinkTeam,
	RosterPlayer,
	TeamRoster,
	UpcomingGame,
	LiveBarnLink,
	PlayerResponse,
	PlayerSearchGroup,
	SEARCH_ENDPOINT,
	UnavailableSchedule,
	SearchResponse,
	StandingsResponse,
	TeamResponse,
} from "../shared/ApiJson.js"
import {
	ArenaMapping,
	getArenaName,
	KHL_ARENA_LIVEBARN_SURFACES,
	LiveBarnSurfaceMapping,
	toDisplayArena,
} from "./Arenas.js"
import {getCity} from "../shared/Cities.js"
import {LIMITS} from "../shared/KHLConfig.js"
import {normalizePlayerName, openDatabase} from "./Database.js"
import {
	KHL_ALL_SEASONS,
	getKHLArena,
	getKHLBoxScore,
	getKHLLeagueSchedule,
	getKHLTeamStats,
	getKHLPlayer,
	getKHLStandings,
	getKHLTeamSchedule,
	getKHLTeamsPage,
	searchKHLPlayers,
} from "./KHL.js"
import {
	KHLBoxScore,
	KHLBoxScoreTeam,
	KHLGame,
	KHLLeagueGame,
	KHLLeagueTeam,
	KHLRosterRow,
	KHLTeam,
	KHLTeamStats,
	KHLTeamsPage,
} from "../shared/KHLJson.js"
import {
	getLiveBarnLiveUrl,
	getLiveBarnVodUrl,
	getLivebarnVenues,
} from "./LiveBarn.js"
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

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const app = express()

// Client log batches with stack traces can outgrow the 100kb default
app.use(express.json({limit: "512kb"}))

app.get("/api/health", (_req, res) => {
	res.json({ok: true})
})

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

	const teamsPage = await getTeamsPage()
	const currentSeason = teamsPage.season

	// The KHL site 500s on some old pages, so one bad page shouldn't fail the
	// whole player: missing profiles and schedules are skipped and reported.
	const profiles = await Promise.all(
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
	)

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
	const unavailableSchedules: UnavailableSchedule[] = []
	const schedules = await Promise.all(
		[...teamSeasons.values()].map(async ({teamId, teamName, seasonId}) => {
			try {
				return await getSchedule(
					teamId,
					seasonId,
					seasonId === currentSeason.id,
				)
			} catch (error) {
				logger.warn("getSchedule", "KHL schedule unavailable", {
					teamId,
					seasonId,
					error,
				})
				unavailableSchedules.push({
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
		games: await toFeedGames(schedules.flat(), [teamsPage]),
		unavailableSchedules,
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

registerEndpoint(app, GET_TEAM_ENDPOINT, async ({teamId, season}) => {
	const [teamsPage, currentSeason] = await Promise.all([
		getTeamsPage(season),
		getTeamsPage().then((page) => page.season),
	])
	const team = teamsPage.teams.find((t) => t.id === teamId)
	if (!team) {
		throw new ApiError(404, `team ${teamId} not found`)
	}
	const isCurrentSeason = team.seasonId === currentSeason.id
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

registerEndpoint(app, GET_GAME_ENDPOINT, async ({gameId}) => {
	const [boxScore, currentSeason] = await Promise.all([
		getBoxScore(gameId),
		getTeamsPage().then((page) => page.season),
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
	const [headToHead, rosters] = await Promise.all([
		awayStats && homeStats
			? getHeadToHead(awayStats, homeStats, currentSeason.id, {
					excludeGameId: boxScore.gameId,
				})
			: [],
		// Once there's a box score it lists who actually played
		!boxScore.hasSummary && awayStats && homeStats
			? Promise.all([
					getRoster(away.id, away.name, away.logoUrl, awayStats),
					getRoster(home.id, home.name, home.logoUrl, homeStats),
				]).then(([away, home]) => ({away, home}))
			: null,
	])
	const response: GameResponse = {
		boxScore: {...boxScore, arena: toDisplayArena(boxScore.arena)},
		playerIds: Object.fromEntries(recordBoxScorePlayers(boxScore)),
		livebarn: toLiveBarnLinks(surfaces, boxScore),
		headToHead,
		rosters,
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

registerEndpoint(app, LIST_TEAM_SEASONS_ENDPOINT, async ({teamId, season}) => {
	const currentSeason = (await getTeamsPage()).season
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
			getTeamsPage().then((page) => page.season),
		])
		if (a === b && pageA.season.id === pageB.season.id) {
			throw new ApiError(400, "pick two different teams or seasons")
		}
		const getTeam = (teamsPage: KHLTeamsPage, teamId: string) => {
			const team = teamsPage.teams.find((t) => t.id === teamId)
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
		const [matchupA, matchupB, headToHead] = await Promise.all([
			toMatchupTeam(pageA, teamA, statsA, scheduleA),
			toMatchupTeam(pageB, teamB, statsB, scheduleB),
			// A team against its own past season has no head-to-head
			teamA.id === teamB.id
				? []
				: getHeadToHead(statsA, statsB, currentSeason.id, {
						// The matchup shows each picked season's meetings
						includeSeasonIds: [teamA.seasonId, teamB.seasonId],
					}),
		])
		const response: MatchupResponse = {
			currentSeason,
			a: matchupA,
			b: matchupB,
			headToHead,
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

registerEndpoint(app, GET_RINK_ENDPOINT, async ({arenaId}) => {
	if (!KHL_ARENA_LIVEBARN_SURFACES[arenaId]) {
		throw new ApiError(404, `rink ${arenaId} not found`)
	}
	const teamsPage = await getTeamsPage()
	const [rink, arena] = await Promise.all([
		getRink(arenaId, teamsPage),
		cached(`arena-page:${arenaId}`, 24 * HOUR, () => getKHLArena(arenaId)),
	])
	return {
		season: teamsPage.season,
		rink,
		address: arena.address,
	}
})

app.use("/api", (_req, res) => {
	res.status(404).json({error: "not found"})
})

// Serve the built app when it exists (`build`); in dev, Vite serves it.
if (fs.existsSync(DIST_DIR)) {
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
		res.status(502).json({
			error: error instanceof Error ? error.message : String(error),
		})
	},
)

app.listen(PORT, () => {
	console.log(`server listening on http://localhost:${PORT}`)
})

function getTeamsPage(seasonId?: string): Promise<KHLTeamsPage> {
	return cached(`teams:${seasonId ?? "current"}`, HOUR, () => {
		return getKHLTeamsPage(seasonId)
	})
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
	// Past seasons' schedules don't change
	const ttl = isCurrentSeason ? 10 * MINUTE : 24 * HOUR
	return cached(`schedule:${teamId}:${seasonId}`, ttl, () => {
		return getKHLTeamSchedule(teamId, seasonId)
	})
}

function getTeamStats(
	teamId: string,
	seasonId: string,
	isCurrentSeason: boolean,
): Promise<KHLTeamStats> {
	return cached(
		`team-stats:${teamId}:${seasonId}`,
		isCurrentSeason ? 10 * MINUTE : 24 * HOUR,
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
 * Schedules list the winner's score first ("4 - 2" for a 2-4 loss), so the
 * result says which number is the team's own.
 */
function getGoalsByTeam(game: KHLGame): Record<string, number> | null {
	const match = game.score?.match(/^(\d+)\s*-\s*(\d+)$/)
	const result = game.result?.toUpperCase() ?? ""
	if (!match || !/^[WLT]/.test(result)) {
		return null
	}
	const high = Math.max(Number(match[1]), Number(match[2]))
	const low = Math.min(Number(match[1]), Number(match[2]))
	const own = result.startsWith("L") ? low : high
	const other = result.startsWith("W") ? low : high
	return {[game.team.id]: own, [game.opponent.id]: other}
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

/** Record, goals and form from a team's schedule (oldest first). */
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
	const results: string[] = []
	for (const game of schedule) {
		const goals = game.isFinal ? getGoalsByTeam(game) : null
		if (!goals) {
			continue
		}
		const goalsFor = goals[game.team.id]!
		const goalsAgainst = goals[game.opponent.id]!
		const result =
			goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "T"
		record.gamesPlayed += 1
		record.goalsFor += goalsFor
		record.goalsAgainst += goalsAgainst
		if (result === "W") {
			record.wins += 1
		} else if (result === "L") {
			record.losses += 1
		} else {
			record.ties += 1
		}
		results.push(result)
	}
	record.recent = results.slice(-LIMITS.MATCHUP_RECENT_GAMES)
	const last = results.at(-1)
	if (last) {
		let count = 0
		while (results[results.length - 1 - count] === last) {
			count += 1
		}
		record.streak = {result: last, count}
	}
	return record
}

function getBoxScore(gameId: string): Promise<KHLBoxScore> {
	// Summaries are posted (and sometimes corrected) after the game
	return cached(`box-score:${gameId}`, 10 * MINUTE, () => {
		return getKHLBoxScore(gameId)
	})
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
	const toRinkTeam = (team: KHLLeagueTeam): RinkTeam => {
		const listed = teamsPage.teams.find((t) => t.id === team.id)
		return {
			...team,
			divisionName: listed
				? getDivisionName(teamsPage, listed.divisionId)
				: null,
		}
	}
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
			const arenaId = g.arena?.id
			const rink: RinkInfo =
				arenaId && KHL_ARENA_LIVEBARN_SURFACES[arenaId]
					? await getRinkInfo(arenaId)
					: {
							arenaId: arenaId ?? "",
							name: g.arena ? getArenaName(g.arena) : "TBD",
							city: "",
							livebarn: [],
						}
			return {rink, game: toRinkGame(g, teamsPage)}
		}),
	)
}

/**
 * The team's roster for a season, with each player recorded in the database
 * so they link to a player page.
 */
async function getRoster(
	teamId: string,
	teamName: string,
	teamLogoUrl: string | null,
	stats: KHLTeamStats,
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
): Promise<T> {
	const hit = cache.get(key)
	if (hit && hit.expiresAt > Date.now()) {
		return hit.value as Promise<T>
	}
	const value = load()
	cache.set(key, {expiresAt: Date.now() + ttlMs, value})
	value.catch(() => {
		if (cache.get(key)?.value === value) {
			cache.delete(key)
		}
	})
	return value
}
