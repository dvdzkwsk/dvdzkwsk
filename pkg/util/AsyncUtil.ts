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

/**
 * Returns a function that starts tasks at most `perSecond` times a second,
 * in order, queueing the rest. Only the starts are spaced out, so slow tasks
 * can still overlap.
 */
export function createRateLimiter(perSecond: number) {
	const intervalMs = 1000 / perSecond
	let nextStartAt = 0

	return async function limit<T>(task: () => Promise<T>): Promise<T> {
		const startAt = Math.max(Date.now(), nextStartAt)
		nextStartAt = startAt + intervalMs
		await sleep(startAt - Date.now())
		return task()
	}
}
