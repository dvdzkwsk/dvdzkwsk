import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import {matchFn, matchField, matchValue} from "@dvdzkwsk/util/MatchUtil"
import * as React from "react"
import {
	BENCHMARK_SITE_LABELS,
	BenchmarkResponse,
	BenchmarkRun,
	BenchmarkSummary,
	BenchmarkTiming,
	DEFAULT_BENCHMARK_NAMES,
	DevSettingsResponse,
	GET_DEV_SETTINGS_ENDPOINT,
	PULL_PROD_DATA_ENDPOINT,
	PullProdDataResponse,
	RUN_BENCHMARK_ENDPOINT,
	UPDATE_DEV_SETTINGS_ENDPOINT,
} from "../../shared/ApiJson.js"
import {
	AsyncContent,
	Card,
	ErrorState,
	Hint,
	InlineLoader,
	NotFoundState,
	PageLoader,
	PageShell,
	SegmentedControl,
	StatsTable,
	StatsTableColumn,
} from "../Components.js"
import {
	formatSeconds,
	readSimulatedLoading,
	Route,
	SIMULATED_LOADING_DELAY_MS,
	SimulatedLoading,
	useAsync,
	writeSimulatedLoading,
} from "../Util.js"

// --- /admin: dev-only tools. Only routed and linked under the dev server.

const AdminPage = () => {
	return (
		<PageShell>
			<div className="Admin">
				<h1>Admin</h1>
				<KHLAccessCard />
				<ProdDataCard />
				<StatesDemo />
				<SimulatedLoadingPicker />
				<BenchmarkRunner />
			</div>
		</PageShell>
	)
}

type KHLAccess = "online" | "offline"

const KHL_ACCESS_OPTIONS: {value: KHLAccess; label: string}[] = [
	{value: "online", label: "Online"},
	{value: "offline", label: "Offline"},
]

/** Offline mode, and whether the background sync loop runs */
const KHLAccessCard = () => {
	const state = useAsync(() => doRequest(GET_DEV_SETTINGS_ENDPOINT, {}), [])
	return (
		<Card title="KHL access">
			<AsyncContent
				state={state}
				size="inline"
				errorTitle="Couldn't load dev settings"
			>
				{(settings) => <KHLAccessPicker initial={settings} />}
			</AsyncContent>
		</Card>
	)
}

const KHLAccessPicker = ({initial}: {initial: DevSettingsResponse}) => {
	const [settings, setSettings] = React.useState(initial)
	const [error, setError] = React.useState<Error | null>(null)
	const update = (access: KHLAccess) => {
		setError(null)
		doRequest(UPDATE_DEV_SETTINGS_ENDPOINT, {
			offline: matchValue(access, {online: false, offline: true}),
		}).then(setSettings, (cause) => setError(toError(cause)))
	}
	return (
		<>
			<p className="Admin-note">
				Offline, the server never fetches from the KHL or LiveBarn: it
				serves pages it has stored, and a page it hasn't comes back as
				unavailable. Kept across restarts.
			</p>
			<p className="Admin-note">
				{settings.syncLoop
					? "The background sync loop is running (KHL_SYNC=1). It pauses while offline."
					: "The background sync loop is off; set KHL_SYNC=1 to run it. Pages still sync when they're first viewed."}
			</p>
			<SegmentedControl<KHLAccess>
				label="KHL access"
				options={KHL_ACCESS_OPTIONS}
				value={settings.offline ? "offline" : "online"}
				onChange={update}
			/>
			{error && (
				<ErrorState
					title="Couldn't update dev settings"
					error={error}
					size="inline"
				/>
			)}
		</>
	)
}

type ProdDataScope = "tables" | "everything"

const PROD_DATA_SCOPE_OPTIONS: {value: ProdDataScope; label: string}[] = [
	{value: "tables", label: "League tables"},
	{value: "everything", label: "Tables and pages"},
]

type PullState =
	| {kind: "idle"}
	| {kind: "running"}
	| {kind: "done"; result: PullProdDataResponse}
	| {kind: "error"; error: Error}

/** Replaces dev's data with production's, so dev needn't fetch it */
const ProdDataCard = () => {
	const [scope, setScope] = React.useState<ProdDataScope>("tables")
	const [state, setState] = React.useState<PullState>({kind: "idle"})
	const pull = () => {
		setState({kind: "running"})
		doRequest(PULL_PROD_DATA_ENDPOINT, {
			sources: matchValue(scope, {tables: false, everything: true}),
		}).then(
			(result) => setState({kind: "done", result}),
			(error) => setState({kind: "error", error: toError(error)}),
		)
	}
	const isRunning = matchValue(state.kind, {
		idle: false,
		running: true,
		done: false,
		error: false,
	})
	const outcome = matchField(state, "kind", {
		idle: () => null,
		running: () => (
			<div className="Admin-preview">
				<InlineLoader label="Pulling production's data…" />
			</div>
		),
		error: ({error}) => (
			<ErrorState
				title="Couldn't pull production's data"
				error={error}
				onRetry={pull}
				size="inline"
			/>
		),
		done: ({result}) => (
			<p className="Admin-note">
				Pulled{" "}
				{result.pulled
					.map((db) => `${db.name}.sqlite (${db.mb} MB)`)
					.join(" and ")}{" "}
				in {formatSeconds(result.ms)}. The previous dev database is at{" "}
				<code>{result.backupPath}</code>.
			</p>
		),
	})
	return (
		<Card title="Production data">
			<p className="Admin-note">
				Replaces this server's data with a snapshot of production's,
				through your <code>fly auth login</code> session. The league
				tables and player ids are a few MB. The stored pages are 1.5–3
				GB and are only needed to reprocess after a parser change.
			</p>
			<SegmentedControl<ProdDataScope>
				label="What to pull"
				options={PROD_DATA_SCOPE_OPTIONS}
				value={scope}
				onChange={setScope}
			/>
			<div className="Admin-actions">
				<button
					type="button"
					className="FilterPill"
					disabled={isRunning}
					onClick={pull}
				>
					Pull production's data
				</button>
			</div>
			{outcome}
		</Card>
	)
}

