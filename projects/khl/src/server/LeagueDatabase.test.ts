import {describe, expect, test} from "bun:test"
import {KHLDatabase, openDatabase} from "./Database.js"
import {getSyncPageUrl, SyncPage} from "./SyncPages.js"
import {toRegistrationKey} from "../shared/ApiJson.js"
import {
	KHLBoxScore,
	KHLGame,
	KHLGameStats,
	KHLPlayer,
	KHLTeamsPage,
	KHLTeamStats,
} from "../shared/KHLJson.js"

const team = (id: string, name: string) => ({
	id,
	name,
	logoUrl: `https://example.com/${id}.png`,
	seasonId: "100",
	goalsByPeriod: [1, 0, 0],
	goals: 1,
	shotsByPeriod: [],
	shots: null,
})

const boxScore: KHLBoxScore = {
	gameId: "900",
	localDate: "2026-10-17",
	localTime: "21:00",
	startsAt: "2026-10-18T04:00:00.000Z",
	arena: {id: "14", name: "Lynnwood"},
	away: team("11", "Bullets"),
	home: team("22", "Flamingos"),
	hasSummary: true,
	periods: ["1", "2", "3"],
	goals: [
		{
			period: "1st",
			time: "16:16",
			teamId: "11",
			scorer: {id: "501", name: "Brandon Smith"},
			scorerSeasonGoals: 3,
			assists: [{id: "502", name: "Ana Diaz"}],
			type: null,
		},
		{
			period: "2nd",
			time: "04:00",
			teamId: "22",
			scorer: {id: "601", name: "Kim Lee"},
			scorerSeasonGoals: 1,
			assists: [],
			type: "PPG",
		},
	],
	penalties: [
		{
			period: "3rd",
			time: "10:00",
			teamId: "11",
			player: {id: "502", name: "Ana Diaz"},
			infraction: "Tripping",
			duration: "2:00",
		},
		{
			period: "3rd",
			time: "05:00",
			teamId: "22",
			player: null,
			infraction: "Too many men",
			duration: "2:00",
		},
	],
}

const NAMES: Record<string, string> = {
	"501": "Brandon Smith",
	"502": "Ana Diaz",
	"601": "Kim Lee",
}

const row = (playerId: string) => ({
	playerId,
	number: "9",
	name: NAMES[playerId]!,
	stats: {G: "1"},
})

const stats: KHLGameStats = {
	gameId: "900",
	away: {
		skaterColumns: ["G"],
		skaters: [row("501"), row("502")],
		goalieColumns: [],
		goalies: [],
	},
	home: {
		skaterColumns: ["G"],
		skaters: [row("601")],
		goalieColumns: ["SV"],
		goalies: [],
	},
}

/** A database with the game's players recorded, as processing does */
const createDb = () => {
	const db = openDatabase(":memory:")
	db.recordRegistrations(
		[
			{playerId: "501", teamId: "11"},
			{playerId: "502", teamId: "11"},
			{playerId: "601", teamId: "22"},
		].map((r) => ({
			...r,
			name: NAMES[r.playerId]!,
			position: null,
			teamName: r.teamId === "11" ? "Bullets" : "Flamingos",
			teamLogoUrl: null,
			seasonId: "100",
		})),
		"roster",
	)
	return db
}

const saveGame = (db: KHLDatabase, gameStats: KHLGameStats | null = stats) =>
	db.league.saveGame(boxScore, gameStats, 1_000)

