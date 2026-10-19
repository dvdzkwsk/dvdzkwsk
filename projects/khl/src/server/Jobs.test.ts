import {sleep} from "@dvdzkwsk/util/AsyncUtil"
import {describe, expect, test} from "bun:test"
import {JobDefinition, JobRunner} from "./Jobs.js"
import {MINUTE_MS} from "../shared/LeagueTime.js"

function job(overrides: Partial<JobDefinition>): JobDefinition {
	return {
		id: "test",
		name: "Test",
		description: "A test job",
		run: async () => 10,
		timeoutMs: 1000,
		retryMs: 10,
		...overrides,
	}
}

describe("JobRunner", () => {
	test("runs a job on start, and again after the delay it returns", async () => {
		const jobs = new JobRunner()
		let runs = 0
		jobs.register(job({run: async () => (++runs === 1 ? 20 : 60_000)}))
		jobs.start()
		await sleep(5)
		expect(runs).toBe(1)
		await sleep(40)
		expect(runs).toBe(2)
		const [status] = jobs.getStatuses()
		expect(status).toMatchObject({runs: 2, running: false, health: "ok"})
		expect(status!.nextRunAt).not.toBeNull()
		await jobs.stop(100)
	})

	test("records a failed run, and retries it after retryMs", async () => {
		const jobs = new JobRunner()
		let runs = 0
		jobs.register(
			job({
				run: async () => {
					if (++runs <= 2) {
						throw new Error(`boom ${runs}`)
					}
					return 60_000
				},
				retryMs: 50,
			}),
		)
		jobs.start()
		await sleep(15)
		expect(jobs.getStatuses()[0]).toMatchObject({
			health: "failing",
			lastError: "boom 1",
			consecutiveFailures: 1,
		})
		await sleep(150)
		expect(jobs.getStatuses()[0]).toMatchObject({
			health: "ok",
			lastError: null,
			consecutiveFailures: 0,
			runs: 3,
		})
		await jobs.stop(100)
	})

	test("never overlaps runs of a job", async () => {
		const jobs = new JobRunner()
		let active = 0
		let maxActive = 0
		jobs.register(
			job({
				run: async () => {
					maxActive = Math.max(maxActive, ++active)
					await sleep(15)
					active--
					return 0
				},
			}),
		)
		jobs.start()
		await sleep(60)
		await jobs.stop(100)
		expect(maxActive).toBe(1)
	})

	test("aborts a run that times out, and counts it as failed", async () => {
		const jobs = new JobRunner()
		jobs.register(
			job({
				timeoutMs: 10,
				run: (signal) =>
					new Promise((_, reject) => {
						signal.addEventListener("abort", () =>
							reject(signal.reason),
						)
					}),
			}),
		)
		jobs.start()
		await sleep(25)
		expect(jobs.getStatuses()[0]).toMatchObject({
			health: "failing",
			lastError: "timed out after 10 ms",
		})
		await jobs.stop(100)
	})

	test("a run that ignores its timeout is stalled", async () => {
		const jobs = new JobRunner()
		let finish = () => {}
		jobs.register(
			job({
				timeoutMs: 10,
				run: () =>
					new Promise((resolve) => {
						finish = () => resolve(60_000)
					}),
			}),
		)
		jobs.start()
		await sleep(5)
		expect(jobs.getStatuses()[0]!.health).toBe("ok")
		expect(jobs.getStatuses(Date.now() + 2 * MINUTE_MS)[0]).toMatchObject({
			health: "stalled",
			running: true,
		})
		finish()
		await jobs.stop(100)
	})

	test("an overdue run is stalled", async () => {
		const jobs = new JobRunner()
		jobs.register(job({run: async () => 60_000}))
		jobs.start()
		await sleep(5)
		expect(jobs.getStatuses(Date.now() + 2 * MINUTE_MS)[0]!.health).toBe(
			"stalled",
		)
		await jobs.stop(100)
	})

	test("stop aborts the run in flight and schedules no more", async () => {
		const jobs = new JobRunner()
		let runs = 0
		let aborted = false
		jobs.register(
			job({
				run: async (signal) => {
					runs++
					await new Promise<void>((resolve) =>
						signal.addEventListener("abort", () => resolve()),
					)
					aborted = true
					return 0
				},
			}),
		)
		jobs.start()
		await sleep(5)
		await jobs.stop(100)
		expect(aborted).toBe(true)
		await sleep(20)
		expect(runs).toBe(1)
		expect(jobs.getStatuses()[0]).toMatchObject({
			running: false,
			nextRunAt: null,
		})
	})

	test("a job can't be registered twice", () => {
		const jobs = new JobRunner()
		jobs.register(job({}))
		expect(() => jobs.register(job({}))).toThrow("job registered twice")
	})
})
