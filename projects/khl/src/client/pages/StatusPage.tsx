import {Logger} from "@dvdzkwsk/logger"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import * as React from "react"
import {
	DeployInfo,
	GET_STATUS_ENDPOINT,
	StatusComponent,
	StatusDay,
	StatusLevel,
	StatusResponse,
} from "../../shared/ApiJson.js"
import {STRINGS, URLS} from "../../shared/KHLConfig.js"
import {MINUTE_MS} from "../../shared/LeagueTime.js"
import {Hint, Link, PageLoader, PageShell} from "../Components.js"
import {formatDayKey} from "../Games.js"
import {formatRelative, Route, useNow} from "../Util.js"

// --- /status: each component's health now and over the last 90 days

const logger = new Logger("StatusPage")

/** How often the page refetches while open */
const REFRESH_MS = MINUTE_MS
/** Days of history shown on narrow screens, where 90 bars don't fit */
const NARROW_DAYS = 30

const LEVEL_LABELS: Record<StatusLevel, string> = {
	operational: "Operational",
	degraded: "Degraded",
	outage: "Outage",
}

const StatusPage = () => {
	const {status, error} = usePolledStatus()
	const now = useNow(15_000)

	return (
		<PageShell>
			<div className="StatusPage">
				<header className="StatusPage-header">
					<h1 className="StatusPage-title">
						{STRINGS.PRODUCT_NAME} status
					</h1>
					<Link
						className="StatusPage-report"
						href={URLS.FEEDBACK_FORM}
					>
						Report a problem ↗
					</Link>
				</header>

				{!status && !error ? (
					<PageLoader label="Checking status…" />
				) : (
					<>
						<OverallBanner
							status={status}
							error={error}
							now={now}
						/>
						{status && (
							<>
								<section className="StatusPage-panel">
									<ul className="StatusPage-components">
										{status.components.map((component) => (
											<ComponentRow
												key={component.id}
												component={component}
												historyDays={status.historyDays}
												now={now}
											/>
										))}
									</ul>
									<Legend />
								</section>
								<DeployPanel deploy={status.deploy} now={now} />
							</>
						)}
					</>
				)}
			</div>
		</PageShell>
	)
}

/**
 * Fetches the status now and every minute after, keeping the last good
 * response on screen. A failed fetch means our own server isn't answering.
 */
function usePolledStatus(): {
	status: StatusResponse | null
	error: Error | null
} {
	const [status, setStatus] = React.useState<StatusResponse | null>(null)
	const [error, setError] = React.useState<Error | null>(null)
	React.useEffect(() => {
		let current = true
		const load = () => {
			doRequest(GET_STATUS_ENDPOINT, {}).then(
				(data) => {
					if (current) {
						setStatus(data)
						setError(null)
					}
				},
				(cause: unknown) => {
					const err = toError(cause)
					logger.warn("load", "couldn't load the status", {
						error: err,
					})
					if (current) {
						setError(err)
					}
				},
			)
		}
		load()
		const id = setInterval(load, REFRESH_MS)
		return () => {
			current = false
			clearInterval(id)
		}
	}, [])
	return {status, error}
}

// --- Overall

const OverallBanner = ({
	status,
	error,
	now,
}: {
	status: StatusResponse | null
	error: Error | null
	now: Date
}) => {
	const {level, title} = getOverall(status, error)
	const lastCheck = status?.components
		.map((c) => c.latest?.checkedAt)
		.filter((t): t is string => !!t)
		.sort()
		.at(-1)
	return (
		<section className={cx("StatusBanner", `StatusBanner--${level}`)}>
			<StatusIcon level={level} size={28} />
			<div>
				<h2 className="StatusBanner-title">{title}</h2>
				<p className="StatusBanner-meta">
					{error
						? status
							? "Below is the last status we could load."
							: "We couldn't reach the server. Try again in a few minutes."
						: status &&
							`Checked every ${status.intervalMinutes} minutes${
								lastCheck
									? ` · last check ${formatRelative(lastCheck, now)}`
									: ""
							}`}
				</p>
			</div>
		</section>
	)
}