type StateDemo =
	| "page-loader"
	| "inline-loader"
	| "not-found"
	| "page-error"
	| "inline-error"
	| "offline"

const STATE_DEMO_OPTIONS: {value: StateDemo; label: string}[] = [
	{value: "page-loader", label: "Page loader"},
	{value: "inline-loader", label: "Inline loader"},
	{value: "not-found", label: "Not found"},
	{value: "page-error", label: "Page error"},
	{value: "inline-error", label: "Inline error"},
	{value: "offline", label: "Offline"},
]

/**
 * Previews either loader (for a few seconds or until stopped), the not-found
 * page, and ErrorState with sample errors.
 */
const StatesDemo = () => {
	const [demo, setDemo] = React.useState<StateDemo>("page-loader")
	const [loading, setLoading] = React.useState<"timed" | "hang" | null>(null)
	const [runs, setRuns] = React.useState(0)
	React.useEffect(() => {
		const isTimed =
			loading !== null && matchValue(loading, {timed: true, hang: false})
		if (!isTimed) {
			return
		}
		const timer = setTimeout(
			() => setLoading(null),
			SIMULATED_LOADING_DELAY_MS,
		)
		return () => clearTimeout(timer)
	}, [loading, runs])
	// Made once, so ErrorState logs each sample only when it's first shown
	const errors = React.useMemo(
		() => ({
			server: new FetchError(
				"Sample 502 from /admin",
				"GET",
				"/api/admin/sample",
				502,
			),
			offline: new FetchError(
				"Sample network failure from /admin",
				"GET",
				"/api/admin/sample",
				null,
			),
		}),
		[],
	)
	const isLoader = matchValue(demo, {
		"page-loader": true,
		"inline-loader": true,
		"not-found": false,
		"page-error": false,
		"inline-error": false,
		offline: false,
	})
	const start = (mode: "timed" | "hang") => {
		setLoading(mode)
		setRuns((n) => n + 1)
	}
	const renderLoader = (loader: React.ReactNode) =>
		loading ? (
			loader
		) : (
			<p className="Admin-note">
				{runs ? "Loaded." : "Pick a button to show the loader."}
			</p>
		)
	const preview = matchFn(demo, {
		// Keyed so each run replays the loader's fade-in
		"page-loader": () => renderLoader(<PageLoader key={runs} />),
		"inline-loader": () => renderLoader(<InlineLoader key={runs} />),
		"not-found": () => <NotFoundState size="inline" />,
		"page-error": () => (
			<ErrorState
				key="page-error"
				title="Couldn't load this page"
				error={errors.server}
				onRetry={() => {}}
			/>
		),
		"inline-error": () => (
			<ErrorState
				key="inline-error"
				title="Couldn't load upcoming games"
				error={errors.server}
				onRetry={() => {}}
				size="inline"
			/>
		),
		offline: () => (
			<ErrorState
				key="offline"
				title="Couldn't load this page"
				error={errors.offline}
				onRetry={() => {}}
			/>
		),
	})
	return (
		<Card title="Loading and error states">
			<p className="Admin-note">
				Errors are real ErrorStates, so showing one logs it like any
				other.
			</p>
			<SegmentedControl<StateDemo>
				label="State"
				options={STATE_DEMO_OPTIONS}
				value={demo}
				onChange={setDemo}
			/>
			{isLoader && (
				<div className="Admin-actions">
					<button
						type="button"
						className="FilterPill"
						onClick={() => start("timed")}
					>
						Load for {SIMULATED_LOADING_DELAY_MS / 1000}s
					</button>
					<button
						type="button"
						className="FilterPill"
						onClick={() => start("hang")}
					>
						Load forever
					</button>
					<button
						type="button"
						className="FilterPill"
						disabled={!loading}
						onClick={() => setLoading(null)}
					>
						Stop
					</button>
				</div>
			)}
			<div className="Admin-preview">{preview}</div>
		</Card>
	)
}

