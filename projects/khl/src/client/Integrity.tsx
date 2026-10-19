import {Logger} from "@dvdzkwsk/logger"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {createConcurrencyLimiter} from "@dvdzkwsk/util/AsyncUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {matchField} from "@dvdzkwsk/util/MatchUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import * as React from "react"
import {
	AsyncContent,
	ErrorState,
	Hint,
	InlineLoader,
	Link,
	PageTitle,
	TeamAvatar,
} from "./Components.js"
import {
	formatFullGameDate,
	formatGameTime,
	formatRelative,
	getPlayerHref,
	useAsync,
	useNow,
} from "./Util.js"
import {
	CheckCacheResponse,
	CHECK_CACHE_ENDPOINT,
	GET_CACHE_ENTRY_ENDPOINT,
	GET_PLAYER_INTEGRITY_ENDPOINT,
	toRegistrationKey,
	IntegrityCacheEntry,
	IntegrityCacheKind,
	IntegrityRegistration,
	IntegritySource,
	IntegrityUnlinked,
	JsonDifference,
	IntegrityReport,
	RELOAD_PLAYER_INTEGRITY_ENDPOINT,
	RESYNC_PLAYER_ENDPOINT,
} from "../shared/ApiJson.js"

// --- /players/:playerId?integrity: our stored profile against the KHL's pages
//
// For triaging a profile's data: the header says whether anything is wrong
// and holds the fixes that apply to the whole profile; the graph shows every
// KHL page the profile is built from, colored by integrity and marked by cache
// state; the inspector lists the problems, and shows any node's details.

const logger = new Logger("Integrity")

const SOURCE_LABELS: Record<IntegritySource, string> = {
	search: "KHL search",
	profile: "KHL profile",
}

type IntegrityAction = "reload" | "apply"

const ACTIONS: Record<
	IntegrityAction,
	{
		/** Both take the player and return a report */
		endpoint: typeof RESYNC_PLAYER_ENDPOINT
		running: string
		failed: string
	}
> = {
	reload: {
		endpoint: RELOAD_PLAYER_INTEGRITY_ENDPOINT,
		running: "Reloading the KHL's pages…",
		failed: "Couldn't reload the KHL's pages",
	},
	apply: {
		endpoint: RESYNC_PLAYER_ENDPOINT,
		running: "Applying the resync…",
		failed: "Couldn't apply the resync",
	},
}

interface ActionState {
	running: IntegrityAction | null
	failed: {error: Error; action: IntegrityAction} | null
	/** The latest action's report, which replaces the first load's */
	report: IntegrityReport | null
}

/** Our stored profile compared with the KHL's search and player pages */
export const PlayerIntegrityReport = ({playerId}: {playerId: string}) => {
	const state = useAsync(
		() => doRequest(GET_PLAYER_INTEGRITY_ENDPOINT, {playerId}),
		[playerId],
	)
	const [action, setAction] = React.useState<ActionState>({
		running: null,
		failed: null,
		report: null,
	})
	// Kept across reports, so a reload leaves the same node open
	const [selection, setSelection] = React.useState<Selection | null>(null)
	const run = (next: IntegrityAction) => {
		setAction((prev) => ({...prev, running: next, failed: null}))
		doRequest(ACTIONS[next].endpoint, {playerId}).then(
			(report) => setAction({running: null, failed: null, report}),
			(error) => {
				setAction((prev) => ({
					...prev,
					running: null,
					failed: {error: toError(error), action: next},
				}))
			},
		)
	}
	return (
		<AsyncContent
			state={state}
			loadingLabel="Checking this player against the KHL…"
			slowNote="Still working. The report loads the KHL's name search and the KHL player page for each of the profile's registrations."
		>
			{(initial) => {
				const report = action.report ?? initial
				return (
					<div className="Detail">
						<PageTitle>{`${report.name} integrity`}</PageTitle>
						<IntegrityHeader
							report={report}
							action={action}
							onRun={run}
						/>
						{/* Keyed so checks from an older report don't linger */}
						<IntegrityExplorer
							key={report.checkedAt}
							report={report}
							selection={selection}
							onSelect={setSelection}
						/>
					</div>
				)
			}}
		</AsyncContent>
	)
}

/** Who the profile is, whether it matches the KHL, and the profile-wide fixes */
const IntegrityHeader = ({
	report,
	action,
	onRun,
}: {
	report: IntegrityReport
	action: ActionState
	onRun: (action: IntegrityAction) => void
}) => {
	const differences = countDifferences(report)
	const unrecorded = report.unlinked.filter((u) => !u.playerId).length
	const pending = differences + unrecorded
	return (
		<header className="Detail-header Integrity-header">
			<div className="Integrity-heading">
				<p className="SectionLabel">Integrity report</p>
				<div className="Integrity-title">
					<h1 className="Integrity-name">{report.name}</h1>
					{differences === 0 ? (
						<IntegrityBadge tone="ok">
							Matches the KHL
						</IntegrityBadge>
					) : (
						<IntegrityBadge tone="warn">
							{plural(differences, "difference", "differences")}
						</IntegrityBadge>
					)}
				</div>
				<FactList
					layout="inline"
					facts={[
						["KHL+ id", <code>{report.playerId}</code>],
						["Recorded", <TimeAgo at={report.createdAt} />],
						["Checked", <TimeAgo at={report.checkedAt} />],
					]}
				/>
			</div>
			<div className="Integrity-actions">
				<ActionLink href={getPlayerHref(report.playerId)}>
					View profile
				</ActionLink>
				<ActionLink href={report.searchUrl}>KHL search ↗</ActionLink>
				<Hint label="Drops the cached KHL search and player pages and compares again. Stores nothing.">
					<button
						type="button"
						className="FilterPill"
						disabled={!!action.running}
						onClick={() => onRun("reload")}
					>
						Reload from KHL
					</button>
				</Hint>
				{pending > 0 && (
					<Hint label="Stores what the KHL's pages say for every registration below, and records registrations we've never seen.">
						<button
							type="button"
							className="Integrity-apply"
							disabled={!!action.running}
							onClick={() => onRun("apply")}
						>
							Apply resync ({plural(pending, "change", "changes")}
							)
						</button>
					</Hint>
				)}
			</div>
			{(action.running || action.failed) && (
				<div className="Integrity-status">
					{action.running && (
						<InlineLoader
							label={ACTIONS[action.running].running}
							slowNote="Still working. Each KHL page is fetched again."
						/>
					)}
					{action.failed && (
						<ErrorState
							title={ACTIONS[action.failed.action].failed}
							error={action.failed.error}
							onRetry={() => onRun(action.failed!.action)}
							size="inline"
						/>
					)}
				</div>
			)}
		</header>
	)
}

// --- Shared pieces

type BadgeTone = "ok" | "warn" | "error" | "muted"

const IntegrityBadge = ({
	tone,
	children,
}: {
	tone: BadgeTone
	children: React.ReactNode
}) => {
	return (
		<span className={cx("Integrity-badge", `Integrity-badge--${tone}`)}>
			{children}
		</span>
	)
}

/** "5 minutes ago", with the exact time on hover */
const TimeAgo = ({at}: {at: string}) => {
	const now = useNow()
	return (
		<Hint label={`${formatFullGameDate(at)}, ${formatGameTime(at)}`}>
			<time dateTime={at}>{formatRelative(at, now)}</time>
		</Hint>
	)
}

