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
			teamName: r.teamId,
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
		db.recordTeams([
			{
				teamId: "11",
				seasonId: "100",
				name: "Bullets (from the teams page)",
				logoUrl: null,
				divisionId: "5",
			},
		])
		const game = db.getGames(["900"]).get("900")!
		expect(game.away.name).toBe("Bullets (from the teams page)")
		// Known only from the box score
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

	test("each player's latest game is by their team", () => {
		const db = saveGame()
		const onBullets = toRegistrationKey({khlPlayerId: "501", teamId: "11"})
		const elsewhere = toRegistrationKey({khlPlayerId: "501", teamId: "99"})
		expect(db.getLatestDressedGameStarts([onBullets, elsewhere])).toEqual(
			new Map([[onBullets, boxScore.startsAt]]),
		)
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
