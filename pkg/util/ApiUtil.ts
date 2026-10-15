import {z} from "zod"
import {doFetch, HttpMethod} from "./FetchUtil.js"

/**
 * Describes an API endpoint once, so the client (doRequest) and the server
 * (registerEndpoint in ApiServerUtil) share the same contract.
 *
 * The request is a flat object. Fields named in `uri` (e.g. ":playerId") fill
 * the path; the rest become the query string for GET/DELETE, or the JSON body
 * for POST/PUT/PATCH.
 */
export interface ApiEndpoint<TRequest extends ApiRequest, TResponse> {
	method: HttpMethod
	/** e.g. "/api/player/:playerId" */
	uri: string
	requestSchema: z.ZodType<TRequest>
	responseSchema: z.ZodType<TResponse>
}

/** Interfaces have no index signature, so this can't be Record<string, unknown> */
export type ApiRequest = object

export interface DoRequestOptions {
	/** Let the request outlive the page, e.g. to flush logs on unload */
	keepalive?: boolean
}

export function doRequest<TRequest extends ApiRequest, TResponse>(
	endpoint: ApiEndpoint<TRequest, TResponse>,
	request: TRequest,
	options: DoRequestOptions = {},
): Promise<TResponse> {
	const parsed = endpoint.requestSchema.safeParse(request)
	if (!parsed.success) {
		throw new Error(
			`${endpoint.method} ${endpoint.uri}: invalid request\n${z.prettifyError(parsed.error)}`,
		)
	}
	const {path, rest} = fillPathParams(endpoint.uri, parsed.data)

	if (endpoint.method === "GET" || endpoint.method === "DELETE") {
		const query = new URLSearchParams()
		for (const [key, value] of Object.entries(rest)) {
			if (value !== undefined && value !== null) {
				query.set(key, String(value))
			}
		}
		const search = query.size > 0 ? `?${query}` : ""
		return doFetch({
			method: endpoint.method,
			url: path + search,
			responseSchema: endpoint.responseSchema,
			keepalive: options.keepalive,
		})
	}
	return doFetch({
		method: endpoint.method,
		url: path,
		requestBody: rest,
		requestSchema: z.record(z.string(), z.unknown()),
		responseSchema: endpoint.responseSchema,
		keepalive: options.keepalive,
	})
}

function fillPathParams(
	uri: string,
	request: ApiRequest,
): {path: string; rest: Record<string, unknown>} {
	const rest: Record<string, unknown> = {...request}
	const path = uri.replace(/:(\w+)/g, (_, name: string) => {
		const value = rest[name]
		delete rest[name]
		if (value === undefined || value === null || value === "") {
			throw new Error(`${uri}: missing path parameter "${name}"`)
		}
		return encodeURIComponent(String(value))
	})
	return {path, rest}
}
