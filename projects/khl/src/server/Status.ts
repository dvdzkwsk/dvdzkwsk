import * as path from "path"
import {Logger} from "@dvdzkwsk/logger"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {getGitRevision} from "@dvdzkwsk/util/GitUtil"
import {DeployInfo, StatusCheck, StatusResponse} from "../shared/ApiJson.js"
import {STRINGS, URLS} from "../shared/KHLConfig.js"
import {getLeagueDayKey, MINUTE_MS} from "../shared/LeagueTime.js"
import {KHLDatabase} from "./Database.js"
import {LIVEBARN_VENUES_URL} from "./LiveBarn.js"

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
	check: () => Promise<void>
}

function getComponents(db: KHLDatabase): Component[] {
	return [
		{
			id: "app",
			name: `${STRINGS.PRODUCT_NAME} website & API`,
			description: "This site, its server and its database.",
			check: async () => db.ping(),
		},
		{
			id: "league",
			name: "Kraken Hockey League site",
			description: `${new URL(URLS.KHL).host}, where every schedule, score and stat comes from.`,
			check: () => checkUrl(URLS.KHL),
		},
		{
			id: "livebarn",
			name: "LiveBarn",
			description: "Where live feeds and replays are linked to.",
			check: () => checkUrl(LIVEBARN_VENUES_URL),
		},
	]
}

/** HEAD, so a check doesn't download the page (LiveBarn's venues are MBs) */
async function checkUrl(url: string): Promise<void> {
	const response = await fetch(url, {
		method: "HEAD",
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`)
	}
}

async function runCheck(component: Component): Promise<StatusCheck> {
	const checkedAt = new Date()
	const start = performance.now()
	try {
		await component.check()
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
 * Checks every component now and every few minutes after, recording each
 * result so the status page has history across restarts.
 */
export function startStatusChecks(db: KHLDatabase) {
	const components = getComponents(db)
	const runAll = async () => {
		const results = await Promise.all(components.map(runCheck))
		results.forEach((check, i) => {
			db.recordStatusCheck({
				...check,
				component: components[i]!.id,
				day: getLeagueDayKey(new Date(check.checkedAt)),
			})
		})
		db.pruneStatusChecks(getHistoryDays(new Date())[0]!)
	}
	const tick = () => {
		runAll().catch((error) => {
			logger.error("startStatusChecks", "status checks failed", {
				error: toError(error),
			})
		})
	}
	tick()
	setInterval(tick, CHECK_INTERVAL_MINUTES * MINUTE_MS)
}

export function getStatus(db: KHLDatabase): StatusResponse {
	const historyDays = getHistoryDays(new Date())
	const latest = db.getLatestStatusChecks()
	const days = db.getStatusDays(historyDays[0]!)
	return {
		historyDays,
		intervalMinutes: CHECK_INTERVAL_MINUTES,
		components: getComponents(db).map(({id, name, description}) => ({
			id,
			name,
			description,
			latest: latest.get(id) ?? null,
			days: days.get(id) ?? [],
		})),
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
 * Deploys set KHL_COMMIT_SHA, KHL_COMMIT_DIRTY and KHL_DEPLOYED_AT (see
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
