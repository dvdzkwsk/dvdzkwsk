import {z} from "zod"

export async function doRequest<T>(
	url: string,
	schema: z.ZodType<T>,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(url, init)
	if (!response.ok) {
		throw new Error(
			`Request failed: ${response.status} ${response.statusText}`,
		)
	}
	const json = await response.json()
	return schema.parse(json)
}
