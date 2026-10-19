/**
 * Converts a wall-clock date and time in `timeZone` to the instant it
 * represents, e.g. ("2026-10-12", "21:25", "America/Los_Angeles").
 */
export function zonedTimeToDate(
	localDate: string,
	localTime: string,
	timeZone: string,
): Date {
	const [year, month, day] = localDate.split("-").map(Number)
	const [hour, minute] = localTime.split(":").map(Number)
	if ([year, month, day, hour, minute].some((n) => !Number.isInteger(n))) {
		throw new Error(`invalid local date/time: ${localDate} ${localTime}`)
	}
	// Treat the wall-clock time as UTC, then shift by the zone's offset. The
	// offset is re-checked at the result so DST transitions resolve correctly.
	const wallClockAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!)
	let offset = getTimeZoneOffsetMs(new Date(wallClockAsUtc), timeZone)
	const corrected = getTimeZoneOffsetMs(
		new Date(wallClockAsUtc - offset),
		timeZone,
	)
	if (corrected !== offset) {
		offset = corrected
	}
	return new Date(wallClockAsUtc - offset)
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(date)
	const get = (type: Intl.DateTimeFormatPartTypes) => {
		return Number(parts.find((p) => p.type === type)?.value)
	}
	const zonedAsUtc = Date.UTC(
		get("year"),
		get("month") - 1,
		get("day"),
		get("hour"),
		get("minute"),
		get("second"),
	)
	return zonedAsUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** An epoch-ms time as ISO 8601, or null for null */
export function toIsoOrNull(ms: number | null): string | null {
	return ms === null ? null : new Date(ms).toISOString()
}
