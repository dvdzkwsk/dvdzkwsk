import {describe, expect, test} from "bun:test"
import {openDatabase} from "./Database.js"
import {toGameRecords} from "./GameRecords.js"
import {toRegistrationKey} from "../shared/ApiJson.js"
import {KHLBoxScore, KHLGameStats} from "../shared/KHLJson.js"

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

const row = (playerId: string) => ({
	playerId,
	number: null,
	name: playerId,
	stats: {},
})

const stats: KHLGameStats = {
	gameId: "900",
	away: {
		skaterColumns: [],
		skaters: [row("501"), row("502")],
		goalieColumns: [],
		goalies: [],
	},
	home: {
		skaterColumns: [],
		skaters: [row("601")],
		goalieColumns: [],
		goalies: [],
	},
}

/** A database with the game saved and its players' names recorded */
const saveGame = (gameStats: KHLGameStats | null = stats) => {
	const db = openDatabase(":memory:")
	db.recordRegistrations(
		[
			{playerId: "501", name: "Brandon Smith", teamId: "11"},
			{playerId: "502", name: "Ana Diaz", teamId: "11"},
			{playerId: "601", name: "Kim Lee", teamId: "22"},
		].map((r) => ({
			...r,
			position: null,
			teamName: r.teamId === "11" ? "Bullets" : "Flamingos",
			teamLogoUrl: null,
			seasonId: "100",
		})),
	)
	const records = toGameRecords(boxScore, gameStats)
	db.saveGame(records.game, records.teams, records.events, records.lineups)
	return db
}

