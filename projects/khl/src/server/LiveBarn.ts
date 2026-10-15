import {doFetch} from "@dvdzkwsk/util/FetchUtil"
import {
	LiveBarnVenuesResponse,
	LiveBarnVenuesResponseSchema,
} from "../shared/LiveBarnJson.js"

const LIVEBARN_API_URL = "https://prod-watch-oktaapi.livebarn.com/api/v2.0.0"
/** Every LiveBarn venue; also what the status page checks LiveBarn with */
export const LIVEBARN_VENUES_URL = `${LIVEBARN_API_URL}/staticdata/venues`
const LIVEBARN_WATCH_URL = "https://watch.livebarn.com/en/video"

export function getLivebarnVenues(): Promise<LiveBarnVenuesResponse> {
	return doFetch({
		method: "GET",
		url: LIVEBARN_VENUES_URL,
		responseSchema: LiveBarnVenuesResponseSchema,
	})
}

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