function getOverall(
	status: StatusResponse | null,
	error: Error | null,
): {level: StatusLevel; title: string} {
	if (error) {
		return {
			level: "outage",
			title: `${STRINGS.PRODUCT_NAME} isn't responding`,
		}
	}
	const components = status?.components ?? []
	const named = (level: StatusLevel) => {
		const names = components
			.filter((c) => c.latest?.status === level)
			.map((c) => c.name)
		return `${names.join(" and ")} ${names.length === 1 ? "is" : "are"}`
	}
	const level = getWorstLevel(
		components.map((c) => c.latest?.status ?? "operational"),
	)
	switch (level) {
		case "operational":
			return {level, title: "All systems operational"}
		case "degraded":
			return {level, title: `${named("degraded")} slow to respond`}
		case "outage":
			return {level, title: `${named("outage")} down`}
	}
}

const LEVEL_ORDER: StatusLevel[] = ["operational", "degraded", "outage"]

function getWorstLevel(levels: StatusLevel[]): StatusLevel {
	return levels.reduce<StatusLevel>(
		(worst, level) =>
			LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(worst)
				? level
				: worst,
		"operational",
	)
}

// --- Components

const ComponentRow = ({
	component,
	historyDays,
	now,
}: {
	component: StatusComponent
	historyDays: string[]
	now: Date
}) => {
	const {latest} = component
	const daysByKey = new Map(component.days.map((d) => [d.day, d]))
	const uptime = getUptime(component.days)
	return (
		<li className="StatusComponent">
			<div className="StatusComponent-head">
				<div>
					<h3 className="StatusComponent-name">{component.name}</h3>
					<p className="StatusComponent-description">
						{component.description}
					</p>
				</div>
				{latest ? (
					<Hint
						label={`Checked ${formatRelative(latest.checkedAt, now)}${
							latest.error ? ` · ${latest.error}` : ""
						}`}
					>
						<span
							className={cx(
								"StatusPill",
								`StatusPill--${latest.status}`,
							)}
						>
							<StatusIcon level={latest.status} size={14} />
							{LEVEL_LABELS[latest.status]}
							{latest.latencyMs !== null && (
								<span className="StatusPill-latency">
									{latest.latencyMs < 1
										? "<1"
										: latest.latencyMs}{" "}
									ms
								</span>
							)}
						</span>
					</Hint>
				) : (
					<span className="StatusPill">No checks yet</span>
				)}
			</div>
			<div className="UptimeBars" role="list" aria-label="Daily history">
				{historyDays.map((day, i) => (
					<UptimeBar
						key={day}
						day={day}
						data={daysByKey.get(day)}
						early={i < historyDays.length - NARROW_DAYS}
					/>
				))}
			</div>
			<div className="UptimeBars-axis">
				<span>
					<span className="UptimeBars-wide">
						{historyDays.length} days ago
					</span>
					<span className="UptimeBars-narrow">
						{NARROW_DAYS} days ago
					</span>
				</span>
				<span className="UptimeBars-uptime">
					{uptime === null ? "No data yet" : `${uptime} uptime`}
				</span>
				<span>Today</span>
			</div>
		</li>
	)
}

/** "100%" or "99.82%" of checks that got an answer; null without any */
function getUptime(days: StatusDay[]): string | null {
	const checks = days.reduce((n, d) => n + d.checks, 0)
	if (checks === 0) {
		return null
	}
	const up = checks - days.reduce((n, d) => n + d.outages, 0)
	const percent = (up / checks) * 100
	return up === checks ? "100%" : `${Math.min(percent, 99.99).toFixed(2)}%`
}

