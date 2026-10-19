import {Logger} from "@dvdzkwsk/logger"
import {toIsoOrNull} from "@dvdzkwsk/util/DateUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {JobHealth, JobStatus} from "../shared/ApiJson.js"
import {MINUTE_MS} from "../shared/LeagueTime.js"

const logger = new Logger("Jobs")

/**
 * How late a job can be, past its next run or its timeout, before it counts
 * as stalled (a busy event loop runs timers a little late)
 */
const STALL_GRACE_MS = MINUTE_MS

export interface JobDefinition {
	id: string
	name: string
	description: string
	/**
	 * One run. Returns how long until the next one, in ms. `signal` aborts
	 * when the run times out or the runner stops.
	 */
	run: (signal: AbortSignal) => Promise<number>
	/** A run longer than this is aborted, and fails */
	timeoutMs: number
	/** How long after a failed run the next one starts */
	retryMs: number
}

interface Job {
	definition: JobDefinition
	/** The run in flight, if any */
	running: {
		startedAt: number
		controller: AbortController
		done: Promise<void>
	} | null
	timer: ReturnType<typeof setTimeout> | null
	nextRunAt: number | null
	runs: number
	lastStartedAt: number | null
	lastFinishedAt: number | null
	lastDurationMs: number | null
	lastError: string | null
	consecutiveFailures: number
}

/**
 * Runs the server's background jobs, so none of them is a bare timer or
 * loop: each run's start, end, duration, and error are recorded for the
 * status page, failures are logged, runs of a job never overlap, and
 * `stop` ends them all on shutdown.
 */
export class JobRunner {
	private jobs = new Map<string, Job>()
	private started = false

	/** Adds a job; it starts with the runner, or now if that's started */
	register(definition: JobDefinition) {
		if (this.jobs.has(definition.id)) {
			throw logger.newError("register", "job registered twice", {
				id: definition.id,
			})
		}
		const job: Job = {
			definition,
			running: null,
			timer: null,
			nextRunAt: null,
			runs: 0,
			lastStartedAt: null,
			lastFinishedAt: null,
			lastDurationMs: null,
			lastError: null,
			consecutiveFailures: 0,
		}
		this.jobs.set(definition.id, job)
		if (this.started) {
			this.schedule(job, 0)
		}
	}

	/** Runs every job now, and each again when its run says */
	start() {
		this.started = true
		for (const job of this.jobs.values()) {
			this.schedule(job, 0)
		}
	}

	/**
	 * Cancels every scheduled run and aborts those in flight, waiting up to
	 * `waitMs` for them to finish
	 */
	async stop(waitMs: number) {
		this.started = false
		const inFlight: Promise<void>[] = []
		for (const job of this.jobs.values()) {
			if (job.timer) {
				clearTimeout(job.timer)
				job.timer = null
			}
			job.nextRunAt = null
			if (job.running) {
				job.running.controller.abort(
					new Error("the server is stopping"),
				)
				inFlight.push(job.running.done)
			}
		}
		let timer: ReturnType<typeof setTimeout> | undefined
		const waited = await Promise.race([
			Promise.all(inFlight).then(() => true),
			new Promise<false>((resolve) => {
				timer = setTimeout(() => resolve(false), waitMs)
			}),
		])
		clearTimeout(timer)
		if (!waited) {
			logger.warn("stop", "jobs still running after being stopped", {
				waitMs,
				ids: this.getStatuses()
					.filter((s) => s.running)
					.map((s) => s.id),
			})
		}
	}

	/** Every job's state, in the order they were registered */
	getStatuses(now = Date.now()): JobStatus[] {
		return [...this.jobs.values()].map((job) => ({
			id: job.definition.id,
			name: job.definition.name,
			description: job.definition.description,
			health: getHealth(job, now),
			running: job.running !== null,
			runs: job.runs,
			lastStartedAt: toIsoOrNull(job.lastStartedAt),
			lastFinishedAt: toIsoOrNull(job.lastFinishedAt),
			lastDurationMs: job.lastDurationMs,
			lastError: job.lastError,
			consecutiveFailures: job.consecutiveFailures,
			nextRunAt: toIsoOrNull(job.nextRunAt),
		}))
	}

	private schedule(job: Job, delayMs: number) {
		job.nextRunAt = Date.now() + delayMs
		job.timer = setTimeout(() => {
			job.timer = null
			job.running = this.runOnce(job)
		}, delayMs)
	}

	private runOnce(job: Job): NonNullable<Job["running"]> {
		const {definition} = job
		const startedAt = Date.now()
		const controller = new AbortController()
		const timeout = setTimeout(
			() =>
				controller.abort(
					new Error(`timed out after ${definition.timeoutMs} ms`),
				),
			definition.timeoutMs,
		)
		job.nextRunAt = null
		job.lastStartedAt = startedAt
		job.runs++
		const done = (async () => {
			let delayMs: number
			try {
				delayMs = await definition.run(controller.signal)
				if (controller.signal.aborted) {
					// Finished, but only after it was told to stop
					throw controller.signal.reason
				}
				job.lastError = null
				job.consecutiveFailures = 0
			} catch (error) {
				const err = toError(error)
				job.lastError = err.message
				job.consecutiveFailures++
				if (this.started) {
					logger.error("run", "background job failed", {
						id: definition.id,
						consecutiveFailures: job.consecutiveFailures,
						error: err,
					})
				} else {
					logger.warn("run", "background job cut short by stop", {
						id: definition.id,
						error: err,
					})
				}
				delayMs = definition.retryMs
			} finally {
				clearTimeout(timeout)
				job.lastFinishedAt = Date.now()
				job.lastDurationMs = job.lastFinishedAt - startedAt
				job.running = null
			}
			if (this.started) {
				this.schedule(job, delayMs)
			}
		})()
		return {startedAt, controller, done}
	}
}

/**
 * Stalled: a run is going well past its timeout (it ignored the abort), or
 * the next run is well overdue
 */
function getHealth(job: Job, now: number): JobHealth {
	const overdueSince = job.running
		? job.running.startedAt + job.definition.timeoutMs
		: job.nextRunAt
	if (overdueSince !== null && now > overdueSince + STALL_GRACE_MS) {
		return "stalled"
	}
	return job.consecutiveFailures > 0 ? "failing" : "ok"
}
