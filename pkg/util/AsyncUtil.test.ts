import {describe, expect, test} from "bun:test"
import {createRateLimiter} from "./AsyncUtil.js"

describe("createRateLimiter", () => {
	test("spaces out starts, in order", async () => {
		const limit = createRateLimiter(20)
		const startedAt: number[] = []
		const begin = Date.now()
		await Promise.all(
			[0, 1, 2, 3].map(() =>
				limit(async () => {
					startedAt.push(Date.now() - begin)
				}),
			),
		)
		expect(startedAt[0]).toBeLessThan(25)
		for (let i = 1; i < startedAt.length; i++) {
			// 50ms apart, give or take a timer's slack
			expect(startedAt[i]! - startedAt[i - 1]!).toBeGreaterThanOrEqual(45)
		}
	})

	test("doesn't wait when the last start was long enough ago", async () => {
		const limit = createRateLimiter(20)
		await limit(async () => {})
		await new Promise((resolve) => setTimeout(resolve, 60))
		const begin = Date.now()
		await limit(async () => {})
		expect(Date.now() - begin).toBeLessThan(25)
	})

	test("passes through the task's result and errors", async () => {
		const limit = createRateLimiter(100)
		expect(await limit(async () => "ok")).toBe("ok")
		expect(
			limit(async () => {
				throw new Error("failed")
			}),
		).rejects.toThrow("failed")
	})
})