describe("games", () => {
	test("a game reads back as its box score and stats page", () => {
		const db = createDb()
		saveGame(db)
		expect(db.league.getBoxScore("900")).toEqual(boxScore)
		expect(db.league.getGameStats("900")).toEqual(stats)
	})

	test("a player's goals, assists, and penalties, in scoresheet order", () => {
		const db = createDb()
		saveGame(db)
		const events = db.league.getGameEvents(["900"], {
			kind: "players",
			khlPlayerIds: ["502"],
		})
		expect(events.map((e) => e.event)).toEqual([
			{kind: "assist", goal: boxScore.goals[0]!},
			{kind: "penalty", penalty: boxScore.penalties[0]!},
		])
	})

	test("a team's events are its goals and penalties, bench ones included", () => {
		const db = createDb()
		saveGame(db)
		const events = db.league.getGameEvents(["900"], {
			kind: "team",
			teamId: "22",
		})
		expect(events.map((e) => e.event.kind)).toEqual(["goal", "penalty"])
	})

	test("goals and penalties interleave by period and clock", () => {
		const db = createDb()
		const early = {...boxScore.penalties[1]!, period: "1st", time: "18:00"}
		db.league.saveGame(
			{...boxScore, penalties: [early, boxScore.penalties[0]!]},
			stats,
			1_000,
		)
		const events = db.league.getGameEvents(["900"], {kind: "all"})
		expect(events.map((e) => e.event.kind)).toEqual([
			"penalty",
			"goal",
			"goal",
			"penalty",
		])
	})

	test("lineups say who dressed, for which team, and whether they're posted", () => {
		const db = createDb()
		saveGame(db)
		expect(db.league.getDressedGameIds(["900"], ["601"])).toEqual(
			new Set(["900"]),
		)
		expect(db.league.getLineupKeys("900")).toContainEqual({
			teamId: "22",
			khlPlayerId: "601",
		})
		expect(db.league.getGames(["900"]).get("900")!.away.lineupPosted).toBe(
			true,
		)

		const unposted = createDb()
		saveGame(unposted, null)
		expect(
			unposted.league.getGames(["900"]).get("900")!.away.lineupPosted,
		).toBe(false)
		expect(unposted.league.getGameStats("900")).toBeNull()
	})

	test("a game completes once, and is never replaced by an incomplete copy", () => {
		const db = createDb()
		expect(saveGame(db, null)).toEqual({
			saved: true,
			completedSinceLastSave: false,
		})
		expect(saveGame(db)).toEqual({
			saved: true,
			completedSinceLastSave: true,
		})
		const completedAt = db.league.getGames(["900"]).get("900")!.completedAt
		expect(completedAt).toBe(1_000)

		expect(saveGame(db, null)).toEqual({
			saved: false,
			completedSinceLastSave: false,
		})
		expect(db.league.getGames(["900"]).get("900")!.away.lineupPosted).toBe(
			true,
		)
		expect(
			db.league.saveGame(boxScore, stats, 2_000).completedSinceLastSave,
		).toBe(false)
		expect(db.league.getGames(["900"]).get("900")!.completedAt).toBe(1_000)
	})
})

