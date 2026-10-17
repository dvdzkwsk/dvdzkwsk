import {Logger} from "@dvdzkwsk/logger"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {createConcurrencyLimiter} from "@dvdzkwsk/util/AsyncUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import * as React from "react"
import {
	AsyncContent,
	ChevronIcon,
	ErrorState,
	Hint,
	InlineLoader,
	Link,
	MultiPicker,
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
	CacheCheckResponse,
	CHECK_CACHE_ENDPOINT,
	GET_CACHE_ENTRY_ENDPOINT,
	GET_PLAYER_INTEGRITY_ENDPOINT,
	getRegistrationKey,
	IntegrityCacheEntry,
	IntegrityCacheKind,
	IntegrityRegistration,
	IntegritySource,
	IntegrityUnlinked,
	JsonDifference,
	PlayerIntegrityResponse,
	RELOAD_PLAYER_INTEGRITY_ENDPOINT,
	RESYNC_PLAYER_ENDPOINT,
} from "../shared/ApiJson.js"

// --- /players/:playerId?integrity: our stored profile against the KHL's pages

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
	report: PlayerIntegrityResponse | null
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
						<IntegrityHeader report={report} />
						<ResyncPanel
							report={report}
							action={action}
							onRun={run}
						/>
						{/* Keyed so checks from an older report don't linger */}
						<IntegrityCache
							key={report.checkedAt}
							cache={report.cache}
						/>
						<IntegrityPlayers report={report} />
					</div>
				)
			}}
		</AsyncContent>
	)
}

const IntegrityHeader = ({report}: {report: PlayerIntegrityResponse}) => {
	const differences = countDifferences(report)
	return (
		<header className="Detail-header Integrity-header">
			<div className="Integrity-heading">
				<p className="SectionLabel">Integrity report</p>
				<h1 className="Integrity-name">{report.name}</h1>
				<p className="Integrity-meta">
					Profile recorded <TimeAgo at={report.createdAt} />
					{" · "}checked <TimeAgo at={report.checkedAt} />
					{" · "}
					<code>{report.playerId}</code>
				</p>
				<p className="Integrity-links">
					<Link
						className="InlineLink"
						href={getPlayerHref(report.playerId)}
					>
						View profile
					</Link>
					<Link className="InlineLink" href={report.searchUrl}>
						KHL search
					</Link>
				</p>
			</div>
			{differences === 0 ? (
				<IntegrityBadge tone="ok">Matches the KHL</IntegrityBadge>
			) : (
				<IntegrityBadge tone="warn">
					{plural(differences, "difference", "differences")}
				</IntegrityBadge>
			)}
		</header>
	)
}

const ResyncPanel = ({
	report,
	action,
	onRun,
}: {
	report: PlayerIntegrityResponse
	action: ActionState
	onRun: (action: IntegrityAction) => void
}) => {
	const unrecorded = report.unlinked.filter((u) => !u.playerId).length
	const pending = countDifferences(report) + unrecorded
	return (
		<section className="Detail-panel">
			<h2 className="SectionLabel Detail-panel-title">Resync</h2>
			<p className="Integrity-note">
				{pending === 0
					? "What we've stored matches the KHL's pages; there's nothing to resync."
					: `Applying the resync stores ${plural(pending, "change", "changes")} to the KHL players below${
							unrecorded > 0
								? `, including ${plural(unrecorded, "unrecorded registration", "unrecorded registrations")}`
								: ""
						}. Nothing is stored until then.`}
			</p>
			<div className="Integrity-actions">
				<button
					type="button"
					className="Integrity-apply"
					disabled={!!action.running || pending === 0}
					onClick={() => onRun("apply")}
				>
					Apply resync
				</button>
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
			</div>
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
		</section>
	)
}

// --- Shared pieces of the two tables

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

/** A table group's heading row, e.g. "Jackie Uniza's KHL+ profile" */
const GroupRow = ({
	label,
	meta,
	colSpan,
}: {
	label: React.ReactNode
	meta: React.ReactNode
	colSpan: number
}) => {
	return (
		<tr className="Integrity-group">
			<th scope="colgroup" colSpan={colSpan}>
				{label}
				<span className="Integrity-group-meta">{meta}</span>
			</th>
		</tr>
	)
}

