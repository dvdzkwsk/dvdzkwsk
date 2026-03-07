export function stripEmptyObjectProperties<T extends object>(obj: T): T {
	const out = Object.create(null) as unknown as T
	for (const key in obj) {
		if (obj[key] != null) {
			out[key] = obj[key]
		}
	}
	return out
}