describe("teams, schedules, rosters, and player pages", () => {
	const teamsPage: KHLTeamsPage = {
		season: {id: "100", name: "Fall 2026"},
		seasons: [
			{id: "100", name: "Fall 2026"},
			{id: "96", name: "Summer 2026"},
		],
		divisions: [{id: "5", name: "Division 5", seasonId: "100"}],
		teams: [
			{
				id: "11",
				name: "Bullets",
				seasonId: "100",
				divisionId: "5",
				logoUrl: "https://example.com/11.png",
			},
		],
	}

	test("a teams page reads back, and the default one marks the current season", () => {
		const db = openDatabase(":memory:")
		db.league.saveTeamsPage(teamsPage, true)
		expect(db.league.getCurrentSeasonId()).toBe("100")
		expect(db.league.getTeamsPage(null)).toEqual(teamsPage)
		expect(db.league.getTeamsPage("100")).toEqual(teamsPage)
		expect(db.league.getTeamsPage("1")).toBeNull()
	})

	test("a page that outranks another names the team", () => {
		const db = openDatabase(":memory:")
		const named = (
			name: string,
			source: "teams-page" | "box-score" | "search",
		) => ({
			teamId: "11",
			seasonId: "100",
			name,
			logoUrl: null,
			divisionId: null,
			source,
		})
		db.league.recordTeams([named("from a box score", "box-score")])
		db.league.recordTeams([named("from a search", "search")])
		expect(db.league.getTeam("11", "100")?.name).toBe("from a box score")
		db.league.recordTeams([named("from the teams page", "teams-page")])
		db.league.recordTeams([named("from another box score", "box-score")])
		expect(db.league.getTeam("11", "100")?.name).toBe("from the teams page")
	})

	test("a schedule reads back as listed, with names from teams", () => {
		const db = openDatabase(":memory:")
		db.league.saveTeamsPage(teamsPage, true)
		const games: KHLGame[] = [
			{
				id: "900",
				seasonId: "100",
				team: {id: "11", name: "Bullets"},
				opponent: {id: "22", name: "Flamingos"},
				homeAway: "away",
				localDate: "2026-10-17",
				localTime: "21:00",
				startsAt: "2026-10-18T04:00:00.000Z",
				arena: {id: "14", name: "Lynnwood"},
				result: "W",
				score: "4 - 2",
				isFinal: true,
			},
		]
		db.league.saveSchedule("11", "100", games)
		expect(db.league.getSchedule("11", "100")).toEqual(games)
	})

	test("a team's stats read back, with its seasons from the teams pages", () => {
		const db = createDb()
		db.league.saveTeamsPage(teamsPage, true)
		db.league.saveTeamsPage(
			{
				...teamsPage,
				season: teamsPage.seasons[1]!,
				teams: [{...teamsPage.teams[0]!, seasonId: "96"}],
			},
			false,
		)
		const teamStats: KHLTeamStats = {
			teamId: "11",
			seasonId: "100",
			seasons: teamsPage.seasons,
			skaterColumns: ["GP", "G"],
			skaters: [
				{
					playerId: "501",
					number: "9",
					name: "Brandon Smith",
					stats: {GP: "3", G: "1"},
				},
			],
			goalieColumns: ["GP", "SV"],
			goalies: [],
		}
		db.league.saveTeamStats(teamStats)
		expect(db.league.getTeamStats("11", "100")).toEqual(teamStats)
		expect(db.league.getSeasonRosters("100").get("11")?.length).toBe(1)
	})

	test("a player page reads back", () => {
		const db = createDb()
		const player: KHLPlayer = {
			playerId: "501",
			teamId: "11",
			seasonId: "100",
			name: "Brandon Smith",
			number: "9",
			position: "Skater",
			teamLine: "Bullets - Division 5",
			statSections: [
				{
					title: "Career",
					stats: [{label: "GP", value: "40", note: null}],
				},
			],
			seasonTables: [],
		}
		db.league.savePlayerProfile(player)
		const key = toRegistrationKey({khlPlayerId: "501", teamId: "11"})
		expect(db.league.getPlayerProfile(key, "100")).toEqual(player)
		expect(db.league.getPlayerProfile(key, "96")).toBeNull()
	})
})

