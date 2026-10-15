import * as React from "react"
import {Toggle} from "@base-ui/react/toggle"
import {ToggleGroup} from "@base-ui/react/toggle-group"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {Loader, PageShell} from "../Components.js"
import {
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
				<SimulatedLoadingPicker />
			</div>
		</PageShell>
	)
}

/** Shows the page loader in place, for a few seconds or until stopped. */
const LoaderDemo = () => {
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
				Page loader
			</h2>
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
					<Loader key={runs} />
				) : (
					<p className="Admin-note">
						{runs ? "Loaded." : "Pick a button to show the loader."}
					</p>
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
			<ToggleGroup
				className="Segmented"
				aria-label="Simulate slow loading"
				value={[mode]}
				onValueChange={([next]) => {
					if (next) {
						writeSimulatedLoading(next as SimulatedLoading)
						setMode(next as SimulatedLoading)
					}
				}}
			>
				{SIMULATED_LOADING_OPTIONS.map((option) => (
					<Toggle
						key={option.value}
						className="Segmented-item"
						value={option.value}
					>
						{option.label}
					</Toggle>
				))}
			</ToggleGroup>
		</section>
	)
}

export const AdminRoute = {
	path: "/admin",
	title: "Admin",
	content: AdminPage,
} as const satisfies Route
