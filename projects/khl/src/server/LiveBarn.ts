import {doFetch} from "@dvdzkwsk/util/FetchUtil"
import {
	LiveBarnVenuesResponse,
	LiveBarnVenuesResponseSchema,
} from "../shared/LiveBarnJson.js"

const LIVEBARN_API_URL = "https://prod-watch-oktaapi.livebarn.com/api/v2.0.0"
/** Every LiveBarn venue; also what the status page checks LiveBarn with */
export const LIVEBARN_VENUES_URL = `${LIVEBARN_API_URL}/staticdata/venues`

export function getLivebarnVenues(): Promise<LiveBarnVenuesResponse> {
	return doFetch({
		method: "GET",
		url: LIVEBARN_VENUES_URL,
		responseSchema: LiveBarnVenuesResponseSchema,
	})
}
