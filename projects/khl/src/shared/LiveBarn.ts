/** Links into LiveBarn's watch site, shared by the server and client. */

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