const SIMULATED_LOADING_OPTIONS: {value: SimulatedLoading; label: string}[] = [
	{value: "off", label: "Off"},
	{value: "slow", label: `${SIMULATED_LOADING_DELAY_MS / 1000}s delay`},
	{value: "hang", label: "Never finish"},
]

/** Slows down every page's data loads, to see real pages while loading. */
const SimulatedLoadingPicker = () => {
	const [mode, setMode] = React.useState(readSimulatedLoading)
	return (
		<Card title="Simulate slow loading">
			<p className="Admin-note">
				Applies to every page's data loads until you turn it off or
				close the tab.
			</p>
			<SegmentedControl<SimulatedLoading>
				label="Simulate slow loading"
				options={SIMULATED_LOADING_OPTIONS}
				value={mode}
				onChange={(next) => {
					writeSimulatedLoading(next)
					setMode(next)
				}}
			/>
		</Card>
	)
}

type BenchmarkState =
	| {kind: "idle"}
	| {kind: "running"}
	| {kind: "done"; result: BenchmarkResponse}
	| {kind: "error"; error: Error}

/** One column per step, for both the medians and the individual runs. */
function timingColumns<T>(
	getTiming: (row: T) => BenchmarkTiming | null,
): StatsTableColumn<T>[] {
	const steps: [
		step: keyof BenchmarkTiming,
		header: string,
		title: string,
	][] = [
		["open", "Open", "Until the search box shows"],
		["results", "Results", "From typing the name until a result shows"],
		["player", "Player", "From opening the result until stats show"],
		["total", "Total", "Open, search, and load the player"],
	]
	return steps.map(([step, header, title]) => ({
		header,
		title,
		render: (row: T) => {
			const timing = getTiming(row)
			return timing ? formatSeconds(timing[step]) : "–"
		},
	}))
}

const SUMMARY_COLUMNS: StatsTableColumn<BenchmarkSummary>[] = [
	{
		header: "Site",
		isLabel: true,
		render: (summary) => BENCHMARK_SITE_LABELS[summary.site],
	},
	...timingColumns<BenchmarkSummary>((summary) => summary.median),
	{
		header: "Runs",
		title: "Successful runs in the median",
		render: (summary) => summary.runs,
	},
]

const RUN_COLUMNS: StatsTableColumn<BenchmarkRun>[] = [
	{header: "Player", isLabel: true, render: (run) => run.name},
	{
		header: "Site",
		isLabel: true,
		render: (run) =>
			run.error ? (
				<Hint label={run.error}>
					<span className="Admin-failed">
						{BENCHMARK_SITE_LABELS[run.site]} (failed)
					</span>
				</Hint>
			) : (
				BENCHMARK_SITE_LABELS[run.site]
			),
	},
	...timingColumns<BenchmarkRun>((run) => run.timing),
]

/** Times KHL+ against the league's site, with tools/Benchmark.ts. */
const BenchmarkRunner = () => {
	const [names, setNames] = React.useState(DEFAULT_BENCHMARK_NAMES.join("\n"))
	const [state, setState] = React.useState<BenchmarkState>({kind: "idle"})
	const nameList = names
		.split("\n")
		.map((name) => name.trim())
		.filter(Boolean)
	const run = () => {
		setState({kind: "running"})
		doRequest(RUN_BENCHMARK_ENDPOINT, {names: nameList}).then(
			(result) => setState({kind: "done", result}),
			(error) => setState({kind: "error", error: toError(error)}),
		)
	}
	const outcome = matchField(state, "kind", {
		idle: () => null,
		running: () => (
			<div className="Admin-preview">
				<InlineLoader />
			</div>
		),
		error: ({error}) => (
			<ErrorState
				title="Couldn't run the benchmark"
				error={error}
				onRetry={run}
				size="inline"
			/>
		),
		done: ({result}) => (
			<div className="Admin-results">
				<StatsTable
					rows={result.summaries}
					rowKey={(summary) => summary.site}
					columns={SUMMARY_COLUMNS}
				/>
				<StatsTable
					rows={result.runs}
					rowKey={(run) => `${run.name}:${run.site}`}
					columns={RUN_COLUMNS}
				/>
			</div>
		),
	})
	return (
		<Card title="Speed benchmark">
			<p className="Admin-note">
				Opens khl.dvdzkwsk.com and the league's player search in
				headless Chrome, searches each player, and opens their page.
				Every run starts with an empty browser cache, but KHL+ caches on
				its server: a player's first run is cold, so run again for warm
				times. Takes about 5–15s per player.
			</p>
			<textarea
				className="Admin-names"
				aria-label="Player names, one per line"
				rows={DEFAULT_BENCHMARK_NAMES.length}
				value={names}
				onChange={(e) => setNames(e.target.value)}
			/>
			<div className="Admin-actions">
				<button
					type="button"
					className="FilterPill"
					disabled={
						matchValue(state.kind, {
							idle: false,
							running: true,
							done: false,
							error: false,
						}) || !nameList.length
					}
					onClick={run}
				>
					Run benchmark
				</button>
			</div>
			{outcome}
		</Card>
	)
}

export const AdminRoute = {
	path: "/admin",
	title: "Admin",
	content: AdminPage,
} as const satisfies Route