/**
 * A row that opens to show `detail` beneath it. The whole row toggles it;
 * buttons and links inside the row keep their own clicks.
 */
const ExpandableRow = ({
	expanded,
	onToggle,
	label,
	cells,
	detail,
}: {
	expanded: boolean
	onToggle: () => void
	label: React.ReactNode
	cells: React.ReactNode[]
	detail: React.ReactNode
}) => {
	return (
		<>
			<tr
				className={cx(
					"Integrity-row",
					expanded && "Integrity-row--expanded",
				)}
				onClick={(e) => {
					if (!(e.target as HTMLElement).closest("a, button")) {
						onToggle()
					}
				}}
			>
				<th scope="row">
					<button
						type="button"
						className="Integrity-expander"
						aria-expanded={expanded}
						onClick={onToggle}
					>
						<ChevronIcon />
						{label}
					</button>
				</th>
				{cells.map((cell, i) => (
					<td key={i}>{cell}</td>
				))}
			</tr>
			{expanded && (
				<tr className="Integrity-detail">
					<td colSpan={cells.length + 1}>{detail}</td>
				</tr>
			)}
		</>
	)
}

function useExpanded() {
	const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
	const toggle = (key: string) => {
		setExpanded((prev) => {
			const next = new Set(prev)
			if (!next.delete(key)) {
				next.add(key)
			}
			return next
		})
	}
	return {isExpanded: (key: string) => expanded.has(key), toggle}
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

// --- Server cache

const CACHE_KINDS: Record<
	IntegrityCacheKind,
	{label: string; plural: string; shared: string}
> = {
	search: {
		label: "Search",
		plural: "Name searches",
		shared: "The KHL's all-seasons search for a name. Shared by every KHL+ profile with that name.",
	},
	profile: {
		label: "Registration",
		plural: "Registration pages",
		shared: "A KHL registration's player page. Shared by every KHL+ profile with that registration.",
	},
	schedule: {
		label: "Schedule",
		plural: "Team schedules",
		shared: "A team's schedule for a season. Shared by every player on the team and the team's own page.",
	},
}

type CacheCheckState =
	{status: "checking"} | {status: "error"; error: Error} | CacheCheckResponse

/** At most this many checks at once, so "Check all" doesn't burst the KHL */
const limitChecks = createConcurrencyLimiter(2)

/** What the server had cached for the player's page when the report began */
const IntegrityCache = ({cache}: {cache: IntegrityCacheEntry[]}) => {
	const [checks, setChecks] = React.useState<Map<string, CacheCheckState>>(
		new Map(),
	)
	// Empty shows every type
	const [kinds, setKinds] = React.useState<IntegrityCacheKind[]>([])
	const {isExpanded, toggle} = useExpanded()
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
	const presentKinds = (
		Object.keys(CACHE_KINDS) as IntegrityCacheKind[]
	).filter((kind) => cache.some((e) => e.kind === kind))
	// Grouped by type in CACHE_KINDS order, then by name ("season 2121" before
	// "season 2127")
	const kindOrder = Object.keys(CACHE_KINDS)
	const shown = cache
		.filter((e) => kinds.length === 0 || kinds.includes(e.kind))
		.sort((a, b) => {
			return (
				kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) ||
				a.label.localeCompare(b.label, "en-US", {numeric: true})
			)
		})
	const shownCached = shown.filter((entry) => entry.cachedAt)
	const isChecking = [...checks.values()].some((c) => c.status === "checking")
	return (
		<section className="Detail-panel">
			<div className="Integrity-panel-header">
				<h2 className="SectionLabel Detail-panel-title">
					Server cache
				</h2>
				<div className="Integrity-actions">
					<MultiPicker
						title="Filter by resource type"
						items={presentKinds.map((kind) => ({
							value: kind,
							label: CACHE_KINDS[kind].plural,
							hint: String(
								cache.filter((e) => e.kind === kind).length,
							),
						}))}
						values={kinds}
						onChange={(next) =>
							setKinds(next as IntegrityCacheKind[])
						}
						triggerLabel={
							kinds.length === 0
								? "All types"
								: kinds.length === 1
									? CACHE_KINDS[kinds[0]!].plural
									: `${kinds.length} types`
						}
					/>
					<button
						type="button"
						className="FilterPill"
						disabled={isChecking || shownCached.length === 0}
						onClick={() => {
							for (const entry of shownCached) {
								void check(entry.key)
							}
						}}
					>
						Check all
					</button>
				</div>
			</div>
			<p className="Integrity-note">
				{shownCached.length} of {shown.length} resources
				{kinds.length > 0 ? " shown " : " "}were cached when the report
				began. Checking one loads it from the KHL again and compares;
				the cached copy stays as it is. Open a row to see what's cached.
			</p>
			<div className="Integrity-scroll">
				<table className="Integrity-table">
					<thead>
						<tr>
							<th scope="col">Type</th>
							<th scope="col">Resource</th>
							<th scope="col">Cached</th>
							<th scope="col">Expires</th>
							<th scope="col">Integrity</th>
							<th scope="col">
								<span className="Integrity-visually-hidden">
									Actions
								</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{shown.map((entry) => (
							<ExpandableRow
								key={entry.key}
								expanded={isExpanded(entry.key)}
								onToggle={() => toggle(entry.key)}
								label={
									<Hint
										label={CACHE_KINDS[entry.kind].shared}
									>
										<span
											className={cx(
												"Integrity-type",
												`Integrity-type--${entry.kind}`,
											)}
										>
											{CACHE_KINDS[entry.kind].label}
										</span>
									</Hint>
								}
								cells={[
									entry.label,
									entry.cachedAt ? (
										<TimeAgo at={entry.cachedAt} />
									) : (
										<span className="Integrity-muted">
											Not cached
										</span>
									),
									entry.expiresAt ? (
										<TimeAgo at={entry.expiresAt} />
									) : (
										"–"
									),
									<CacheCheckBadge
										check={checks.get(entry.key)}
									/>,
									<button
										type="button"
										className="FilterPill"
										disabled={
											!entry.cachedAt ||
											checks.get(entry.key)?.status ===
												"checking"
										}
										onClick={() => void check(entry.key)}
									>
										Check
									</button>,
								]}
								detail={
									<CacheEntryDetail
										entry={entry}
										check={checks.get(entry.key)}
										onCheck={() => void check(entry.key)}
									/>
								}
							/>
						))}
					</tbody>
				</table>
			</div>
		</section>
	)
}

