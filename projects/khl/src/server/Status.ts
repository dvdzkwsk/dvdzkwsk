import * as path from "path"
import {Logger} from "@dvdzkwsk/logger"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {getGitRevision} from "@dvdzkwsk/util/GitUtil"
import {KHLDatabase} from "./Database.js"
import {JobDefinition, JobRunner} from "./Jobs.js"
import {LIVEBARN_VENUES_URL} from "./LiveBarn.js"
import {DeployInfo, StatusCheck, StatusResponse} from "../shared/ApiJson.js"
import {STRINGS, URLS} from "../shared/KHLConfig.js"
import {getLeagueDayKey, MINUTE_MS} from "../shared/LeagueTime.js"

const logger = new Logger("Status")

/** How often every component is checked */
const CHECK_INTERVAL_MINUTES = 5
/** How many days of history the status page shows */
const HISTORY_DAYS = 90
/** A check slower than this counts as degraded */
const SLOW_MS = 5_000
/** A check slower than this counts as down */
const TIMEOUT_MS = 15_000

interface Component {
	id: string
	name: string
	description: string
	/** Throws if the component is down */
	check: (signal: AbortSignal) => Promise<void>
}

function getComponents(db: KHLDatabase, jobs: JobRunner): Component[] {
	return [
		{
			id: "app",
			name: `${STRINGS.PRODUCT_NAME} website & API`,
			description: "This site, its server, and its database.",
			check: async () => db.ping(),
		},
		{
			id: "league",
			name: "Kraken Hockey League site",
			description: `${new URL(URLS.KHL).host}, where every schedule, score, and stat comes from.`,
			check: (signal) => checkUrl(URLS.KHL, signal),
		},
		{
			id: "livebarn",
			name: "LiveBarn",
			description: "Where live feeds and replays are linked to.",
			check: (signal) => checkUrl(LIVEBARN_VENUES_URL, signal),
		},
		{
			id: "jobs",
			name: "Background jobs",
			description:
				"Syncing the league from the KHL site, and these checks.",
			check: async () => checkJobs(jobs),
		},
	]
}

/** Throws if any job's last run failed, or it has stalled */
function checkJobs(jobs: JobRunner) {
	const unhealthy = jobs.getStatuses().filter((job) => job.health !== "ok")
	if (unhealthy.length > 0) {
		// The message is what the status page shows, e.g. "League sync stalled"
		const message = unhealthy
			.map((job) => `${job.name} ${job.health}`)
			.join(", ")
		throw logger.newError("checkJobs", message, {
			jobs: unhealthy.map(({id, health, lastError}) => ({
				id,
				health,
				lastError,
			})),
		})
	}
}

/** HEAD, so a check doesn't download the page (LiveBarn's venues are MBs) */
async function checkUrl(url: string, signal: AbortSignal): Promise<void> {
	const response = await fetch(url, {
		method: "HEAD",
		signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
	})
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`)
	}
}

async function runCheck(
	component: Component,
	signal: AbortSignal,
): Promise<StatusCheck> {
	const checkedAt = new Date()
	const start = performance.now()
	try {
		await component.check(signal)
		const latencyMs = Math.round(performance.now() - start)
		return {
			checkedAt: checkedAt.toISOString(),
			status: latencyMs > SLOW_MS ? "degraded" : "operational",
			latencyMs,
			error: latencyMs > SLOW_MS ? "slow to respond" : null,
		}
	} catch (error) {
		const err = toError(error)
		const timedOut = err.name === "TimeoutError"
		logger.warn("runCheck", "status check failed", {
			component: component.id,
			error: err,
		})
		return {
			checkedAt: checkedAt.toISOString(),
			status: "outage",
			latencyMs: null,
			error: timedOut ? "timed out" : err.message,
		}
	}
}

/**
 * Checks every component on start and every few minutes after, recording
 * each result so the status page has history across restarts.
 */
export function createStatusCheckJob(
	db: KHLDatabase,
	jobs: JobRunner,
): JobDefinition {
	const components = getComponents(db, jobs)
	return {
		id: "status-checks",
		name: "Status checks",
		description: `Checks each component above every ${CHECK_INTERVAL_MINUTES} minutes.`,
		// Each check times out on its own well before this
		timeoutMs: 2 * TIMEOUT_MS,
		retryMs: CHECK_INTERVAL_MINUTES * MINUTE_MS,
		run: async (signal) => {
			const results = await Promise.all(
				components.map((component) => runCheck(component, signal)),
			)
			results.forEach((check, i) => {
				db.recordStatusCheck({
					...check,
					component: components[i]!.id,
					day: getLeagueDayKey(new Date(check.checkedAt)),
				})
			})
			db.pruneStatusChecks(getHistoryDays(new Date())[0]!)
			return CHECK_INTERVAL_MINUTES * MINUTE_MS
		},
	}
}

export function getStatus(db: KHLDatabase, jobs: JobRunner): StatusResponse {
	const historyDays = getHistoryDays(new Date())
	const latest = db.getLatestStatusChecks()
	const days = db.getStatusDays(historyDays[0]!)
	return {
		historyDays,
		intervalMinutes: CHECK_INTERVAL_MINUTES,
		components: getComponents(db, jobs).map(({id, name, description}) => ({
			id,
			name,
			description,
			latest: latest.get(id) ?? null,
			days: days.get(id) ?? [],
		})),
		jobs: jobs.getStatuses(),
		deploy: DEPLOY_INFO,
	}
}

/** The last HISTORY_DAYS league-local days, oldest first, ending today */
function getHistoryDays(now: Date): string[] {
	const [y, m, d] = getLeagueDayKey(now).split("-").map(Number) as [
		number,
		number,
		number,
	]
	// Calendar math in UTC, so DST changes can't skip or repeat a day
	return Array.from({length: HISTORY_DAYS}, (_, i) => {
		const date = new Date(Date.UTC(y, m - 1, d - (HISTORY_DAYS - 1 - i)))
		return date.toISOString().slice(0, 10)
	})
}

/**
 * Deploys set KHL_COMMIT_SHA, KHL_COMMIT_DIRTY, and KHL_DEPLOYED_AT (see
 * tools/Build.ts). Without them, e.g. in dev, ask git directly.
 */
function getDeployInfo(): DeployInfo {
	const startedAt = new Date().toISOString()
	const deployedAt = process.env.KHL_DEPLOYED_AT || null
	if (process.env.KHL_COMMIT_SHA) {
		return {
			commit: process.env.KHL_COMMIT_SHA,
			dirty: process.env.KHL_COMMIT_DIRTY === "true",
			deployedAt,
			startedAt,
		}
	}
	const projectDir = path.join(import.meta.dirname, "../..")
	const revision = getGitRevision(projectDir, [".", "../../pkg"])
	return {
		commit: revision?.commit ?? null,
		dirty: revision?.dirty ?? false,
		deployedAt,
		startedAt,
	}
}

export const DEPLOY_INFO = getDeployInfo()
