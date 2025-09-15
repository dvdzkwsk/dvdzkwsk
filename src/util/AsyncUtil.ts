interface MapAsyncOptions {
	concurrency: number
}

// TODO(david): actually limit concurrency
export async function mapAsync<T, R>(
	items: T[],
	mapFn: (item: T) => Promise<R>,
	options: MapAsyncOptions,
) {
	return Promise.all(items.map((item) => mapFn(item)))
}