const CacheCheckBadge = ({check}: {check: CacheCheckState | undefined}) => {
	if (!check) {
		return <span className="Integrity-muted">Not checked</span>
	}
	switch (check.status) {
		case "checking":
			return <span className="Integrity-muted">Checking…</span>
		case "error":
			return <IntegrityBadge tone="error">Check failed</IntegrityBadge>
		case "failed":
			return <IntegrityBadge tone="error">KHL page failed</IntegrityBadge>
		case "not-cached":
			return <span className="Integrity-muted">Not cached</span>
		case "match":
			return <IntegrityBadge tone="ok">Matches</IntegrityBadge>
		case "differs":
			return (
				<IntegrityBadge tone="warn">
					{plural(check.differenceCount, "difference", "differences")}
				</IntegrityBadge>
			)
	}
}

/** What's cached, and once checked, how it compares with the KHL's page */
const CacheEntryDetail = ({
	entry,
	check,
	onCheck,
}: {
	entry: IntegrityCacheEntry
	check: CacheCheckState | undefined
	onCheck: () => void
}) => {
	const state = useAsync(
		() => doRequest(GET_CACHE_ENTRY_ENDPOINT, {key: entry.key}),
		[entry.key],
	)
	return (
		<div className="Integrity-detail-body">
			<p className="Integrity-muted">
				<code>{entry.key}</code>
			</p>
			<AsyncContent
				state={state}
				size="inline"
				loadingLabel="Loading the cached copy…"
				errorTitle="Couldn't load the cached copy"
			>
				{(cached) =>
					cached.value === null ? (
						<p className="Integrity-note">
							Nothing is cached for this resource now. It loads
							the next time a page needs it.
						</p>
					) : (
						<Comparison
							summary={
								<CacheCheckSummary
									check={check}
									onCheck={onCheck}
								/>
							}
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
							khlPlaceholder="Check the row to load the KHL's page."
						>
							{check?.status === "differs" &&
								check.differenceCount >
									check.differences.length && (
									<p className="Integrity-note">
										And{" "}
										{check.differenceCount -
											check.differences.length}{" "}
										more.
									</p>
								)}
						</Comparison>
					)
				}
			</AsyncContent>
		</div>
	)
}

