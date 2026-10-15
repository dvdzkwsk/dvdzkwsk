/** Links into LiveBarn's watch site, shared by the server and client. */

import {DAY_MS, getLeagueDayKey} from "./LeagueTime.js"

const LIVEBARN_WATCH_URL = "https://watch.livebarn.com/en/video"

/**
 * LiveBarn's player can't be embedded (X-Frame-Options: deny), so these are
 * deep links into watch.livebarn.com. Routes come from its web app:
 * /:lang/video/:surfaceId/live and /:lang/video/:surfaceId/:date/:time, where
 * the date and time are local to the venue ("yyyy-MM-dd" and "HH:mm").
 */
export function getLiveBarnLiveUrl(surfaceId: number): string {
	return `${LIVEBARN_WATCH_URL}/${surfaceId}/live`
}

export function getLiveBarnVodUrl(
	surfaceId: number,
	localDate: string,
	localTime: string,
): string {
	return `${LIVEBARN_WATCH_URL}/${surfaceId}/${localDate}/${localTime}`
}

/** How long LiveBarn keeps recordings. Older replays may be gone. */
export const LIVEBARN_VOD_EXPIRY = 30 * DAY_MS

/** A replay link's venue-local "yyyy-MM-dd", or null for a live feed */
export function getLiveBarnVodDate(url: string): string | null {
	const match = url.match(/\/video\/\d+\/(\d{4}-\d{2}-\d{2})\//)
	return match?.[1] ?? null
}

/**
 * Whether a replay link is older than LiveBarn keeps recordings. Venues are
 * on league time, so their dates compare with league day keys.
 */
export function isLiveBarnVodExpired(url: string, now: Date): boolean {
	const date = getLiveBarnVodDate(url)
	const oldestKept = getLeagueDayKey(
		new Date(now.getTime() - LIVEBARN_VOD_EXPIRY),
	)
	return date !== null && date < oldestKept
}