describe("registrations", () => {
	test("a registration's team name and logo come from teams", () => {
		const db = createDb()
		const playerId = db.findPlayerIdForRegistration("501")!
		expect(db.getRegistrations(playerId)[0]!.teamName).toBe("Bullets")
		db.league.recordTeams([
			{
				teamId: "11",
				seasonId: "100",
				name: "Bullets FC",
				logoUrl: "https://example.com/b.png",
				divisionId: null,
				source: "teams-page",
			},
		])
		expect(db.getRegistrations(playerId)[0]).toMatchObject({
			teamName: "Bullets FC",
			teamLogoUrl: "https://example.com/b.png",
		})
	})

	test("a team's player pages are synced as of each player's latest season there", () => {
		const db = openDatabase(":memory:")
		const row = {
			name: "Kim Lee",
			position: null,
			teamId: "11",
			teamName: "Bullets",
			teamLogoUrl: null,
		}
		db.recordRegistrations(
			[
				{...row, playerId: "601", seasonId: "99"},
				{...row, playerId: "601", seasonId: "100"},
				{...row, playerId: "602", name: "Ana Diaz", seasonId: "99"},
			],
			"roster",
		)
		expect(db.getTeamSeasonLatestPlayerIds("11", "100")).toEqual(["601"])
		expect(db.getTeamSeasonLatestPlayerIds("11", "99")).toEqual(["602"])
	})

	test("a new KHL id matching one player's name is recorded as a match", () => {
		const db = openDatabase(":memory:")
		const row = {
			name: "Kim Lee",
			position: null,
			teamName: "Bullets",
			teamLogoUrl: null,
			seasonId: "100",
		}
		const ids = db.recordRegistrations(
			[
				{...row, playerId: "601", teamId: "11"},
				{...row, playerId: "701", teamId: "22"},
			],
			"roster",
		)
		// Accepted, until acceptNameMatch decides otherwise
		expect(ids.get("701")).toBe(ids.get("601"))
		expect(db.getNameMatches()).toEqual([
			{
				khlPlayerId: "701",
				teamId: "22",
				playerId: ids.get("601")!,
				accepted: true,
			},
		])
	})
})

describe("the fetch queue", () => {
	const queue = (
		db: KHLDatabase,
		page: SyncPage,
		priority: number,
		nextAt: number,
		ifSyncedBefore?: number,
	) =>
		db.league.enqueue(
			getSyncPageUrl(page),
			page,
			{seasonId: null, priority, nextAt},
			ifSyncedBefore,
		)
	const game = (gameId: string): SyncPage => ({kind: "game", gameId})

	test("takes the most urgent due page: by priority, then due time", () => {
		const db = openDatabase(":memory:")
		queue(db, game("1"), 2, 0)
		queue(db, game("2"), 0, 50)
		queue(db, game("3"), 0, 10)
		queue(db, game("4"), 0, 500)
		expect(db.league.takeDue(100)?.page).toEqual(game("3"))
		db.league.markSynced(getSyncPageUrl(game("3")), {
			nextAt: 1_000,
			version: 1,
			now: 100,
		})
		expect(db.league.takeDue(100)?.page).toEqual(game("2"))
		expect(db.league.getNextDueAt()).toBe(0)
	})

	test("queues a page once, and brings it forward only if it's out of date", () => {
		const db = openDatabase(":memory:")
		const url = getSyncPageUrl(game("1"))
		queue(db, game("1"), 0, 500)
		queue(db, game("1"), 0, 100)
		expect(db.league.takeDue(200)).toBeNull()

		db.league.markSynced(url, {nextAt: 500, version: 1, now: 50})
		// Synced after the cutoff: already up to date
		queue(db, game("1"), 0, 100, 40)
		expect(db.league.takeDue(200)).toBeNull()
		queue(db, game("1"), 0, 100, 60)
		expect(db.league.takeDue(200)?.page).toEqual(game("1"))
	})

	test("knows what's synced, and what an older processing built", () => {
		const db = openDatabase(":memory:")
		const url = getSyncPageUrl(game("1"))
		queue(db, game("1"), 0, 0)
		expect(db.league.isSynced(url)).toBe(false)
		db.league.markSynced(url, {nextAt: 1_000, version: 1, now: 0})
		expect(db.league.isSynced(url)).toBe(true)
		expect(db.league.takeOutdated(1)).toBeNull()
		expect(db.league.takeOutdated(2)?.page).toEqual(game("1"))
		// One that failed waits until it's due
		db.league.markFailed(url, {nextAt: 1_000, error: "can't parse"})
		expect(db.league.takeOutdated(2)).toBeNull()
		expect(db.league.isSynced(url)).toBe(true)
	})
})
