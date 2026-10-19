import {matchField} from "@dvdzkwsk/util/MatchUtil"
import {z} from "zod"
import {
	getKHLBoxScoreUrl,
	getKHLPlayerUrl,
	getKHLTeamScheduleUrl,
	getKHLTeamsPageUrl,
	getKHLTeamStatsUrl,
} from "./KHL.js"
import {RegistrationKeySchema} from "../shared/ApiJson.js"

/** A KHL page the syncer keeps, and what its URL is built from */
export type SyncPage = z.infer<typeof SyncPageSchema>

export const SyncPageSchema = z.discriminatedUnion("kind", [
	/**
	 * A season's teams page; null for the league's default one, which also
	 * says which season is current
	 */
	z.object({kind: z.literal("teams"), seasonId: z.string().nullable()}),
	z.object({
		kind: z.literal("schedule"),
		teamId: z.string(),
		seasonId: z.string(),
	}),
	z.object({
		kind: z.literal("team-stats"),
		teamId: z.string(),
		seasonId: z.string(),
	}),
	z.object({
		kind: z.literal("player"),
		registrationKey: RegistrationKeySchema,
		seasonId: z.string(),
	}),
	/** The box score and the stats page, fetched together */
	z.object({kind: z.literal("game"), gameId: z.string()}),
])

/** The URL a page is stored and queued under; a game's is its box score's */
export function getSyncPageUrl(page: SyncPage): string {
	return matchField(page, "kind", {
		teams: (p) => getKHLTeamsPageUrl(p.seasonId ?? undefined),
		schedule: (p) => getKHLTeamScheduleUrl(p.teamId, p.seasonId),
		"team-stats": (p) => getKHLTeamStatsUrl(p.teamId, p.seasonId),
		player: (p) => getKHLPlayerUrl(p.registrationKey, p.seasonId),
		game: (p) => getKHLBoxScoreUrl(p.gameId),
	}).toString()
}