const UptimeBar = ({
	day,
	data,
	early,
}: {
	day: string
	data: StatusDay | undefined
	/** Hidden on narrow screens */
	early: boolean
}) => {
	const level = data ? getDayLevel(data) : null
	const label = `${formatDayKey(day)} · ${describeDay(data)}`
	return (
		<Hint label={label}>
			<span
				role="listitem"
				aria-label={label}
				className={cx(
					"UptimeBar",
					`UptimeBar--${level ?? "none"}`,
					early && "UptimeBar--early",
				)}
			/>
		</Hint>
	)
}

function getDayLevel(day: StatusDay): StatusLevel {
	if (day.outages > 0) {
		return "outage"
	}
	return day.degraded > 0 ? "degraded" : "operational"
}

function describeDay(day: StatusDay | undefined): string {
	if (!day) {
		return "No data"
	}
	const problems = [
		day.outages > 0 && plural(day.outages, "failed check"),
		day.degraded > 0 && plural(day.degraded, "slow check"),
	].filter(Boolean)
	return problems.length > 0
		? `${problems.join(", ")} of ${day.checks}`
		: `No issues (${plural(day.checks, "check")})`
}

function plural(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`
}

const Legend = () => {
	return (
		<ul className="StatusLegend" aria-label="Legend">
			{LEVEL_ORDER.map((level) => (
				<li key={level}>
					<span className={cx("UptimeBar", `UptimeBar--${level}`)} />
					{LEVEL_LABELS[level]}
				</li>
			))}
			<li>
				<span className={cx("UptimeBar", "UptimeBar--none")} />
				No data
			</li>
		</ul>
	)
}

/** A check, a dash, or a cross in a circle, so status isn't color alone */
const StatusIcon = ({level, size}: {level: StatusLevel; size: number}) => {
	return (
		<svg
			className={cx("StatusIcon", `StatusIcon--${level}`)}
			width={size}
			height={size}
			viewBox="0 0 16 16"
			aria-hidden
		>
			<circle cx="8" cy="8" r="8" />
			{level === "operational" && (
				<path d="M4.75 8.25 7 10.5l4.25-4.75" />
			)}
			{level === "degraded" && <path d="M5 8h6" />}
			{level === "outage" && <path d="m5.5 5.5 5 5m0-5-5 5" />}
		</svg>
	)
}

// --- Deployment

const DeployPanel = ({deploy, now}: {deploy: DeployInfo; now: Date}) => {
	return (
		<section className="StatusPage-panel StatusDeploy">
			<h2 className="SectionLabel">Deployment</h2>
			<dl className="StatusDeploy-list">
				<div>
					<dt>Commit</dt>
					<dd>
						{deploy.commit ? (
							<>
								<Link
									className="StatusDeploy-commit"
									href={`${URLS.GITHUB_REPO}/commit/${deploy.commit}`}
								>
									{deploy.commit.slice(0, 7)} ↗
								</Link>
								{deploy.dirty && (
									<Hint label="Built with changes that weren't committed yet">
										<span className="StatusDeploy-dirty">
											+ uncommitted changes
										</span>
									</Hint>
								)}
							</>
						) : (
							"Unknown"
						)}
					</dd>
				</div>
				<div>
					<dt>Deployed</dt>
					<dd>
						{deploy.deployedAt ? (
							<Hint
								label={new Date(deploy.deployedAt).toString()}
							>
								<span>
									{formatRelative(deploy.deployedAt, now)}
								</span>
							</Hint>
						) : (
							"Local build"
						)}
					</dd>
				</div>
				<div>
					<dt>Server up since</dt>
					<dd>
						<Hint label={new Date(deploy.startedAt).toString()}>
							<span>{formatRelative(deploy.startedAt, now)}</span>
						</Hint>
					</dd>
				</div>
			</dl>
		</section>
	)
}

export const StatusRoute = {
	path: "/status",
	title: "Status",
	description: `Whether ${STRINGS.PRODUCT_NAME} and the sites it depends on are up.`,
	content: StatusPage,
} as const satisfies Route
