import {z} from "zod"
import {matchFn} from "./MatchUtil.js"

export type HttpMethodWithoutBody = "GET" | "DELETE"
export type HttpMethodWithBody = "POST" | "PUT" | "PATCH"
export type HttpMethod = HttpMethodWithoutBody | HttpMethodWithBody

export type ResponseFormat = "json" | "text"

interface FetchRequestBase<TResponseBody> {
	url: string
	headers?: Record<string, string>
	/** How to read the response body before validating it. Defaults to "json". */
	responseFormat?: ResponseFormat
	responseSchema: z.ZodType<TResponseBody>
	/** Let the request outlive the page, e.g. to flush logs on unload */
	keepalive?: boolean
}

export interface FetchRequestWithoutBody<
	TResponseBody,
> extends FetchRequestBase<TResponseBody> {
	method: HttpMethodWithoutBody
	requestBody?: never
	requestSchema?: never
}

export interface FetchRequestWithBody<
	TRequestBody,
	TResponseBody,
> extends FetchRequestBase<TResponseBody> {
	method: HttpMethodWithBody
	requestBody: TRequestBody
	requestSchema: z.ZodType<TRequestBody>
}

export type FetchRequest<TRequestBody, TResponseBody> =
	| FetchRequestWithoutBody<TResponseBody>
	| FetchRequestWithBody<TRequestBody, TResponseBody>

/**
 * A request that failed to complete or returned a non-2xx status. `status` is
 * null when the server couldn't be reached at all.
 */
export class FetchError extends Error {
	constructor(
		message: string,
		public readonly method: HttpMethod,
		public readonly url: string,
		public readonly status: number | null,
		/** The server's own explanation, from an {error: "..."} body */
		public readonly serverMessage: string | null = null,
	) {
		super(message)
		this.name = "FetchError"
	}
}

export async function doFetch<TRequestBody, TResponseBody>(
	request: FetchRequest<TRequestBody, TResponseBody>,
): Promise<TResponseBody> {
	const label = `${request.method} ${request.url}`

	let requestBody: TRequestBody | undefined
	if (request.requestSchema) {
		const requestResult = request.requestSchema.safeParse(
			request.requestBody,
		)
		if (!requestResult.success) {
			throw new Error(
				`${label}: invalid request body\n${z.prettifyError(requestResult.error)}`,
			)
		}
		requestBody = requestResult.data
	}

	const headers: Record<string, string> = {...request.headers}
	if (requestBody !== undefined) {
		headers["Content-Type"] ??= "application/json"
	}

	let response: Response
	try {
		response = await fetch(request.url, {
			method: request.method,
			headers,
			body:
				requestBody === undefined
					? undefined
					: JSON.stringify(requestBody),
			keepalive: request.keepalive,
		})
	} catch (error) {
		throw new FetchError(
			`${label}: network error: ${error instanceof Error ? error.message : String(error)}`,
			request.method,
			request.url,
			null,
		)
	}
	if (!response.ok) {
		throw new FetchError(
			`${label}: request failed: ${response.status} ${response.statusText}`,
			request.method,
			request.url,
			response.status,
			await readServerMessage(response),
		)
	}

	const body: unknown = await matchFn(request.responseFormat ?? "json", {
		json: () => response.json(),
		text: () => response.text(),
	})
	const responseResult = request.responseSchema.safeParse(body)
	if (!responseResult.success) {
		throw new Error(
			`${label}: invalid response body\n${z.prettifyError(responseResult.error)}`,
		)
	}
	return responseResult.data
}

/** The `error` field of a JSON error body, if the server sent one. */
async function readServerMessage(response: Response): Promise<string | null> {
	try {
		const body: unknown = await response.json()
		const parsed = z.object({error: z.string()}).safeParse(body)
		return parsed.success ? parsed.data.error : null
	} catch {
		return null
	}
}
