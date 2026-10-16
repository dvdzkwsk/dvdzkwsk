import {z} from "zod"
import {doFetch, HttpMethod, HttpMethodWithoutBody} from "./FetchUtil.js"
import {matchValue} from "./MatchUtil.js"

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
	/** A short title for API docs, e.g. "Get a player" */
	name: string
	/** What the endpoint returns and when to use it, for API docs */
	description: string
	/** A request that works against the live site, for API docs examples */
	/** NoInfer: TRequest comes from requestSchema, not this one literal */
	exampleRequest: NoInfer<TRequest>
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
	const {url, body} = toHttpRequest(endpoint, parsed.data)
	if (isMethodWithoutBody(endpoint.method)) {
		return doFetch({
			method: endpoint.method,
			url,
			responseSchema: endpoint.responseSchema,
			keepalive: options.keepalive,
		})
	}
	return doFetch({
		method: endpoint.method,
		url,
		requestBody: body ?? {},
		requestSchema: z.record(z.string(), z.unknown()),
		responseSchema: endpoint.responseSchema,
		keepalive: options.keepalive,
	})
}

/**
 * Where an already-validated `request` goes: the path with its query string,
 * and the JSON body for POST/PUT/PATCH (null for GET/DELETE).
 */
export function toHttpRequest<TRequest extends ApiRequest, TResponse>(
	endpoint: ApiEndpoint<TRequest, TResponse>,
	request: TRequest,
): {url: string; body: Record<string, unknown> | null} {
	const {path, rest} = fillPathParams(endpoint.uri, request)
	if (!isMethodWithoutBody(endpoint.method)) {
		return {url: path, body: rest}
	}
	const query = new URLSearchParams()
	for (const [key, value] of Object.entries(rest)) {
		if (value !== undefined && value !== null) {
			query.set(key, String(value))
		}
	}
	const search = query.size > 0 ? `?${query}` : ""
	return {url: path + search, body: null}
}

/** GET and DELETE send their fields in the query string rather than a JSON body. */
export function isMethodWithoutBody(
	method: HttpMethod,
): method is HttpMethodWithoutBody {
	return matchValue(method, {
		GET: true,
		DELETE: true,
		POST: false,
		PUT: false,
		PATCH: false,
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
