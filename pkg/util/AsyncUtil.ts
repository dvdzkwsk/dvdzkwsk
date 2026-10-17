interface MapAsyncOptions {
	concurrency: number
}

// TODO(david): actually limit concurrency
export async function mapAsync<T, R>(
	items: T[],
	mapFn: (item: T) => Promise<R>,
	_options: MapAsyncOptions,
) {
	return Promise.all(items.map((item) => mapFn(item)))
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Returns a function that runs tasks with at most `concurrency` in flight,
 * queueing the rest in order.
 */
export function createConcurrencyLimiter(concurrency: number) {
	let active = 0
	const queue: (() => void)[] = []

	return async function limit<T>(task: () => Promise<T>): Promise<T> {
		if (active >= concurrency) {
			await new Promise<void>((resolve) => queue.push(resolve))
		}
		active++
		try {
			return await task()
		} finally {
			active--
			queue.shift()?.()
		}
	}
}
