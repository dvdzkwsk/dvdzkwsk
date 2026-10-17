import {Registration} from "./Database.js"
import {
	IntegrityMismatch,
	IntegrityRecord,
	IntegritySource,
	JsonDifference,
	JsonValue,
} from "../shared/ApiJson.js"
import {KHLPlayer, KHLPlayerSearchResult} from "../shared/KHLJson.js"

/**
 * Where a stored registration disagrees with the KHL's all-seasons search
 * rows for its KHL id and team (null if the search failed) and its KHL player
 * page (null if that failed). Position and logo only count when the KHL has one, since
 * we keep the last one we saw.
 */
export function compareRegistration(
	ours: Registration,
	searchResults: KHLPlayerSearchResult[] | null,
	profile: KHLPlayer | null,
): IntegrityMismatch[] {
	const mismatches: IntegrityMismatch[] = []
	const compare = (
		source: IntegritySource,
		field: string,
		oursValue: string | null,
		khlValue: string | null,
	) => {
		if (oursValue !== khlValue) {
			mismatches.push({
				source,
				field,
				ours: oursValue,
				khl: khlValue,
				detail: null,
			})
		}
	}

	if (searchResults && searchResults.length === 0) {
		mismatches.push({
			source: "search",
			field: "listed",
			ours: "yes",
			khl: "no",
			detail: "Not in the KHL's all-seasons search for this name",
		})
	}
	if (searchResults && searchResults.length > 0) {
		const latest = searchResults.reduce((a, b) =>
			Number(b.seasonId) > Number(a.seasonId) ? b : a,
		)
		compare("search", "name", ours.name, latest.name)
		compare("search", "team name", ours.teamName, latest.teamName)
		if (latest.position !== null) {
			compare("search", "position", ours.position, latest.position)
		}
		if (latest.teamLogoUrl !== null) {
			compare("search", "team logo", ours.teamLogoUrl, latest.teamLogoUrl)
		}
		const seasons = compareSeasons(
			"search",
			ours.seasonIds,
			searchResults.map((r) => r.seasonId),
		)
		if (seasons) {
			mismatches.push(seasons)
		}
	}

	if (profile) {
		compare("profile", "name", ours.name, profile.name)
		compare("profile", "position", ours.position, profile.position)
		if (profile.teamLine !== null) {
			compare(
				"profile",
				"team name",
				ours.teamName,
				getTeamLineName(profile.teamLine),
			)
		}
		// Seasons on the id's other teams belong to other registrations
		const seasons = compareSeasons(
			"profile",
			ours.seasonIds,
			getProfileSeasonIds(profile, ours.teamId),
		)
		if (seasons) {
			mismatches.push(seasons)
		}
	}
	return mismatches
}

/** A registration's comparable fields, in the order a resync stores them */
export function toIntegrityRecord(
	r: Pick<Registration, keyof IntegrityRecord>,
): IntegrityRecord {
	return {
		name: r.name,
		position: r.position,
		teamId: r.teamId,
		teamName: r.teamName,
		teamLogoUrl: r.teamLogoUrl,
		seasonIds: sortSeasonIds(r.seasonIds),
	}
}

/**
 * What a resync should store for a registration, or null if it already
 * matches. Fields come from the latest search row (position and logo only
 * when the KHL has one; the profile page's position is often malformed).
 * Seasons are both pages' seasons together. A stored season is dropped only
 * when both pages loaded and the search lists the id, so neither a failed
 * page nor a renamed player loses data.
 */
export function reconcileRegistration(
	ours: Registration,
	searchResults: KHLPlayerSearchResult[] | null,
	profile: KHLPlayer | null,
): IntegrityRecord | null {
	const latest = searchResults?.length
		? searchResults.reduce((a, b) =>
				Number(b.seasonId) > Number(a.seasonId) ? b : a,
			)
		: null
	const khlSeasons = [
		...(searchResults ?? []).map((r) => r.seasonId),
		...(profile ? getProfileSeasonIds(profile, ours.teamId) : []),
	]
	const isComplete = !!latest && !!profile
	const reconciled = toIntegrityRecord({
		name: latest?.name ?? ours.name,
		position: latest?.position ?? ours.position,
		teamId: ours.teamId,
		teamName: latest?.teamName ?? ours.teamName,
		teamLogoUrl: latest?.teamLogoUrl ?? ours.teamLogoUrl,
		seasonIds: isComplete ? khlSeasons : [...ours.seasonIds, ...khlSeasons],
	})
	const unchanged = diffJson(toIntegrityRecord(ours), reconciled).length === 0
	return unchanged ? null : reconciled
}