/**
 * The comparison view shared by cached pages and registrations: what
 * differs, by path, then both copies in full side by side
 */
const Comparison = ({
	summary,
	differences,
	oursTitle,
	ours,
	khlTitle,
	khl,
	khlPlaceholder,
	children,
}: {
	/** Shown above the differences, e.g. "Matches the KHL" or an error */
	summary?: React.ReactNode
	/** Null until compared */
	differences: JsonDifference[] | null
	oursTitle: React.ReactNode
	/** Anything JSON can show; null for nothing yet */
	ours: unknown
	khlTitle: React.ReactNode
	khl: unknown
	khlPlaceholder?: string
	/** Between the differences and the copies, e.g. what a resync stores */
	children?: React.ReactNode
}) => {
	return (
		<>
			{summary}
			{differences && differences.length > 0 && (
				<DifferenceTable
					rows={differences}
					headers={["Path", "Ours", "KHL"]}
				/>
			)}
			{children}
			<div className="Integrity-json-panes">
				<JsonPane title={oursTitle} value={ours} />
				<JsonPane
					title={khlTitle}
					value={khl}
					placeholder={khlPlaceholder}
				/>
			</div>
		</>
	)
}

/** Rows of what differs, e.g. a cached page against the KHL's page now */
const DifferenceTable = ({
	rows,
	headers,
}: {
	rows: JsonDifference[]
	headers: [path: string, ours: string, khl: string]
}) => {
	return (
		<div className="Integrity-scroll">
			<table className="Integrity-differences">
				<thead>
					<tr>
						{headers.map((header) => (
							<th key={header} scope="col">
								{header}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.path}>
							<th scope="row">{row.path}</th>
							<td>{row.ours ?? "–"}</td>
							<td className="Integrity-differences-khl">
								{row.khl ?? "–"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

const JsonPane = ({
	title,
	value,
	placeholder,
}: {
	title: React.ReactNode
	/** Shown as JSON; null shows `placeholder` */
	value: unknown
	placeholder?: string
}) => {
	return (
		<figure className="Integrity-json">
			<figcaption className="SectionLabel">{title}</figcaption>
			{value === null ? (
				<p className="Integrity-note">{placeholder}</p>
			) : (
				<pre>{JSON.stringify(value, null, 2)}</pre>
			)}
		</figure>
	)
}

/** A labeled value: ids, times, and counts go here, not into sentences */
type Fact = [label: string, value: React.ReactNode]

/** Labels beside their values (grid), or pairs in a wrapping row (inline) */
const FactList = ({
	facts,
	layout,
}: {
	facts: Fact[]
	layout: "grid" | "inline"
}) => {
	return (
		<dl className={cx("Integrity-facts", `Integrity-facts--${layout}`)}>
			{facts.map(([label, value]) => (
				<div key={label}>
					<dt>{label}</dt>
					<dd>{value}</dd>
				</div>
			))}
		</dl>
	)
}

/** What failed and what that means, with the error message labeled below */
const ErrorNote = ({summary, error}: {summary: string; error: string}) => {
	return (
		<div className="Integrity-error">
			<p>{summary}</p>
			<FactList facts={[["Error", error]]} layout="inline" />
		</div>
	)
}

// --- What each node is, and its state

const CACHE_KINDS: Record<IntegrityCacheKind, {label: string; shared: string}> =
	{
		search: {
			label: "Name search",
			shared: "The KHL's all-seasons search for a name. Shared by every KHL+ profile with that name.",
		},
		profile: {
			label: "Player page",
			shared: "A KHL registration's player page. Shared by every KHL+ profile with that registration.",
		},
		schedule: {
			label: "Schedule",
			shared: "A team's schedule for a season. Shared by every player on the team and the team's own page.",
		},
	}

/** A node's kind, as its chip shows it */
type NodeKind = IntegrityCacheKind | "registration" | "unlinked"

/** Each kind's chip, and what it is, in the order the graph hangs them */
const NODE_KINDS: Record<NodeKind, {label: string; description: string}> = {
	search: {
		label: CACHE_KINDS.search.label,
		description:
			"The KHL's all-seasons search for the profile's name. It lists every registration under that name, so it's where the profile's registrations are found.",
	},
	registration: {
		label: "Registration",
		description:
			"One KHL player id on one team, as we've stored it. It's compared with its rows in the name search and with its player page.",
	},
	profile: {
		label: CACHE_KINDS.profile.label,
		description:
			"A registration's page on the KHL, for its latest season: the name, position, and team the KHL has for it.",
	},
	schedule: {
		label: CACHE_KINDS.schedule.label,
		description:
			"A team's games for one season. The profile's game list is built from one per season the player was on the team.",
	},
	unlinked: {
		label: "Same name",
		description:
			"A registration in the name search that isn't on this profile: it's on another KHL+ profile, or we've never recorded it.",
	},
}

/** A node's kind, with what it is on hover */
const KindChip = ({kind}: {kind: NodeKind}) => {
	return (
		<Hint label={NODE_KINDS[kind].description}>
			<span className={cx("Integrity-kind", `Integrity-kind--${kind}`)}>
				{NODE_KINDS[kind].label}
			</span>
		</Hint>
	)
}

/** Whether we hold a page, as of when the report began */
type CacheState = "cached" | "expired" | "not-cached" | "failed"

const CACHE_STATES: Record<CacheState, {label: string; detail: string}> = {
	cached: {label: "Cached", detail: "We hold a copy of the KHL's page."},
	expired: {
		label: "Cache expired",
		detail: "Our copy expired; the next view loads the page again.",
	},
	"not-cached": {
		label: "Not cached",
		detail: "We hold no copy; the next view loads the page.",
	},
	failed: {label: "Didn't load", detail: "The KHL's page failed to load."},
}

function getCacheState(
	entry: IntegrityCacheEntry | undefined,
	error: string | null,
	checkedAt: string,
	check: CacheCheckState | undefined,
): CacheState {
	if (error) {
		return "failed"
	}
	if (!entry?.cachedAt || check?.status === "not-cached") {
		return "not-cached"
	}
	return entry.expiresAt && entry.expiresAt <= checkedAt
		? "expired"
		: "cached"
}

/** ● cached, ◐ expired, ○ not cached, ✕ didn't load */
const CacheGlyph = ({state}: {state: CacheState}) => {
	return (
		<span
			className={cx("Integrity-cache", `Integrity-cache--${state}`)}
			aria-hidden
		>
			{state === "failed" ? "✕" : null}
		</span>
	)
}

/** Whether a node agrees with the KHL, as far as anything has compared it */
type Integrity = "matches" | "differs" | "failed" | "unchecked" | "checking"

interface IntegrityStatus {
	integrity: Integrity
	label: string
	/** Beside a season: ✓, the number of differences, or ! */
	mark: string | null
}

const INTEGRITY_TONES: Record<Integrity, BadgeTone> = {
	matches: "ok",
	differs: "warn",
	failed: "error",
	unchecked: "muted",
	checking: "muted",
}

function getPageIntegrity(check: CacheCheckState | undefined): IntegrityStatus {
	if (!check) {
		return {integrity: "unchecked", label: "Not checked", mark: null}
	}
	return matchField(check, "status", {
		checking: (): IntegrityStatus => {
			return {integrity: "checking", label: "Checking…", mark: "…"}
		},
		error: (): IntegrityStatus => {
			return {integrity: "failed", label: "Check failed", mark: "!"}
		},
		failed: (): IntegrityStatus => {
			return {integrity: "failed", label: "KHL page failed", mark: "!"}
		},
		"not-cached": (): IntegrityStatus => {
			return {
				integrity: "unchecked",
				label: "Nothing cached to check",
				mark: null,
			}
		},
		match: (): IntegrityStatus => {
			return {integrity: "matches", label: "Matches the KHL", mark: "✓"}
		},
		differs: (c): IntegrityStatus => {
			return {
				integrity: "differs",
				label: `Stale: ${plural(c.differenceCount, "difference", "differences")}`,
				mark: String(c.differenceCount),
			}
		},
	})
}

function getRegistrationIntegrity(r: IntegrityRegistration): IntegrityStatus {
	if (r.differences.length > 0) {
		return {
			integrity: "differs",
			label: plural(r.differences.length, "difference", "differences"),
			mark: null,
		}
	}
	if (r.profileError) {
		return {integrity: "failed", label: "Player page failed", mark: null}
	}
	return {integrity: "matches", label: "Matches the KHL", mark: null}
}

function getUnlinkedIntegrity(u: IntegrityUnlinked): IntegrityStatus {
	return u.playerId
		? {integrity: "unchecked", label: "On another profile", mark: null}
		: {integrity: "differs", label: "Not recorded", mark: null}
}

// --- Cache checks

type CacheCheckState =
	{status: "checking"} | {status: "error"; error: Error} | CheckCacheResponse

/** At most this many checks at once, so "Check all" doesn't burst the KHL */
const limitChecks = createConcurrencyLimiter(2)

interface CacheChecks {
	checks: Map<string, CacheCheckState>
	check: (key: string) => Promise<void>
}

/** Cache checks run from the graph or the inspector, shared by both */
function useCacheChecks(): CacheChecks {
	const [checks, setChecks] = React.useState<Map<string, CacheCheckState>>(
		new Map(),
	)
	const setCheck = (key: string, check: CacheCheckState) => {
		setChecks((prev) => new Map(prev).set(key, check))
	}
	const check = (key: string) => {
		setCheck(key, {status: "checking"})
		return limitChecks(() => doRequest(CHECK_CACHE_ENDPOINT, {key})).then(
			(result) => setCheck(key, result),
			(cause) => {
				const error = toError(cause)
				logger.error("check", "cache check failed", {key, error})
				setCheck(key, {status: "error", error})
			},
		)
	}
	return {checks, check}
}

// --- The report's nodes, flattened for lookups

/** One KHL page under a registration */
interface PageNode {
	kind: "profile" | "schedule"
	key: string
	entry: IntegrityCacheEntry | undefined
	seasonId: string
	registration: IntegrityRegistration
	/** The page failed when the report loaded it */
	error: string | null
}

function getPageNodes(
	r: IntegrityRegistration,
	entries: Map<string, IntegrityCacheEntry>,
): PageNode[] {
	const profile: PageNode[] = r.cacheKeys.profile
		? [
				{
					kind: "profile",
					key: r.cacheKeys.profile,
					entry: entries.get(r.cacheKeys.profile),
					seasonId: r.seasonIds.at(-1)!,
					registration: r,
					error: r.profileError,
				},
			]
		: []
	const schedules = r.cacheKeys.schedules.map((key, i): PageNode => {
		return {
			kind: "schedule",
			key,
			entry: entries.get(key),
			seasonId: r.seasonIds[i]!,
			registration: r,
			error: null,
		}
	})
	return [...profile, ...schedules]
}

/** What the inspector shows; null shows the triage list */
type Selection =
	| {kind: "search"}
	| {kind: "registration"; key: string}
	| {kind: "page"; key: string}
	| {kind: "unlinked"; key: string}

function getSelectionId(s: Selection): string {
	return matchField(s, "kind", {
		search: () => "search",
		registration: (r) => `registration:${r.key}`,
		page: (p) => `page:${p.key}`,
		unlinked: (u) => `unlinked:${u.key}`,
	})
}

/** Everything the graph and inspector read, derived once per render */
interface ReportModel {
	report: IntegrityReport
	checks: CacheChecks
	search: IntegrityCacheEntry | undefined
	pages: Map<string, PageNode>
	pagesByRegistration: Map<string, PageNode[]>
}

function useReportModel(
	report: IntegrityReport,
	checks: CacheChecks,
): ReportModel {
	const entries = new Map(report.cache.map((e) => [e.key, e]))
	const pagesByRegistration = new Map(
		report.registrations.map((r) => {
			return [toRegistrationKey(r), getPageNodes(r, entries)]
		}),
	)
	return {
		report,
		checks,
		search: report.cache.find((e) => e.kind === "search"),
		pages: new Map(
			[...pagesByRegistration.values()].flat().map((p) => [p.key, p]),
		),
		pagesByRegistration,
	}
}

function getPageStatus(model: ReportModel, page: PageNode) {
	const check = model.checks.checks.get(page.key)
	return {
		cache: getCacheState(
			page.entry,
			page.error,
			model.report.checkedAt,
			check,
		),
		integrity: getPageIntegrity(check),
	}
}

function getSearchStatus(model: ReportModel, search: IntegrityCacheEntry) {
	const check = model.checks.checks.get(search.key)
	return {
		cache: getCacheState(
			search,
			model.report.searchError,
			model.report.checkedAt,
			check,
		),
		integrity: getPageIntegrity(check),
	}
}

// --- Triage: what's wrong, worst first

type Severity = "error" | "warn" | "info"

interface Problem {
	id: string
	severity: Severity
	/** What's wrong, in words; what it's about goes in `facts` */
	title: string
	facts: Fact[]
	/** The KHL's or the check's error message */
	error: string | null
	/** What fixes it */
	fix: string
	selection: Selection
}

const SEVERITY_ORDER: Severity[] = ["error", "warn", "info"]

function getRegistrationFacts(
	r: Pick<IntegrityRegistration, "teamName" | "khlPlayerId">,
): Fact[] {
	return [
		["Team", r.teamName],
		["KHL id", <code>{r.khlPlayerId}</code>],
	]
}

function getProblems(model: ReportModel): Problem[] {
	const {report} = model
	const problems: Problem[] = []
	if (report.searchError) {
		problems.push({
			id: "search",
			severity: "error",
			title: "The KHL name search failed",
			facts: [["Search", model.search?.label ?? report.name]],
			error: report.searchError,
			fix: "Nothing was compared with the search. Reload from KHL to retry.",
			selection: {kind: "search"},
		})
	}
	for (const r of report.registrations) {
		const key = toRegistrationKey(r)
		if (r.differences.length > 0) {
			const fields = [
				...new Set(
					r.differences.map((d) => {
						const field = d.path.split(/[.[ ]/)[0]!
						return RECORD_FIELD_LABELS[field] ?? field
					}),
				),
			]
			const list = fields.join(", ")
			problems.push({
				id: `differs:${key}`,
				severity: "warn",
				title: `${list[0]!.toUpperCase()}${list.slice(1)} ${fields.length === 1 ? "differs" : "differ"} from the KHL`,
				facts: [
					...getRegistrationFacts(r),
					["Differences", r.differences.length],
				],
				error: null,
				fix: "Applying the resync stores what the KHL's pages say.",
				selection: {kind: "registration", key},
			})
		}
		if (r.profileError && r.cacheKeys.profile) {
			problems.push({
				id: `profile:${key}`,
				severity: "error",
				title: "Player page didn't load",
				facts: [
					...getRegistrationFacts(r),
					["Season", r.seasonIds.at(-1)],
				],
				error: r.profileError,
				fix: "Nothing was compared with it. Reload from KHL to retry; old KHL pages often fail for good.",
				selection: {kind: "page", key: r.cacheKeys.profile},
			})
		}
	}
	for (const u of report.unlinked) {
		const key = toRegistrationKey(u)
		const facts: Fact[] = [
			...getRegistrationFacts(u),
			["Seasons", formatSeasonIds(u.seasonIds) ?? "none"],
		]
		problems.push(
			u.playerId
				? {
						id: `unlinked:${key}`,
						severity: "info",
						title: "Same name, on another KHL+ profile",
						facts,
						error: null,
						fix: "A namesake split off by hand, or the same person split in two. If it's this person, the profiles need merging by hand.",
						selection: {kind: "unlinked", key},
					}
				: {
						id: `unlinked:${key}`,
						severity: "warn",
						title: "In the KHL's search, never recorded",
						facts,
						error: null,
						fix: "Applying the resync records it on a profile matched by name.",
						selection: {kind: "unlinked", key},
					},
		)
	}
	const pages: {key: string; selection: Selection; facts: Fact[]}[] = [
		...(model.search
			? [
					{
						key: model.search.key,
						selection: {kind: "search"} as const,
						facts: [
							["Page", CACHE_KINDS.search.label],
						] satisfies Fact[],
					},
				]
			: []),
		...[...model.pages.values()].map((p) => {
			return {
				key: p.key,
				selection: {kind: "page", key: p.key} as const,
				facts: [
					["Page", CACHE_KINDS[p.kind].label],
					["Team", p.registration.teamName],
					["Season", p.seasonId],
				] satisfies Fact[],
			}
		}),
	]
	for (const {key, selection, facts} of pages) {
		const check = model.checks.checks.get(key)
		const failed = (error: string): Problem => ({
			id: `check:${key}`,
			severity: "error",
			title: "Check failed",
			facts,
			error,
			fix: "Check it again.",
			selection,
		})
		const problem =
			check &&
			matchField(check, "status", {
				checking: () => null,
				"not-cached": () => null,
				match: () => null,
				differs: (c): Problem => ({
					id: `stale:${key}`,
					severity: "warn",
					title: "Cached copy is stale",
					facts: [...facts, ["Differences", c.differenceCount]],
					error: null,
					fix: "Our copy differs from the KHL's page now. Reload from KHL to drop it, or wait for it to expire.",
					selection,
				}),
				failed: (c) => failed(c.error ?? "The KHL's page didn't load."),
				error: (c) => failed(c.error.message),
			})
		if (problem) {
			problems.push(problem)
		}
	}
	return problems.sort((a, b) => {
		return (
			SEVERITY_ORDER.indexOf(a.severity) -
			SEVERITY_ORDER.indexOf(b.severity)
		)
	})
}

// --- The graph and the inspector

const IntegrityExplorer = ({
	report,
	selection,
	onSelect,
}: {
	report: IntegrityReport
	selection: Selection | null
	onSelect: (selection: Selection | null) => void
}) => {
	const checks = useCacheChecks()
	const model = useReportModel(report, checks)
	const problems = getProblems(model)
	const inspectorRef = React.useRef<HTMLElement>(null)
	const select = (next: Selection | null) => {
		onSelect(next)
		// Stacked below the graph on narrow screens, so bring it into view
		if (window.matchMedia("(max-width: 1000px)").matches) {
			inspectorRef.current?.scrollIntoView({block: "start"})
		}
	}
	return (
		<div className="IntegrityExplorer">
			<IntegrityGraph
				model={model}
				problems={problems}
				selection={selection}
				onSelect={select}
			/>
			<aside
				ref={inspectorRef}
				className="Detail-panel IntegrityInspector"
			>
				<IntegrityInspector
					model={model}
					problems={problems}
					selection={selection}
					onSelect={select}
				/>
			</aside>
		</div>
	)
}

const IntegrityGraph = ({
	model,
	problems,
	selection,
	onSelect,
}: {
	model: ReportModel
	problems: Problem[]
	selection: Selection | null
	onSelect: (selection: Selection) => void
}) => {
	const {report, checks, search} = model
	const [problemsOnly, setProblemsOnly] = React.useState(false)
	const [highlight, setHighlight] = React.useState<Highlight>({
		integrity: [],
		cache: [],
	})
	const selectedId = selection && getSelectionId(selection)
	const nodeProps = (s: Selection) => ({
		selected: selectedId === getSelectionId(s),
		onSelect: () => onSelect(s),
		highlight,
	})
	const problemIds = new Set(problems.map((p) => getSelectionId(p.selection)))
	const hasProblem = (r: IntegrityRegistration) => {
		const key = toRegistrationKey(r)
		return (
			problemIds.has(getSelectionId({kind: "registration", key})) ||
			model.pagesByRegistration
				.get(key)!
				.some((p) =>
					problemIds.has(getSelectionId({kind: "page", key: p.key})),
				)
		)
	}
	const registrations = problemsOnly
		? report.registrations.filter(hasProblem)
		: report.registrations
	const hidden = report.registrations.length - registrations.length
	const checkable = [search, ...[...model.pages.values()].map((p) => p.entry)]
		.filter((e): e is IntegrityCacheEntry => !!e?.cachedAt)
		.filter((e) => checks.checks.get(e.key)?.status !== "checking")
	return (
		<section className="Detail-panel IntegrityGraph">
			<div className="Integrity-panel-header">
				<h2 className="SectionLabel Detail-panel-title">
					KHL pages behind this profile
				</h2>
				<div className="Integrity-actions">
					<label className="IntegrityGraph-toggle">
						<input
							type="checkbox"
							checked={problemsOnly}
							onChange={(e) => setProblemsOnly(e.target.checked)}
						/>
						Problems only
					</label>
					<Hint label="Loads each cached page from the KHL again and compares it with our copy. Stores nothing.">
						<button
							type="button"
							className="FilterPill"
							disabled={checkable.length === 0}
							onClick={() => {
								for (const entry of checkable) {
									void checks.check(entry.key)
								}
							}}
						>
							Check all cached pages
						</button>
					</Hint>
				</div>
			</div>
			<IntegrityLegend
				nodes={getNodeStates(model)}
				highlight={highlight}
				onChange={setHighlight}
			/>
			<div className="IntegrityGraph-scroll">
				{search && (
					<SearchNode
						model={model}
						search={search}
						{...nodeProps({kind: "search"})}
					/>
				)}
				<ul className="IntegrityGraph-tree">
					{registrations.map((r) => {
						const key = toRegistrationKey(r)
						const pages = model.pagesByRegistration.get(key)!
						const profile = pages.find((p) => p.kind === "profile")
						const schedules = pages.filter(
							(p) => p.kind === "schedule",
						)
						return (
							<li
								key={key}
								className="IntegrityGraph-item IntegrityGraph-item--card"
							>
								<GraphCard
									kind="registration"
									title={
										<TeamLabel
											name={r.teamName}
											logoUrl={r.teamLogoUrl}
										/>
									}
									meta={`KHL id ${r.khlPlayerId} · ${plural(r.seasonIds.length, "season", "seasons")}`}
									status={getRegistrationIntegrity(r)}
									cache={null}
									{...nodeProps({kind: "registration", key})}
								/>
								<ul className="IntegrityGraph-tree">
									{profile && (
										<li className="IntegrityGraph-item IntegrityGraph-item--tile">
											<PageTile
												model={model}
												page={profile}
												label={`Player page · season ${profile.seasonId}`}
												{...nodeProps({
													kind: "page",
													key: profile.key,
												})}
											/>
										</li>
									)}
									{schedules.length > 0 && (
										<li className="IntegrityGraph-item IntegrityGraph-item--tile">
											<div className="IntegrityGraph-seasons">
												<span className="IntegrityGraph-seasons-label">
													Schedules
												</span>
												{schedules.map((p) => (
													<PageTile
														key={p.key}
														model={model}
														page={p}
														label={p.seasonId}
														{...nodeProps({
															kind: "page",
															key: p.key,
														})}
													/>
												))}
											</div>
										</li>
									)}
								</ul>
							</li>
						)
					})}
					{hidden > 0 && (
						<li className="IntegrityGraph-item IntegrityGraph-item--tile">
							<button
								type="button"
								className="Integrity-text-button"
								onClick={() => setProblemsOnly(false)}
							>
								{plural(
									hidden,
									"registration",
									"registrations",
								)}{" "}
								with no problems hidden
							</button>
						</li>
					)}
					{!report.searchError && report.unlinked.length > 0 && (
						<li className="IntegrityGraph-item IntegrityGraph-item--card">
							<p className="IntegrityGraph-group">
								Also in the search, not on this profile
							</p>
							<ul className="IntegrityGraph-tree">
								{report.unlinked.map((u) => {
									const key = toRegistrationKey(u)
									return (
										<li
											key={key}
											className="IntegrityGraph-item IntegrityGraph-item--card"
										>
											<GraphCard
												kind="unlinked"
												title={
													<TeamLabel
														name={u.teamName}
														logoUrl={null}
													/>
												}
												meta={`KHL id ${u.khlPlayerId} · ${plural(u.seasonIds.length, "season", "seasons")}`}
												status={getUnlinkedIntegrity(u)}
												cache={null}
												{...nodeProps({
													kind: "unlinked",
													key,
												})}
											/>
										</li>
									)
								})}
							</ul>
						</li>
					)}
				</ul>
			</div>
		</section>
	)
}

const LEGEND_INTEGRITY: [Integrity, string][] = [
	["matches", "Matches the KHL"],
	["differs", "Differs"],
	["failed", "Failed"],
	["unchecked", "Not checked"],
]

const LEGEND_CACHE: CacheState[] = ["cached", "expired", "not-cached", "failed"]

/** Legend values picked to highlight the nodes that have them */
interface Highlight {
	integrity: Integrity[]
	cache: CacheState[]
}

/** A node's two states; null cache for what isn't a cached page */
interface NodeState {
	integrity: Integrity
	cache: CacheState | null
}

/** Every node in the graph, filtered or not, for the legend's counts */
function getNodeStates(model: ReportModel): NodeState[] {
	const search = model.search && getSearchStatus(model, model.search)
	return [
		...(search
			? [{integrity: search.integrity.integrity, cache: search.cache}]
			: []),
		...model.report.registrations.map((r): NodeState => {
			return {
				integrity: getRegistrationIntegrity(r).integrity,
				cache: null,
			}
		}),
		...[...model.pages.values()].map((p): NodeState => {
			const status = getPageStatus(model, p)
			return {integrity: status.integrity.integrity, cache: status.cache}
		}),
		...model.report.unlinked.map((u): NodeState => {
			return {integrity: getUnlinkedIntegrity(u).integrity, cache: null}
		}),
	]
}

/**
 * Whether a node has the highlighted values: any picked value in a row, and
 * every row with a pick. A node with no cache state has none to pick.
 */
function isHighlighted(highlight: Highlight, node: NodeState): boolean {
	// A check in flight still counts as not checked
	const integrity =
		node.integrity === "checking" ? "unchecked" : node.integrity
	return (
		(highlight.integrity.length === 0 ||
			highlight.integrity.includes(integrity)) &&
		(highlight.cache.length === 0 ||
			(node.cache !== null && highlight.cache.includes(node.cache)))
	)
}

/** `values` with `value` added, or removed if it was there */
function toggleValue<T>(values: T[], value: T): T[] {
	return values.includes(value)
		? values.filter((v) => v !== value)
		: [...values, value]
}

/** Dimmed when something is highlighted and the node isn't it */
function isDimmed(highlight: Highlight, node: NodeState): boolean {
	const active = highlight.integrity.length + highlight.cache.length > 0
	return active && !isHighlighted(highlight, node)
}

/**
 * The two encodings, integrity as a node's color and cache as its glyph.
 * Each value is a toggle that highlights the nodes with it.
 */
const IntegrityLegend = ({
	nodes,
	highlight,
	onChange,
}: {
	nodes: NodeState[]
	highlight: Highlight
	onChange: (highlight: Highlight) => void
}) => {
	const active = highlight.integrity.length + highlight.cache.length > 0
	// How many nodes that value alone would highlight
	const count = (only: Highlight) => {
		return nodes.filter((n) => isHighlighted(only, n)).length
	}
	return (
		<div className="IntegrityLegend">
			<div role="group" aria-label="Highlight by integrity">
				<span className="IntegrityLegend-row">Integrity</span>
				{LEGEND_INTEGRITY.map(([integrity, label]) => (
					<LegendToggle
						key={integrity}
						pressed={highlight.integrity.includes(integrity)}
						count={count({integrity: [integrity], cache: []})}
						onToggle={() =>
							onChange({
								...highlight,
								integrity: toggleValue(
									highlight.integrity,
									integrity,
								),
							})
						}
					>
						<span
							className={cx(
								"IntegrityLegend-swatch",
								`IntegrityLegend-swatch--${integrity}`,
							)}
						/>
						{label}
					</LegendToggle>
				))}
			</div>
			<div role="group" aria-label="Highlight by cache">
				<span className="IntegrityLegend-row">Cache</span>
				{LEGEND_CACHE.map((state) => (
					<LegendToggle
						key={state}
						pressed={highlight.cache.includes(state)}
						count={count({integrity: [], cache: [state]})}
						onToggle={() =>
							onChange({
								...highlight,
								cache: toggleValue(highlight.cache, state),
							})
						}
					>
						<CacheGlyph state={state} />
						{CACHE_STATES[state].label}
					</LegendToggle>
				))}
			</div>
			{active && (
				<button
					type="button"
					className="Integrity-text-button IntegrityLegend-clear"
					onClick={() => onChange({integrity: [], cache: []})}
				>
					Clear highlight
				</button>
			)}
		</div>
	)
}

const LegendToggle = ({
	pressed,
	count,
	onToggle,
	children,
}: {
	pressed: boolean
	count: number
	onToggle: () => void
	children: React.ReactNode
}) => {
	return (
		<button
			type="button"
			className="IntegrityLegend-toggle"
			aria-pressed={pressed}
			onClick={onToggle}
		>
			{children}
			<span className="IntegrityLegend-count">{count}</span>
		</button>
	)
}

const SearchNode = ({
	model,
	search,
	selected,
	onSelect,
	highlight,
}: {
	model: ReportModel
	search: IntegrityCacheEntry
	selected: boolean
	onSelect: () => void
	highlight: Highlight
}) => {
	const status = getSearchStatus(model, search)
	return (
		<GraphCard
			kind="search"
			title={search.label}
			meta={`${plural(model.report.registrations.length, "registration", "registrations")} on this profile`}
			status={status.integrity}
			cache={status.cache}
			selected={selected}
			onSelect={onSelect}
			highlight={highlight}
		/>
	)
}

/** The search, a registration, or a same-name registration */
const GraphCard = ({
	kind,
	title,
	meta,
	status,
	cache,
	selected,
	onSelect,
	highlight,
}: {
	kind: NodeKind
	title: React.ReactNode
	meta: string
	status: IntegrityStatus
	/** Null for what isn't a cached page */
	cache: CacheState | null
	selected: boolean
	onSelect: () => void
	highlight: Highlight
}) => {
	return (
		<button
			type="button"
			className={cx(
				"IntegrityGraph-node",
				"IntegrityGraph-card",
				`IntegrityGraph-node--${status.integrity}`,
				cache === "not-cached" && "IntegrityGraph-node--absent",
				selected && "IntegrityGraph-node--selected",
				isDimmed(highlight, {integrity: status.integrity, cache}) &&
					"IntegrityGraph-node--dimmed",
			)}
			aria-pressed={selected}
			onClick={onSelect}
		>
			<span className="IntegrityGraph-card-head">
				<KindChip kind={kind} />
				{cache && <CacheGlyph state={cache} />}
				<span className="IntegrityGraph-card-title">{title}</span>
			</span>
			<span className="IntegrityGraph-card-meta">
				{meta} ·{" "}
				<span className="IntegrityGraph-card-status">
					{status.label}
				</span>
			</span>
		</button>
	)
}

/** A player page or a season's schedule */
const PageTile = ({
	model,
	page,
	label,
	selected,
	onSelect,
	highlight,
}: {
	model: ReportModel
	page: PageNode
	label: string
	selected: boolean
	onSelect: () => void
	highlight: Highlight
}) => {
	const status = getPageStatus(model, page)
	const description = `${page.registration.teamName} ${CACHE_KINDS[page.kind].label.toLowerCase()}, season ${page.seasonId}: ${CACHE_STATES[status.cache].label} · ${status.integrity.label}`
	return (
		<Hint label={description}>
			<button
				type="button"
				className={cx(
					"IntegrityGraph-node",
					"IntegrityGraph-tile",
					`IntegrityGraph-node--${status.integrity.integrity}`,
					status.cache === "not-cached" &&
						"IntegrityGraph-node--absent",
					selected && "IntegrityGraph-node--selected",
					isDimmed(highlight, {
						integrity: status.integrity.integrity,
						cache: status.cache,
					}) && "IntegrityGraph-node--dimmed",
				)}
				aria-pressed={selected}
				aria-label={description}
				onClick={onSelect}
			>
				<CacheGlyph state={status.cache} />
				{label}
				{status.integrity.mark && (
					<span className="IntegrityGraph-mark">
						{status.integrity.mark}
					</span>
				)}
			</button>
		</Hint>
	)
}

// --- The inspector: the triage list, or the selected node's details

const IntegrityInspector = ({
	model,
	problems,
	selection,
	onSelect,
}: {
	model: ReportModel
	problems: Problem[]
	selection: Selection | null
	onSelect: (selection: Selection | null) => void
}) => {
	const {report} = model
	const detail =
		selection &&
		matchField(selection, "kind", {
			search: () => {
				return model.search ? (
					<SearchInspector model={model} search={model.search} />
				) : null
			},
			registration: (s) => {
				const r = report.registrations.find((r) => {
					return toRegistrationKey(r) === s.key
				})
				return r ? <RegistrationInspector registration={r} /> : null
			},
			page: (s) => {
				const page = model.pages.get(s.key)
				return page ? <PageInspector model={model} page={page} /> : null
			},
			unlinked: (s) => {
				const u = report.unlinked.find((u) => {
					return toRegistrationKey(u) === s.key
				})
				return u ? <UnlinkedInspector unlinked={u} /> : null
			},
		})
	if (!detail) {
		return (
			<TriageList model={model} problems={problems} onSelect={onSelect} />
		)
	}
	return (
		<>
			<button
				type="button"
				className="Integrity-text-button IntegrityInspector-back"
				onClick={() => onSelect(null)}
			>
				←{" "}
				{problems.length === 0
					? "Overview"
					: plural(problems.length, "problem", "problems")}
			</button>
			{detail}
		</>
	)
}

/** What's wrong with the profile, worst first, each opening its node */
const TriageList = ({
	model,
	problems,
	onSelect,
}: {
	model: ReportModel
	problems: Problem[]
	onSelect: (selection: Selection) => void
}) => {
	const pages = [...model.pages.values()]
	const cached = pages.filter((p) => p.entry?.cachedAt).length
	const checked = pages.filter((p) => {
		const check = model.checks.checks.get(p.key)
		return check && check.status !== "checking"
	}).length
	return (
		<>
			<h2 className="SectionLabel Detail-panel-title">
				{problems.length === 0
					? "No problems found"
					: plural(problems.length, "problem", "problems")}
			</h2>
			<FactList
				layout="grid"
				facts={[
					["Registrations", model.report.registrations.length],
					["Pages cached", `${cached} of ${pages.length}`],
					["Pages checked", `${checked} of ${pages.length}`],
				]}
			/>
			<p className="Integrity-note">
				Select a problem, or any node in the graph, to see its details.
			</p>
			{problems.length === 0 ? (
				<p className="Integrity-note">
					What we've stored matches the KHL's name search and player
					pages. Cached pages can still be stale: check them to
					compare our copies with the KHL's pages now.
				</p>
			) : (
				<ol className="IntegrityTriage">
					{problems.map((problem) => (
						<li key={problem.id}>
							<button
								type="button"
								className={cx(
									"IntegrityTriage-problem",
									`IntegrityTriage-problem--${problem.severity}`,
								)}
								onClick={() => onSelect(problem.selection)}
							>
								<span className="IntegrityTriage-title">
									{problem.title}
								</span>
								<FactList
									layout="inline"
									facts={[
										...problem.facts,
										...(problem.error
											? ([
													["Error", problem.error],
												] satisfies Fact[])
											: []),
									]}
								/>
								<span className="IntegrityTriage-fix">
									{problem.fix}
								</span>
							</button>
						</li>
					))}
				</ol>
			)}
			<p className="Integrity-note">
				A KHL+ profile is one person. The KHL has no such thing: it
				issues a new player id, with its own player page, each time a
				person registers, and one id can carry on across teams. Each
				registration we've stored is compared with the KHL's name search
				and its player page.
			</p>
			<KindGlossary />
		</>
	)
}

/** What each kind of node in the graph is */
const KindGlossary = () => {
	return (
		<section className="IntegrityGlossary">
			<h3 className="SectionLabel">Resource types</h3>
			<dl>
				{(Object.keys(NODE_KINDS) as NodeKind[]).map((kind) => (
					<div key={kind}>
						<dt>
							<KindChip kind={kind} />
						</dt>
						<dd>{NODE_KINDS[kind].description}</dd>
					</div>
				))}
			</dl>
		</section>
	)
}

/** A node's header in the inspector: what it is, and its key facts */
const InspectorHeader = ({
	kind,
	title,
	status,
	cache,
	facts,
	actions,
}: {
	kind: NodeKind
	title: React.ReactNode
	status: IntegrityStatus
	cache: {state: CacheState; entry: IntegrityCacheEntry | undefined} | null
	facts: Fact[]
	/** What can be done to the node, shown first under its title */
	actions: React.ReactNode
}) => {
	return (
		<>
			<div className="IntegrityInspector-head">
				<KindChip kind={kind} />
				<h2 className="IntegrityInspector-title">{title}</h2>
			</div>
			<div className="Integrity-actions">{actions}</div>
			<FactList
				layout="grid"
				facts={[
					[
						"Integrity",
						<IntegrityBadge
							tone={INTEGRITY_TONES[status.integrity]}
						>
							{status.label}
						</IntegrityBadge>,
					],
					...(cache ? getCacheFacts(cache.state, cache.entry) : []),
					...facts,
				]}
			/>
		</>
	)
}

/** A page's cache state, when it was cached and expires, and its key */
function getCacheFacts(
	state: CacheState,
	entry: IntegrityCacheEntry | undefined,
): Fact[] {
	return [
		[
			"Cache",
			<span className="IntegrityInspector-cache">
				<span>
					<CacheGlyph state={state} /> {CACHE_STATES[state].label}
				</span>
				<span className="IntegrityInspector-fact-note">
					{CACHE_STATES[state].detail}
				</span>
			</span>,
		],
		...(entry?.cachedAt
			? ([["Cached", <TimeAgo at={entry.cachedAt} />]] satisfies Fact[])
			: []),
		...(entry?.expiresAt && state === "cached"
			? ([["Expires", <TimeAgo at={entry.expiresAt} />]] satisfies Fact[])
			: []),
		...(entry
			? ([["Cache key", <code>{entry.key}</code>]] satisfies Fact[])
			: []),
	]
}

/** Checks a cached page against the KHL's page now; disabled with no copy */
const CheckButton = ({
	entry,
	checks,
}: {
	entry: IntegrityCacheEntry | undefined
	checks: CacheChecks
}) => {
	const check = entry && checks.checks.get(entry.key)
	const label = check
		? matchField(check, "status", {
				checking: () => "Checking…",
				error: () => "Check again",
				failed: () => "Check again",
				"not-cached": () => "Check again",
				match: () => "Check again",
				differs: () => "Check again",
			})
		: "Check against the KHL"
	return (
		<Hint label="Loads the KHL's page now and compares it with our copy. Our copy stays as it is.">
			<button
				type="button"
				className="FilterPill"
				disabled={!entry?.cachedAt || check?.status === "checking"}
				onClick={() => entry && void checks.check(entry.key)}
			>
				{label}
			</button>
		</Hint>
	)
}

/** A link out, styled like the actions beside it */
const ActionLink = ({
	href,
	children,
}: {
	href: string
	children: React.ReactNode
}) => {
	return (
		<Link className="FilterPill" href={href}>
			{children}
		</Link>
	)
}

const SearchInspector = ({
	model,
	search,
}: {
	model: ReportModel
	search: IntegrityCacheEntry
}) => {
	const status = getSearchStatus(model, search)
	return (
		<>
			<InspectorHeader
				kind="search"
				title={search.label}
				status={status.integrity}
				cache={{state: status.cache, entry: search}}
				facts={[["Shared", CACHE_KINDS.search.shared]]}
				actions={
					<>
						<CheckButton entry={search} checks={model.checks} />
						<ActionLink href={model.report.searchUrl}>
							Open on the KHL ↗
						</ActionLink>
					</>
				}
			/>
			{model.report.searchError && (
				<ErrorNote
					summary="The search failed, so no registration was compared with it."
					error={model.report.searchError}
				/>
			)}
			<CacheEntryDetail
				entry={search}
				check={model.checks.checks.get(search.key)}
			/>
		</>
	)
}

const PageInspector = ({model, page}: {model: ReportModel; page: PageNode}) => {
	const status = getPageStatus(model, page)
	const r = page.registration
	const url = page.kind === "profile" ? r.profileUrl : null
	return (
		<>
			<InspectorHeader
				kind={page.kind}
				title={<TeamLabel name={r.teamName} logoUrl={r.teamLogoUrl} />}
				status={status.integrity}
				cache={{state: status.cache, entry: page.entry}}
				facts={[
					["Season", page.seasonId],
					["KHL id", <code>{r.khlPlayerId}</code>],
					["Shared", CACHE_KINDS[page.kind].shared],
				]}
				actions={
					<>
						<CheckButton entry={page.entry} checks={model.checks} />
						{url && (
							<ActionLink href={url}>
								Open on the KHL ↗
							</ActionLink>
						)}
					</>
				}
			/>
			{page.error && (
				<ErrorNote
					summary="The KHL's page failed when the report loaded it."
					error={page.error}
				/>
			)}
			{page.entry ? (
				<CacheEntryDetail
					entry={page.entry}
					check={model.checks.checks.get(page.key)}
				/>
			) : (
				<p className="Integrity-note">
					Nothing was cached for this page when the report began.
				</p>
			)}
		</>
	)
}

const RegistrationInspector = ({
	registration: r,
}: {
	registration: IntegrityRegistration
}) => {
	return (
		<>
			<InspectorHeader
				kind="registration"
				title={<TeamLabel name={r.teamName} logoUrl={r.teamLogoUrl} />}
				status={getRegistrationIntegrity(r)}
				cache={null}
				facts={[
					["KHL id", <code>{r.khlPlayerId}</code>],
					["Seasons", formatSeasonIds(r.seasonIds) ?? "none"],
					["Recorded", <TimeAgo at={r.updatedAt} />],
				]}
				actions={
					r.profileUrl && (
						<ActionLink href={r.profileUrl}>
							Open the player page on the KHL ↗
						</ActionLink>
					)
				}
			/>
			<RegistrationDetail registration={r} />
		</>
	)
}

const UnlinkedInspector = ({unlinked: u}: {unlinked: IntegrityUnlinked}) => {
	return (
		<>
			<InspectorHeader
				kind="unlinked"
				title={<TeamLabel name={u.teamName} logoUrl={null} />}
				status={getUnlinkedIntegrity(u)}
				cache={null}
				facts={[
					["KHL id", <code>{u.khlPlayerId}</code>],
					["Seasons", formatSeasonIds(u.seasonIds) ?? "none"],
				]}
				actions={
					<>
						{u.playerId && (
							<ActionLink
								href={`${getPlayerHref(u.playerId)}?integrity`}
							>
								Open the other profile's report
							</ActionLink>
						)}
						<ActionLink href={u.khlUrl}>
							Open the player page on the KHL ↗
						</ActionLink>
					</>
				}
			/>
			<UnlinkedDetail unlinked={u} />
		</>
	)
}

/** What's cached, and once checked, how it compares with the KHL's page */
const CacheEntryDetail = ({
	entry,
	check,
}: {
	entry: IntegrityCacheEntry
	check: CacheCheckState | undefined
}) => {
	const state = useAsync(
		() => doRequest(GET_CACHE_ENTRY_ENDPOINT, {key: entry.key}),
		[entry.key],
	)
	return (
		<div className="Integrity-detail-body">
			<AsyncContent
				state={state}
				size="inline"
				loadingLabel="Loading the cached copy…"
				errorTitle="Couldn't load the cached copy"
			>
				{(cached) =>
					cached.value === null ? (
						<p className="Integrity-note">
							Nothing is cached for this page now. It loads the
							next time a page needs it.
						</p>
					) : (
						<Comparison
							summary={<CacheCheckSummary check={check} />}
							differences={
								check?.status === "differs"
									? check.differences
									: null
							}
							oursTitle={
								cached.cachedAt ? (
									<>
										Cached <TimeAgo at={cached.cachedAt} />
									</>
								) : (
									"Cached"
								)
							}
							ours={cached.value}
							khlTitle={
								check && "checkedAt" in check ? (
									<>
										KHL, checked{" "}
										<TimeAgo at={check.checkedAt} />
									</>
								) : (
									"KHL"
								)
							}
							khl={check && "khl" in check ? check.khl : null}
							khlPlaceholder="Check it to load the KHL's page."
						>
							{check?.status === "differs" &&
								check.differenceCount >
									check.differences.length && (
									<FactList
										layout="inline"
										facts={[
											[
												"Differences not shown",
												check.differenceCount -
													check.differences.length,
											],
										]}
									/>
								)}
						</Comparison>
					)
				}
			</AsyncContent>
		</div>
	)
}

/** A cache check's outcome; the Check button is in the inspector's header */
const CacheCheckSummary = ({check}: {check: CacheCheckState | undefined}) => {
	if (!check) {
		return (
			<div className="IntegrityInspector-check">
				<p className="Integrity-note">
					Not checked. Checking loads the KHL's page now and compares
					it with our copy; our copy stays as it is.
				</p>
			</div>
		)
	}
	return matchField(check, "status", {
		checking: () => <InlineLoader label="Loading the KHL's page…" />,
		error: (c) => (
			<div className="IntegrityInspector-check">
				<ErrorNote
					summary="The check failed."
					error={c.error.message}
				/>
			</div>
		),
		failed: (c) => (
			<div className="IntegrityInspector-check">
				<ErrorNote
					summary="The KHL's page didn't load, so nothing was compared."
					error={c.error ?? "No message"}
				/>
			</div>
		),
		"not-cached": () => (
			<p className="Integrity-note">
				It expired before the check, so there was nothing to compare.
			</p>
		),
		match: () => (
			<div className="IntegrityInspector-check">
				<p className="Integrity-note">
					Our copy matches the KHL's page.
				</p>
			</div>
		),
		differs: (c) => (
			<div className="IntegrityInspector-check">
				<p className="Integrity-note">
					Our copy is stale: it differs from the KHL's page. Reload
					from KHL to replace it.
				</p>
				<FactList
					layout="inline"
					facts={[["Differences", c.differenceCount]]}
				/>
			</div>
		),
	})
}

// --- Registrations

const TeamLabel = ({name, logoUrl}: {name: string; logoUrl: string | null}) => {
	return (
		<span className="Integrity-team">
			<TeamAvatar name={name} logoUrl={logoUrl} size={24} />
			{name}
		</span>
	)
}

/** The record field each IntegrityMismatch field compares */
const MISMATCH_RECORD_FIELDS: Record<string, string> = {
	name: "name",
	position: "position",
	"team name": "teamName",
	"team logo": "teamLogoUrl",
	seasons: "seasonIds",
}

/** "team logo" for "teamLogoUrl" */
const RECORD_FIELD_LABELS: Record<string, string> = Object.fromEntries(
	Object.entries(MISMATCH_RECORD_FIELDS).map(([label, field]) => {
		return [field, label]
	}),
)

/**
 * The stored record beside the record the KHL implies, which is what
 * applying the resync stores. Where the KHL's own pages disagree, the
 * expected record keeps what's stored; those are listed below the diff.
 */
const RegistrationDetail = ({
	registration: r,
}: {
	registration: IntegrityRegistration
}) => {
	const differingFields = new Set(
		r.differences.map((d) => d.path.split(/[.[ ]/)[0]),
	)
	const notResynced = r.mismatches.filter((m) => {
		const field = MISMATCH_RECORD_FIELDS[m.field]
		return !field || !differingFields.has(field)
	})
	return (
		<div className="Integrity-detail-body">
			<Comparison
				summary={
					<>
						{r.profileError && (
							<ErrorNote
								summary="The KHL player page failed, so nothing was compared with it."
								error={r.profileError}
							/>
						)}
						<p className="Integrity-note">
							{r.differences.length === 0
								? "The stored record matches what the KHL's name search and player page imply."
								: "The stored record differs from what the KHL's pages imply. Applying the resync stores the KHL's."}
						</p>
					</>
				}
				differences={r.differences}
				oursTitle={
					<>
						Stored <TimeAgo at={r.updatedAt} />
					</>
				}
				ours={r.stored}
				khlTitle="Expected from the KHL"
				khl={r.expected}
			>
				{notResynced.length > 0 && (
					<div className="Integrity-changes">
						<p className="SectionLabel">
							The KHL's pages disagree, so a resync leaves these
						</p>
						<ul>
							{notResynced.map((m) => (
								<li key={`${m.source}:${m.field}`}>
									<FactList
										layout="inline"
										facts={[
											["Page", SOURCE_LABELS[m.source]],
											["Field", m.field],
											...(m.detail
												? ([
														["Detail", m.detail],
													] satisfies Fact[])
												: ([
														[
															"Stored",
															m.ours ?? "none",
														],
														[
															"KHL",
															m.khl ?? "none",
														],
													] satisfies Fact[])),
										]}
									/>
								</li>
							))}
						</ul>
					</div>
				)}
			</Comparison>
		</div>
	)
}

/** Fields that differ across the profile's registrations */
function countDifferences(report: IntegrityReport): number {
	return report.registrations.reduce(
		(total, r) => total + r.differences.length,
		0,
	)
}

const UnlinkedDetail = ({unlinked: u}: {unlinked: IntegrityUnlinked}) => {
	return (
		<div className="Integrity-detail-body">
			<p className="Integrity-note">
				{u.playerId
					? "On another KHL+ profile with this name: a namesake split off by hand, or the same person split in two. If it's this person, the profiles need merging by hand."
					: "We've never recorded this registration. Applying the resync records it, on a KHL+ profile matched by name."}
			</p>
		</div>
	)
}

/** "93, 96, 100", deduplicated and oldest first */
function formatSeasonIds(seasonIds: string[]): string | null {
	if (seasonIds.length === 0) {
		return null
	}
	return [...new Set(seasonIds)]
		.sort((a, b) => Number(a) - Number(b))
		.join(", ")
}

/** "1 change", "3 changes" */
function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`
}