/** A cache check's outcome in a line; the differences are a table below */
const CacheCheckSummary = ({
	check,
	onCheck,
}: {
	check: CacheCheckState | undefined
	onCheck: () => void
}) => {
	if (!check) {
		return (
			<p className="Integrity-note">
				Not compared yet.{" "}
				<button
					type="button"
					className="Integrity-text-button"
					onClick={onCheck}
				>
					Compare with the KHL
				</button>
			</p>
		)
	}
	switch (check.status) {
		case "checking":
			return <InlineLoader label="Loading the KHL's page…" />
		case "error":
			return (
				<p className="Integrity-error">
					The check failed: {check.error.message}
				</p>
			)
		case "failed":
			return (
				<p className="Integrity-error">
					The KHL's page didn't load, so nothing was compared:{" "}
					{check.error}
				</p>
			)
		case "not-cached":
			return (
				<p className="Integrity-note">
					It expired before the check, so there was nothing to
					compare.
				</p>
			)
		case "match":
			return (
				<p className="Integrity-note">
					The cached copy matches the KHL's page.
				</p>
			)
		case "differs":
			return (
				<p className="Integrity-note">
					The cached copy differs from the KHL's page in{" "}
					{plural(check.differenceCount, "place", "places")}.
				</p>
			)
	}
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

// --- KHL registrations

/**
 * Every KHL registration on the KHL+ profile, plus same-name registrations
 * on other KHL+ profiles
 */
const IntegrityPlayers = ({report}: {report: PlayerIntegrityResponse}) => {
	const {isExpanded, toggle} = useExpanded()
	return (
		<section className="Detail-panel">
			<h2 className="SectionLabel Detail-panel-title">
				KHL registrations
			</h2>
			<p className="Integrity-note">
				A KHL+ profile is one person. The KHL has no such thing: it
				issues a new player id, with its own player page, each time a
				person registers on a team. Each registration we've stored is
				compared with the KHL's name search and its KHL player page.
				Open a row to see what differs.
			</p>
			{report.searchError && (
				<p className="Integrity-error">
					The KHL search failed, so nothing was compared with it:{" "}
					{report.searchError}
				</p>
			)}
			<div className="Integrity-scroll">
				<table className="Integrity-table">
					<thead>
						<tr>
							<th scope="col">Team</th>
							<th scope="col">KHL id</th>
							<th scope="col">Seasons</th>
							<th scope="col">Recorded</th>
							<th scope="col">Integrity</th>
						</tr>
					</thead>
					<tbody>
						<GroupRow
							label={
								<Link
									className="InlineLink"
									href={getPlayerHref(report.playerId)}
								>
									{report.name}'s KHL+ profile
								</Link>
							}
							colSpan={5}
							meta={plural(
								report.registrations.length,
								"registration",
								"registrations",
							)}
						/>
						{report.registrations.map((r) => (
							<ExpandableRow
								key={getRegistrationKey(r)}
								expanded={isExpanded(getRegistrationKey(r))}
								onToggle={() => toggle(getRegistrationKey(r))}
								label={
									<TeamLabel
										name={r.teamName}
										logoUrl={r.teamLogoUrl}
									/>
								}
								cells={[
									<KHLIdLink
										khlPlayerId={r.khlPlayerId}
										url={r.profileUrl}
									/>,
									r.seasonIds.length,
									<TimeAgo at={r.updatedAt} />,
									<RegistrationBadge registration={r} />,
								]}
								detail={<RegistrationDetail registration={r} />}
							/>
						))}
					</tbody>
					{!report.searchError && report.unlinked.length > 0 && (
						<tbody>
							<GroupRow
								label={`Other registrations named “${report.name}”`}
								colSpan={5}
								meta={plural(
									report.unlinked.length,
									"registration",
									"registrations",
								)}
							/>
							{report.unlinked.map((u) => (
								<ExpandableRow
									key={getRegistrationKey(u)}
									expanded={isExpanded(getRegistrationKey(u))}
									onToggle={() =>
										toggle(getRegistrationKey(u))
									}
									label={
										<TeamLabel
											name={u.teamName}
											logoUrl={null}
										/>
									}
									cells={[
										<KHLIdLink
											khlPlayerId={u.khlPlayerId}
											url={u.khlUrl}
										/>,
										u.seasonIds.length,
										"–",
										u.playerId ? (
											<Link
												className="InlineLink"
												href={`${getPlayerHref(u.playerId)}?integrity`}
											>
												Other KHL+ profile
											</Link>
										) : (
											<IntegrityBadge tone="warn">
												Not recorded
											</IntegrityBadge>
										),
									]}
									detail={<UnlinkedDetail unlinked={u} />}
								/>
							))}
						</tbody>
					)}
				</table>
			</div>
		</section>
	)
}

/** A KHL player id, linking to its KHL player page */
const KHLIdLink = ({
	khlPlayerId,
	url,
}: {
	khlPlayerId: string
	url: string | null
}) => {
	const id = <code>{khlPlayerId}</code>
	return url ? (
		<Hint label="Open the KHL player page">
			<Link className="InlineLink" href={url}>
				{id} ↗
			</Link>
		</Hint>
	) : (
		id
	)
}

const TeamLabel = ({name, logoUrl}: {name: string; logoUrl: string | null}) => {
	return (
		<span className="Integrity-team">
			<TeamAvatar name={name} logoUrl={logoUrl} size={24} />
			{name}
		</span>
	)
}

const RegistrationBadge = ({
	registration: r,
}: {
	registration: IntegrityRegistration
}) => {
	if (r.differences.length > 0) {
		return (
			<IntegrityBadge tone="warn">
				{plural(r.differences.length, "difference", "differences")}
			</IntegrityBadge>
		)
	}
	if (r.profileError) {
		return <IntegrityBadge tone="error">KHL page failed</IntegrityBadge>
	}
	return <IntegrityBadge tone="ok">Matches</IntegrityBadge>
}

/** The record field each IntegrityMismatch field compares */
const MISMATCH_RECORD_FIELDS: Record<string, string> = {
	name: "name",
	position: "position",
	"team name": "teamName",
	"team logo": "teamLogoUrl",
	seasons: "seasonIds",
}

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
							<p className="Integrity-error">
								The KHL player page failed, so nothing was
								compared with it: {r.profileError}
							</p>
						)}
						<p className="Integrity-note">
							{r.differences.length === 0
								? "The stored record matches what the KHL's name search and player page imply."
								: `The stored record differs from the KHL in ${plural(r.differences.length, "place", "places")}. Applying the resync stores the KHL's.`}
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
									{SOURCE_LABELS[m.source]} · {m.field}:{" "}
									{m.detail ?? (
										<>
											stored <q>{m.ours ?? "none"}</q>,
											KHL <q>{m.khl ?? "none"}</q>
										</>
									)}
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
function countDifferences(report: PlayerIntegrityResponse): number {
	return report.registrations.reduce(
		(total, r) => total + r.differences.length,
		0,
	)
}

const UnlinkedDetail = ({unlinked: u}: {unlinked: IntegrityUnlinked}) => {
	return (
		<div className="Integrity-detail-body">
			<p className="Integrity-note">
				{u.playerId ? (
					<>
						On another KHL+ profile with this name: a namesake split
						off by hand, or the same person split in two.{" "}
						<Link
							className="InlineLink"
							href={`${getPlayerHref(u.playerId)}?integrity`}
						>
							Open its report
						</Link>
					</>
				) : (
					"We've never recorded this registration. Applying the resync records it, on a KHL+ profile matched by name."
				)}
			</p>
			<p className="Integrity-note">
				Seasons: {formatSeasonIds(u.seasonIds) ?? "none"}
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
