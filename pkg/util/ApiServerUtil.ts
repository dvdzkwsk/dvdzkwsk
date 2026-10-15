import type {Express} from "express"
import {z} from "zod"
import {ApiEndpoint, ApiRequest} from "./ApiUtil.js"

/** Throw from a handler to respond with a specific status, e.g. 404. */
export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message)
	}
}

/**
 * Serves `endpoint` with `handler`. The request (path params plus query string
 * or JSON body) is validated against the endpoint's request schema, and the
 * handler's result against its response schema before it's sent.
 */
export function registerEndpoint<TRequest extends ApiRequest, TResponse>(
	app: Express,
	endpoint: ApiEndpoint<TRequest, TResponse>,
	handler: (request: TRequest) => Promise<TResponse>,
) {
	const method = endpoint.method.toLowerCase() as Lowercase<
		ApiEndpoint<TRequest, TResponse>["method"]
	>
	app[method](endpoint.uri, async (req, res) => {
		const input = {
			...(endpoint.method === "GET" || endpoint.method === "DELETE"
				? req.query
				: req.body),
			...req.params,
		}
		const request = endpoint.requestSchema.safeParse(input)
		if (!request.success) {
			res.status(400).json({error: z.prettifyError(request.error)})
			return
		}

		let result: TResponse
		try {
			result = await handler(request.data)
		} catch (error) {
			if (error instanceof ApiError) {
				res.status(error.status).json({error: error.message})
				return
			}
			throw error
		}

		const response = endpoint.responseSchema.safeParse(result)
		if (!response.success) {
			throw new Error(
				`${endpoint.method} ${endpoint.uri}: handler returned an invalid response\n${z.prettifyError(response.error)}`,
			)
		}
		res.json(response.data)
	})
}
