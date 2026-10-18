import {Logger} from "@dvdzkwsk/logger"
import {doFetch} from "@dvdzkwsk/util/FetchUtil"
import {z} from "zod"
import {readPage} from "./PageStore.js"
import {
	LiveBarnVenuesResponse,
	LiveBarnVenuesResponseSchema,
} from "../shared/LiveBarnJson.js"

const logger = new Logger("LiveBarn")

const LIVEBARN_API_URL = "https://prod-watch-oktaapi.livebarn.com/api/v2.0.0"
/** Every LiveBarn venue; also what the status page checks LiveBarn with */
export const LIVEBARN_VENUES_URL = `${LIVEBARN_API_URL}/staticdata/venues`
/** The venues list is several MB, so it gets longer than a KHL page */
const LIVEBARN_FETCH_TIMEOUT_MS = 30_000

/** Read through the page store, so a stored copy saves a fetch */
export function getLivebarnVenues(): Promise<LiveBarnVenuesResponse> {
	return readPage(
		"livebarn",
		LIVEBARN_VENUES_URL,
		() =>
			doFetch({
				method: "GET",
				url: LIVEBARN_VENUES_URL,
				responseFormat: "text",
				responseSchema: z.string(),
				timeoutMs: LIVEBARN_FETCH_TIMEOUT_MS,
			}),
		parseVenues,
	)
}

function parseVenues(body: string): LiveBarnVenuesResponse {
	let json: unknown
	try {
		json = JSON.parse(body)
	} catch (error) {
		throw logger.newError("parseVenues", "venues aren't JSON", {
			url: LIVEBARN_VENUES_URL,
			error,
		})
	}
	const result = LiveBarnVenuesResponseSchema.safeParse(json)
	if (!result.success) {
		throw logger.newError("parseVenues", "unexpected venues", {
			url: LIVEBARN_VENUES_URL,
			issues: z.prettifyError(result.error),
		})
	}
	return result.data
}
