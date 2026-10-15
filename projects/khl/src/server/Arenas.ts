import {CityId} from "../shared/Cities.js"
import {KHLArenaRef} from "../shared/KHLJson.js"

/**
 * KHL arenas (/arena/:id) and the LiveBarn surfaces that film them. Names and
 * addresses differ between the two sites (e.g. KHL lists KCI at 10601 5th Ave
 * NE, LiveBarn at 401 NE Northgate Way), so this is maintained by hand.
 *
 * Names are recorded alongside ids so Server.ts can check them against both
 * sites at runtime: if either side renames or reassigns an id, the link is
 * dropped and logged rather than sending viewers to the wrong rink.
 *
 * Arenas with several surfaces have more than one LiveBarn rink, and the KHL
 * schedule doesn't say which one a game is on.
 */
export interface ArenaMapping {
	/** As shown on the KHL arena page */
	khlArenaName: string
	/** Shown to users instead of the KHL's name (and its abbreviations) */
	displayName?: string
	/** From the arena's address; used to filter games by area */
	city: CityId
	livebarnSurfaces: LiveBarnSurfaceMapping[]
}

export interface LiveBarnSurfaceMapping {
	surfaceId: number
	venueName: string
	surfaceName: string
}

const KCI = "Kraken Community Iceplex"
const OLYMPICVIEW = "Olympicview Arena"
const ANGEL_OF_THE_WINDS = "Angel Of The Winds Arena"

export const KHL_ARENA_LIVEBARN_SURFACES: Record<string, ArenaMapping> = {
	"13": {
		khlArenaName: "Olympic View Arena",
		city: "mountlake-terrace-wa",
		livebarnSurfaces: [
			{surfaceId: 761, venueName: OLYMPICVIEW, surfaceName: "Main Rink"},
		],
	},
	"14": {
		khlArenaName: "Lynnwood Ice Center",
		city: "lynnwood-wa",
		livebarnSurfaces: [
			{
				surfaceId: 893,
				venueName: "Lynnwood Ice Center",
				surfaceName: "Main Rink",
			},
		],
	},
	"15": {
		khlArenaName: "SnoKing Renton",
		city: "renton-wa",
		livebarnSurfaces: [
			{
				surfaceId: 1047,
				venueName: "Sno-King Renton",
				surfaceName: "Rink #1",
			},
			{
				surfaceId: 1048,
				venueName: "Sno-King Renton",
				surfaceName: "Rink #2",
			},
		],
	},
	"16": {
		khlArenaName: "Kent Valley Ice Centre",
		city: "kent-wa",
		livebarnSurfaces: [
			{
				surfaceId: 1276,
				venueName: "Kent Valley Ice Centre",
				surfaceName: "Rink #1",
			},
		],
	},
	"17": {
		khlArenaName: "SnoKing Kirkland",
		city: "kirkland-wa",
		livebarnSurfaces: [
			{
				surfaceId: 1049,
				venueName: "Sno-King Kirkland",
				surfaceName: "Rink #1",
			},
		],
	},
	"18": {
		khlArenaName: "Everett Comm Ice Rink",
		city: "everett-wa",
		livebarnSurfaces: [
			{
				surfaceId: 1687,
				venueName: ANGEL_OF_THE_WINDS,
				surfaceName: "Everett Community Ice Rink",
			},
		],
	},
	"19": {
		khlArenaName: "Angel of the Winds Arena",
		city: "everett-wa",
		livebarnSurfaces: [
			{
				surfaceId: 1686,
				venueName: ANGEL_OF_THE_WINDS,
				surfaceName: "Angel Of The Winds Arena",
			},
		],
	},
	"20": {
		khlArenaName: "accesso ShoWare Center",
		displayName: "ShoWare Center",
		city: "kent-wa",
		livebarnSurfaces: [],
	},
	"21": {
		khlArenaName: "Highland Ice Arena",
		city: "shoreline-wa",
		livebarnSurfaces: [],
	},
	"22": {
		khlArenaName: "SoDo Arena",
		city: "seattle-wa",
		livebarnSurfaces: [],
	},
	"23": {
		khlArenaName: "Winthrop Ice and Sports Rink",
		city: "winthrop-wa",
		livebarnSurfaces: [],
	},
	"24": {
		// [sic] on the KHL site
		khlArenaName: "Tacoma Twim Rinks",
		city: "tacoma-wa",
		livebarnSurfaces: [
			{
				surfaceId: 1038,
				venueName: "Tacoma Twin Rinks",
				surfaceName: "North Rink",
			},
			{
				surfaceId: 1037,
				venueName: "Tacoma Twin Rinks",
				surfaceName: "South Rink",
			},
		],
	},
	"25": {
		khlArenaName: "Sprinker Recreation Center",
		city: "tacoma-wa",
		livebarnSurfaces: [],
	},
	// Halves of Olympicview's single sheet; LiveBarn has one surface for it
	"26": {
		khlArenaName: "OVA - Zamboni Side",
		city: "mountlake-terrace-wa",
		livebarnSurfaces: [
			{surfaceId: 761, venueName: OLYMPICVIEW, surfaceName: "Main Rink"},
		],
	},
	"27": {
		khlArenaName: "OVA - Cafe Side",
		city: "mountlake-terrace-wa",
		livebarnSurfaces: [
			{surfaceId: 761, venueName: OLYMPICVIEW, surfaceName: "Main Rink"},
		],
	},
	"28": {
		khlArenaName: "KCI Starbucks Rink",
		city: "seattle-wa",
		livebarnSurfaces: [
			{
				surfaceId: 2270,
				venueName: KCI,
				surfaceName: "Starbucks Community Rink",
			},
		],
	},
	"29": {
		khlArenaName: "KCI Smartsheet Rink",
		city: "seattle-wa",
		livebarnSurfaces: [
			{surfaceId: 2271, venueName: KCI, surfaceName: "Smartsheet Rink"},
		],
	},
	"30": {
		khlArenaName: "KCI VMFH Rink",
		city: "seattle-wa",
		livebarnSurfaces: [
			{
				surfaceId: 2272,
				venueName: KCI,
				surfaceName: "Virginia Mason Franciscan Health Rink",
			},
		],
	},
	"31": {
		khlArenaName: "Berger Foundation Iceplex",
		city: "palm-desert-ca",
		livebarnSurfaces: [
			{
				surfaceId: 4073,
				venueName: "Berger Foundation Iceplex",
				surfaceName: "Berger Foundation Iceplex",
			},
		],
	},
}

/** What to call an arena: its display name, else the name KHL gave it. */
export function getArenaName(arena: KHLArenaRef): string {
	return KHL_ARENA_LIVEBARN_SURFACES[arena.id]?.displayName ?? arena.name
}

/** `arena` renamed for display, for passing KHL data through to clients. */
export function toDisplayArena(arena: KHLArenaRef | null): KHLArenaRef | null {
	return arena && {id: arena.id, name: getArenaName(arena)}
}