/** The seasons a KHL player page lists on one team */
function getProfileSeasonIds(profile: KHLPlayer, teamId: string): string[] {
	return profile.seasonTables
		.flatMap((table) => table.rows)
		.filter((row) => row.teamId === teamId)
		.map((row) => row.seasonId)
}

/** Deduplicated, oldest first */
function sortSeasonIds(ids: Iterable<string>): string[] {
	return [...new Set(ids)].sort((a, b) => Number(a) - Number(b))
}

/** How long a value in a JsonDifference can get before it's shortened */
const DIFFERENCE_VALUE_LENGTH = 120

/**
 * Every value that differs between our copy and the KHL's, by path
 * ("[3].startsAt"). Arrays compare by index, so a game inserted mid-schedule
 * also shows up as a length change plus each shifted item.
 */
export function diffJson(
	ours: JsonValue,
	khl: JsonValue,
	path = "",
	out: JsonDifference[] = [],
): JsonDifference[] {
	if (Array.isArray(ours) && Array.isArray(khl)) {
		// A list of plain values ("seasonIds") reads best whole: one inserted
		// season would otherwise shift every index after it
		if ([...ours, ...khl].every((item) => !isJsonContainer(item))) {
			if (JSON.stringify(ours) !== JSON.stringify(khl)) {
				out.push(toDifference(path || "(root)", ours, khl))
			}
			return out
		}
		if (ours.length !== khl.length) {
			out.push({
				path: `${path || "(root)"} (length)`,
				ours: String(ours.length),
				khl: String(khl.length),
			})
		}
		for (let i = 0; i < Math.max(ours.length, khl.length); i++) {
			if (i >= ours.length || i >= khl.length) {
				out.push(toDifference(`${path}[${i}]`, ours[i], khl[i]))
			} else {
				diffJson(ours[i]!, khl[i]!, `${path}[${i}]`, out)
			}
		}
		return out
	}
	if (isJsonObject(ours) && isJsonObject(khl)) {
		const keys = new Set([...Object.keys(ours), ...Object.keys(khl)])
		for (const key of keys) {
			const childPath = path ? `${path}.${key}` : key
			if (!(key in ours) || !(key in khl)) {
				out.push(toDifference(childPath, ours[key], khl[key]))
			} else {
				diffJson(ours[key]!, khl[key]!, childPath, out)
			}
		}
		return out
	}
	if (ours !== khl) {
		out.push(toDifference(path || "(root)", ours, khl))
	}
	return out
}

function isJsonContainer(value: JsonValue): boolean {
	return typeof value === "object" && value !== null
}

function isJsonObject(value: JsonValue): value is {[key: string]: JsonValue} {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toDifference(
	path: string,
	ours: JsonValue | undefined,
	khl: JsonValue | undefined,
): JsonDifference {
	const show = (value: JsonValue | undefined) => {
		if (value === undefined) {
			return null
		}
		const json = JSON.stringify(value)
		return json.length > DIFFERENCE_VALUE_LENGTH
			? `${json.slice(0, DIFFERENCE_VALUE_LENGTH - 1)}…`
			: json
	}
	return {path, ours: show(ours), khl: show(khl)}
}

/** "Brewzers OGB - Division 5B" → "Brewzers OGB" */
function getTeamLineName(teamLine: string): string {
	const separator = teamLine.lastIndexOf(" - ")
	return separator === -1 ? teamLine : teamLine.slice(0, separator)
}

function compareSeasons(
	source: IntegritySource,
	ours: string[],
	khl: string[],
): IntegrityMismatch | null {
	const sort = sortSeasonIds
	const oursSet = new Set(ours)
	const khlSet = new Set(khl)
	const missing = sort(khl.filter((id) => !oursSet.has(id)))
	const extra = sort(ours.filter((id) => !khlSet.has(id)))
	if (missing.length === 0 && extra.length === 0) {
		return null
	}
	return {
		source,
		field: "seasons",
		ours: sort(ours).join(", "),
		khl: sort(khl).join(", "),
		detail: [
			missing.length > 0 && `Missing from ours: ${missing.join(", ")}`,
			extra.length > 0 && `Not on the KHL: ${extra.join(", ")}`,
		]
			.filter(Boolean)
			.join(". "),
	}
}