describe("games tables", () => {
	test("a player's goals, assists, and penalties read back as on the scoresheet", () => {
		const db = saveGame()
		const events = db.getGameEvents(["900"], {
			kind: "players",
			khlPlayerIds: ["502"],
		})
		expect(events.map((e) => e.event)).toEqual([
			{kind: "assist", goal: boxScore.goals[0]!},
			{kind: "penalty", penalty: boxScore.penalties[0]!},
		])
	})

	test("a team's events are its goals and penalties, bench ones included", () => {
		const db = saveGame()
		const events = db.getGameEvents(["900"], {kind: "team", teamId: "22"})
		expect(events.map((e) => e.event.kind)).toEqual(["goal", "penalty"])
	})

	test("teams' names and logos come from the teams table", () => {
		const db = saveGame()
		db.recordTeams(
			[
				{
					teamId: "11",
					seasonId: "100",
					name: "Bullets (from the teams page)",
					logoUrl: null,
					divisionId: "5",
				},
			],
			[{divisionId: "5", seasonId: "100", name: "Division 5"}],
		)
		const game = db.getGames(["900"]).get("900")!
		expect(game.away.name).toBe("Bullets (from the teams page)")
		// Known only from its players' rows and the box score
		expect(game.home.name).toBe("Flamingos")
	})

	test("lineups say who dressed, and whether they're posted", () => {
		const db = saveGame()
		expect(db.getDressedGameIds(["900"], ["601"])).toEqual(new Set(["900"]))
		expect(db.getDressedGameIds(["900"], ["999"])).toEqual(new Set())
		const game = db.getGames(["900"]).get("900")!
		expect(game.away.lineupPosted).toBe(true)

		const unposted = saveGame(null).getGames(["900"]).get("900")!
		expect(unposted.away.lineupPosted).toBe(false)
	})

	test("each player's latest completed game is by their team", () => {
		const db = saveGame()
		const completedAt = db.getGames(["900"]).get("900")!.completedAt!
		const onBullets = toRegistrationKey({khlPlayerId: "501", teamId: "11"})
		const elsewhere = toRegistrationKey({khlPlayerId: "501", teamId: "99"})
		expect(db.getLatestCompletedGames([onBullets, elsewhere])).toEqual(
			new Map([[onBullets, completedAt]]),
		)
		expect(db.getTeamLatestCompletedGame("11", "100")).toBe(completedAt)
		expect(db.getTeamLatestCompletedGame("11", "99")).toBeNull()
	})

	test("a game is completed once, and never replaced by an incomplete copy", () => {
		const db = saveGame()
		const completedAt = db.getGames(["900"]).get("900")!.completedAt
		expect(completedAt).not.toBeNull()

		const older = toGameRecords(boxScore, null)
		expect(
			db.saveGame(older.game, older.teams, older.events, older.lineups),
		).toBe(false)
		expect(db.getGames(["900"]).get("900")!.away.lineupPosted).toBe(true)

		const again = toGameRecords(boxScore, stats)
		again.game.processedAt += 60_000
		db.saveGame(again.game, again.teams, again.events, again.lineups)
		expect(db.getGames(["900"]).get("900")!.completedAt).toBe(completedAt)

		expect(
			saveGame(null).getGames(["900"]).get("900")!.completedAt,
		).toBeNull()
	})

	test("a game's league-local date and time come from its start", () => {
		const game = saveGame().getGames(["900"]).get("900")!
		expect([game.localDate, game.localTime]).toEqual([
			"2026-10-17",
			"21:00",
		])
	})

	test("goals and penalties read back in scoresheet order", () => {
		const db = openDatabase(":memory:")
		const early = {
			period: "1st",
			time: "18:00",
			teamId: "11",
			player: null,
			infraction: "Delay of game",
			duration: "2:00",
		}
		const records = toGameRecords(
			{...boxScore, penalties: [early, ...boxScore.penalties]},
			stats,
		)
		db.saveGame(
			records.game,
			records.teams,
			records.events,
			records.lineups,
		)
		const events = db.getGameEvents(["900"], {kind: "team", teamId: "11"})
		expect(events.map((e) => e.event)).toEqual([
			{kind: "penalty", penalty: early},
			// Its scorer and assist weren't recorded, so they go by id
			{
				kind: "goal",
				goal: {
					...boxScore.goals[0]!,
					scorer: {id: "501", name: "501"},
					assists: [{id: "502", name: "502"}],
				},
			},
			{
				kind: "penalty",
				penalty: {
					...boxScore.penalties[0]!,
					player: {id: "502", name: "502"},
				},
			},
		])
	})

	test("saving a game again replaces it", () => {
		const db = saveGame()
		const records = toGameRecords(
			{...boxScore, goals: [], penalties: []},
			stats,
		)
		db.saveGame(
			records.game,
			records.teams,
			records.events,
			records.lineups,
		)
		expect(db.getGameEvents(["900"], {kind: "team", teamId: "11"})).toEqual(
			[],
		)
	})
})

describe("other synced records", () => {
	test("a team's schedule is replaced as a whole", () => {
		const db = openDatabase(":memory:")
		const game = {
			gameId: "1",
			startsAt: "2026-10-18T04:00:00.000Z",
			isFinal: false,
		}
		db.saveSchedule("11", "100", [game, {...game, gameId: null}])
		db.saveSchedule("11", "100", [{...game, isFinal: true}])
		expect(db.getSchedule("11", "100")).toEqual([{...game, isFinal: true}])
		expect(db.getSeasonSchedules("100")).toEqual(
			new Map([["11", [{...game, isFinal: true}]]]),
		)
	})

	test("a registration's team name and logo come from teams", () => {
		const db = saveGame()
		const playerId = db.findPlayerIdForRegistration("501")!
		expect(db.getRegistrations(playerId)[0]!.teamName).toBe("Bullets")
		db.recordTeams(
			[
				{
					teamId: "11",
					seasonId: "100",
					name: "Bullets FC",
					logoUrl: "https://example.com/b.png",
					divisionId: null,
				},
			],
			[],
		)
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
		db.recordRegistrations([
			{...row, playerId: "601", seasonId: "99"},
			{...row, playerId: "601", seasonId: "100"},
			{...row, playerId: "602", name: "Ana Diaz", seasonId: "99"},
		])
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
		const ids = db.recordRegistrations([
			{...row, playerId: "601", teamId: "11"},
			{...row, playerId: "701", teamId: "22"},
		])
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
