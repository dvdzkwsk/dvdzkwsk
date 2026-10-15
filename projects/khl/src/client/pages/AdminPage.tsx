import * as React from "react"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {
	BENCHMARK_SITE_LABELS,
	BenchmarkResponse,
	BenchmarkRun,
	BenchmarkSummary,
	BenchmarkTiming,
	DEFAULT_BENCHMARK_NAMES,
	RUN_BENCHMARK_ENDPOINT,
} from "../../shared/ApiJson.js"
import {
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
	writeSimulatedLoading,
} from "../Util.js"

// --- /admin: dev-only tools. Only routed and linked under the dev server.

const AdminPage = () => {
	return (
		<PageShell>
			<div className="Admin">
				<h1>Admin</h1>
				<LoaderDemo />
				<ErrorStatesDemo />
				<SimulatedLoadingPicker />
				<BenchmarkRunner />
			</div>
		</PageShell>
	)
}

type LoaderKind = "page" | "inline"

const LOADER_KIND_OPTIONS: {value: LoaderKind; label: string}[] = [
	{value: "page", label: "Page"},
	{value: "inline", label: "Inline"},
]

/** Shows either loader in place, for a few seconds or until stopped. */
const LoaderDemo = () => {
	const [kind, setKind] = React.useState<LoaderKind>("page")
	const [loading, setLoading] = React.useState<"timed" | "hang" | null>(null)
	const [runs, setRuns] = React.useState(0)
	React.useEffect(() => {
		if (loading !== "timed") {
			return
		}
		const timer = setTimeout(
			() => setLoading(null),
			SIMULATED_LOADING_DELAY_MS,
		)
		return () => clearTimeout(timer)
	}, [loading, runs])
	const start = (mode: "timed" | "hang") => {
		setLoading(mode)
		setRuns((n) => n + 1)
	}
	return (
		<section className="Detail-panel">
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				Loaders
			</h2>
			<SegmentedControl<LoaderKind>
				label="Loader"
				options={LOADER_KIND_OPTIONS}
				value={kind}
				onChange={setKind}
			/>
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
			<div className="Admin-preview">
				{loading ? (
					// Keyed so each run replays the loader's fade-in
					kind === "page" ? (
						<PageLoader key={runs} />
					) : (
						<InlineLoader key={runs} />
					)
				) : (
					<p className="Admin-note">
						{runs ? "Loaded." : "Pick a button to show the loader."}
					</p>
				)}
			</div>
		</section>
	)
}

type ErrorStateDemo = "not-found" | "page" | "inline" | "offline"

const ERROR_STATE_OPTIONS: {value: ErrorStateDemo; label: string}[] = [
	{value: "not-found", label: "Not found"},
	{value: "page", label: "Page error"},
	{value: "inline", label: "Inline error"},
	{value: "offline", label: "Offline"},
]

/** Previews the not-found page and ErrorState, with sample errors. */
const ErrorStatesDemo = () => {
	const [demo, setDemo] = React.useState<ErrorStateDemo>("not-found")
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
	return (
		<section className="Detail-panel">
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				Error states
			</h2>
			<p className="Admin-note">
				Errors are real ErrorStates, so showing one logs it like any
				other.
			</p>
			<SegmentedControl<ErrorStateDemo>
				label="Error state"
				options={ERROR_STATE_OPTIONS}
				value={demo}
				onChange={setDemo}
			/>
			<div className="Admin-preview">
				{demo === "not-found" && <NotFoundState size="inline" />}
				{demo === "page" && (
					<ErrorState
						title="Couldn't load this page"
						error={errors.server}
						onRetry={() => {}}
					/>
				)}
				{demo === "inline" && (
					<ErrorState
						title="Couldn't load upcoming games"
						error={errors.server}
						onRetry={() => {}}
						size="inline"
					/>
				)}
				{demo === "offline" && (
					<ErrorState
						title="Couldn't load this page"
						error={errors.offline}
						onRetry={() => {}}
					/>
				)}
			</div>
		</section>
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
		<section className="Detail-panel">
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				Simulate slow loading
			</h2>
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
		</section>
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
		["total", "Total", "Open, search and load the player"],
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
	return (
		<section className="Detail-panel">
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				Speed benchmark
			</h2>
			<p className="Admin-note">
				Opens khl.dvdzkwsk.com and the league's player search in
				headless Chrome, searches each player and opens their page.
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
					disabled={state.kind === "running" || !nameList.length}
					onClick={run}
				>
					Run benchmark
				</button>
			</div>
			{state.kind === "running" && (
				<div className="Admin-preview">
					<InlineLoader />
				</div>
			)}
			{state.kind === "error" && (
				<ErrorState
					title="Couldn't run the benchmark"
					error={state.error}
					onRetry={run}
					size="inline"
				/>
			)}
			{state.kind === "done" && (
				<div className="Admin-results">
					<StatsTable
						rows={state.result.summaries}
						rowKey={(summary) => summary.site}
						columns={SUMMARY_COLUMNS}
					/>
					<StatsTable
						rows={state.result.runs}
						rowKey={(run) => `${run.name}:${run.site}`}
						columns={RUN_COLUMNS}
					/>
				</div>
			)}
		</section>
	)
}

export const AdminRoute = {
	path: "/admin",
	title: "Admin",
	content: AdminPage,
} as const satisfies Route
