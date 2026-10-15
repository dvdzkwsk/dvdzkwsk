import * as React from "react"
import {Avatar} from "@base-ui/react/avatar"
import {Button} from "@base-ui/react/button"
import {Collapsible} from "@base-ui/react/collapsible"
import {Combobox} from "@base-ui/react/combobox"
import {Popover} from "@base-ui/react/popover"
import {Select} from "@base-ui/react/select"
import {Switch} from "@base-ui/react/switch"
import {Autocomplete} from "@base-ui/react/autocomplete"
import {Logger} from "@dvdzkwsk/logger"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {
	RosterPlayer,
	SEARCH_ENDPOINT,
	SearchResponse,
	TeamRoster,
} from "../shared/ApiJson.js"
import {getCity} from "../shared/Cities.js"
import {KHLSeason} from "../shared/KHLJson.js"
import {STRINGS} from "../shared/KHLConfig.js"
import {
	AppContext,
	AsyncState,
	describeError,
	getPlayerHref,
	getRinkHref,
	getTeamHref,
	useAsync,
	useLocation,
} from "./Util.js"

// --- Links

type LinkProps = React.HTMLAttributes<HTMLAnchorElement> & {href: string}

export const Link = (props: LinkProps) => {
	const {history} = React.useContext(AppContext)

	if (typeof props.href === "string" && props.href.startsWith("http")) {
		return <a {...props} rel="noopener noreferrer" target="_blank" />
	}
	return (
		<a
			{...props}
			onClick={(e) => {
				if (!e.ctrlKey && !e.metaKey) {
					e.preventDefault()
					history.push(props.href)
				}
			}}
		/>
	)
}

interface TeamLinkProps {
	team: {id: string; name: string}
	/** Team ids are reused across seasons; this picks which season to show */
	seasonId: string
	className?: string
}

/** A team name linking to its /teams/:id page. Inherits surrounding styles. */
export const TeamLink = ({team, seasonId, className}: TeamLinkProps) => {
	return (
		<Link
			className={cx("InlineLink", className)}
			href={getTeamHref({id: team.id, seasonId})}
		>
			{team.name}
		</Link>
	)
}

interface RinkLinkProps {
	arena: {id: string; name: string}
	className?: string
}

/** A rink name linking to its /rinks/:id page. Inherits surrounding styles. */
export const RinkLink = ({arena, className}: RinkLinkProps) => {
	return (
		<Link
			className={cx("InlineLink", className)}
			href={getRinkHref(arena.id)}
		>
			{arena.name}
		</Link>
	)
}

// --- TeamAvatar

interface TeamAvatarProps {
	name: string
	logoUrl: string | null
	size?: number
}

/** A team logo, falling back to initials when it's missing or broken. */
export const TeamAvatar = ({name, logoUrl, size = 36}: TeamAvatarProps) => {
	return (
		<Avatar.Root
			className="TeamAvatar"
			style={{"--TeamAvatar-size": `${size}px`} as React.CSSProperties}
		>
			{logoUrl && (
				<Avatar.Image
					className="TeamAvatar-image"
					src={logoUrl}
					alt=""
				/>
			)}
			<Avatar.Fallback className="TeamAvatar-fallback">
				{getInitials(name)}
			</Avatar.Fallback>
		</Avatar.Root>
	)
}

function getInitials(name: string): string {
	return name
		.split(/\s+/)
		.filter((word) => /^[A-Za-z]/.test(word))
		.slice(0, 2)
		.map((word) => word[0]!.toUpperCase())
		.join("")
}

// --- CityDot

export const CityDot = ({city}: {city: string}) => {
	return (
		<span
			className="FilterPill-dot"
			style={{background: getCity(city)?.color ?? "var(--subtle-fg)"}}
			aria-hidden
		/>
	)
}

// --- StatsTable

export interface StatsTableColumn<T> {
	header: string
	/** Tooltip for the header, e.g. "Goals against average" for "GAA" */
	title?: string
	/** Left-aligned text column instead of a right-aligned number */
	isLabel?: boolean
	render: (row: T) => React.ReactNode
}

interface StatsTableProps<T> {
	columns: StatsTableColumn<T>[]
	rows: T[]
	rowKey: (row: T) => string
	rowClassName?: (row: T) => string | undefined
}

export function StatsTable<T>({
	columns,
	rows,
	rowKey,
	rowClassName,
}: StatsTableProps<T>) {
	return (
		<div className="StatsTable-wrapper">
			<table className="StatsTable">
				<thead>
					<tr>
						{columns.map((column) => (
							<th
								key={column.header}
								title={column.title}
								className={
									column.isLabel
										? "StatsTable-label"
										: undefined
								}
							>
								{column.header}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={rowKey(row)} className={rowClassName?.(row)}>
							{columns.map((column) => (
								<td
									key={column.header}
									className={
										column.isLabel
											? "StatsTable-label"
											: undefined
									}
								>
									{column.render(row)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

// --- Roster

/** Skater and goalie columns to show, from the league's stats tables. */
const SKATER_COLUMNS = ["GP", "G", "A", "PTS", "PIM"]
const GOALIE_COLUMNS = ["GP", "W", "L", "T", "GAA", "SV%"]

/** A team's skaters, by points, then its goalies. */
export const RosterTables = ({
	roster,
	skaterLimit,
}: {
	roster: TeamRoster
	/** Show only the top skaters, e.g. for a leaders table */
	skaterLimit?: number
}) => {
	const {skaters, goalies} = roster
	if (skaters.length === 0 && goalies.length === 0) {
		return <p className="Detail-empty">No roster for this season.</p>
	}
	const points = (p: RosterPlayer) => Number(p.stats["PTS"]) || 0
	const goals = (p: RosterPlayer) => Number(p.stats["G"]) || 0
	const sortedSkaters = [...skaters]
		.sort(
			(a, b) =>
				points(b) - points(a) ||
				goals(b) - goals(a) ||
				a.name.localeCompare(b.name),
		)
		.slice(0, skaterLimit)
	return (
		<>
			<RosterTable players={sortedSkaters} columns={SKATER_COLUMNS} />
			{goalies.length > 0 && (
				<>
					<h3 className={cx("SectionLabel", "Detail-subtitle")}>
						Goalies
					</h3>
					<RosterTable players={goalies} columns={GOALIE_COLUMNS} />
				</>
			)}
		</>
	)
}

const RosterTable = ({
	players,
	columns,
}: {
	players: RosterPlayer[]
	columns: string[]
}) => {
	const tableColumns: StatsTableColumn<RosterPlayer>[] = [
		{header: "#", isLabel: true, render: (p) => p.number ?? ""},
		{
			header: "Player",
			isLabel: true,
			render: (p) => (
				<Link className="InlineLink" href={getPlayerHref(p.playerId)}>
					{p.name}
				</Link>
			),
		},
		...columns.map((column) => ({
			header: column,
			render: (p: RosterPlayer) => p.stats[column] ?? "",
		})),
	]
	return (
		<StatsTable
			rows={players}
			rowKey={(p) => p.khlPlayerId}
			columns={tableColumns}
		/>
	)
}

interface RosterPanelTeam {
	team: {id: string; name: string; logoUrl: string | null; seasonId: string}
	roster: TeamRoster
	/** Shown before "Roster", e.g. the season when two sides' differ */
	note?: string
	/** On hover over the label */
	title?: string
}

/** Each team's roster in its own panel, side by side (games, matchups). */
export const RosterPanels = ({teams}: {teams: RosterPanelTeam[]}) => {
	return (
		<div className="GamePage-rosters">
			{teams.map(({team, roster, note, title}) => (
				<section
					key={`${team.id}:${team.seasonId}`}
					className="Detail-panel"
				>
					<h2
						className={cx(
							"Detail-panel-title",
							"GamePage-roster-title",
						)}
					>
						<TeamAvatar
							name={team.name}
							logoUrl={team.logoUrl}
							size={24}
						/>
						<TeamLink team={team} seasonId={team.seasonId} />
						<span className="SectionLabel" title={title}>
							{note && `${note} · `}
							Roster ·{" "}
							{roster.skaters.length + roster.goalies.length}
						</span>
					</h2>
					<RosterTables roster={roster} />
				</section>
			))}
		</div>
	)
}

// --- Picker

export interface PickerItem {
	value: string
	label: string
	/** e.g. a team logo */
	icon?: React.ReactNode
	/** Muted text after the label */
	hint?: string
	disabled?: boolean
}

export interface PickerGroup {
	/** Shown above the group's items; empty for none */
	label: string
	items: PickerItem[]
}

/** Lists at least this long get a search box */
const PICKER_SEARCH_MIN_ITEMS = 10

interface PickerProps {
	groups: PickerGroup[]
	value: string | null
	onChange: (value: string) => void
	placeholder: string
	/** Shown in the trigger instead of the selected item's label */
	triggerLabel?: React.ReactNode
	/** For the trigger, which is a FilterPill */
	className?: string
	disabled?: boolean
	title?: string
}

/**
 * A dropdown for picking one item. Short lists are a plain select (type to
 * jump); long ones add a search box above the list.
 */
export const Picker = (props: PickerProps) => {
	const count = props.groups.reduce((n, g) => n + g.items.length, 0)
	return count >= PICKER_SEARCH_MIN_ITEMS ? (
		<SearchablePicker {...props} />
	) : (
		<SimplePicker {...props} />
	)
}

const PickerItemContent = ({item}: {item: PickerItem}) => {
	return (
		<>
			<span className="SelectOption-check">✓</span>
			{item.icon}
			<span className="Picker-item-label">{item.label}</span>
			{item.hint && <span className="Detail-meta-hint">{item.hint}</span>}
		</>
	)
}

const SimplePicker = ({
	groups,
	value,
	onChange,
	placeholder,
	triggerLabel,
	className,
	disabled,
	title,
}: PickerProps) => {
	const items = groups.flatMap((g) =>
		g.items.map((i) => ({value: i.value, label: i.label})),
	)
	return (
		<Select.Root
			items={items}
			value={value}
			disabled={disabled}
			onValueChange={(next) => {
				if (next && next !== value) {
					onChange(next as string)
				}
			}}
		>
			<Select.Trigger
				className={cx("FilterPill", "Picker-trigger", className)}
				title={title}
			>
				{triggerLabel ?? (
					<Select.Value
						className="Picker-value"
						placeholder={placeholder}
					/>
				)}
				<Select.Icon>
					<ChevronIcon />
				</Select.Icon>
			</Select.Trigger>
			<Select.Portal>
				<Select.Positioner sideOffset={6} alignItemWithTrigger={false}>
					<Select.Popup className="SelectPopup">
						<Select.List>
							{groups.map((group, i) => (
								<Select.Group key={group.label || i}>
									{group.label && (
										<Select.GroupLabel className="Picker-group-label">
											{group.label}
										</Select.GroupLabel>
									)}
									{group.items.map((item) => (
										<Select.Item
											key={item.value}
											value={item.value}
											disabled={item.disabled}
											className="SelectOption"
										>
											<PickerItemContent item={item} />
										</Select.Item>
									))}
								</Select.Group>
							))}
						</Select.List>
					</Select.Popup>
				</Select.Positioner>
			</Select.Portal>
		</Select.Root>
	)
}

const SearchablePicker = ({
	groups,
	value,
	onChange,
	placeholder,
	triggerLabel,
	className,
	disabled,
	title,
}: PickerProps) => {
	const selected =
		groups.flatMap((g) => g.items).find((i) => i.value === value) ?? null
	return (
		<Combobox.Root
			items={groups}
			value={selected}
			disabled={disabled}
			autoHighlight
			isItemEqualToValue={(a: PickerItem, b: PickerItem) =>
				a.value === b.value
			}
			onValueChange={(item: PickerItem | null) => {
				if (item && item.value !== value) {
					onChange(item.value)
				}
			}}
		>
			<Combobox.Trigger
				className={cx("FilterPill", "Picker-trigger", className)}
				title={title}
			>
				{triggerLabel ?? (
					<span className="Picker-value">
						<Combobox.Value placeholder={placeholder} />
					</span>
				)}
				<Combobox.Icon>
					<ChevronIcon />
				</Combobox.Icon>
			</Combobox.Trigger>
			<Combobox.Portal>
				<Combobox.Positioner sideOffset={6} align="start">
					<Combobox.Popup
						className={cx("SelectPopup", "Picker-popup")}
					>
						<div className="Picker-search">
							<SearchIcon className="Picker-search-icon" />
							<Combobox.Input
								className="Picker-search-input"
								placeholder="Search"
								aria-label="Search"
							/>
						</div>
						<Combobox.Empty className="Picker-empty">
							No matches.
						</Combobox.Empty>
						<Combobox.List className="Picker-list">
							{(group: PickerGroup, i: number) => (
								<Combobox.Group
									key={group.label || i}
									items={group.items}
								>
									{group.label && (
										<Combobox.GroupLabel className="Picker-group-label">
											{group.label}
										</Combobox.GroupLabel>
									)}
									<Combobox.Collection>
										{(item: PickerItem) => (
											<Combobox.Item
												key={item.value}
												value={item}
												disabled={item.disabled}
												className="SelectOption"
											>
												<PickerItemContent
													item={item}
												/>
											</Combobox.Item>
										)}
									</Combobox.Collection>
								</Combobox.Group>
							)}
						</Combobox.List>
					</Combobox.Popup>
				</Combobox.Positioner>
			</Combobox.Portal>
		</Combobox.Root>
	)
}

// --- PageShell

export const PageShell = ({children}: {children: React.ReactNode}) => {
	return <main className="PageShell">{children}</main>
}

/** Renders loading/error states, or `children` once the data has loaded. */
export function AsyncContent<T>({
	state,
	errorTitle = "Couldn't load this page",
	children,
}: {
	state: AsyncState<T>
	errorTitle?: string
	children: (data: T) => React.ReactNode
}) {
	if (state.status === "loading") {
		return <div className="PageShell-message">Loading…</div>
	}
	if (state.status === "error") {
		return (
			<ErrorState
				title={errorTitle}
				error={state.error}
				onRetry={state.reload}
			/>
		)
	}
	return <>{children(state.data)}</>
}

// --- Errors

const errorLogger = new Logger("ErrorState")

interface ErrorStateProps {
	/** What failed, e.g. "Couldn't load upcoming games" */
	title: string
	error: Error
	onRetry?: () => void
	/** "inline" for errors inside a section, "page" for whole-page failures */
	size?: "inline" | "page"
}

/**
 * Explains a failure in plain language, with the technical details tucked
 * away. Every time one is shown, it's logged.
 */
export const ErrorState = ({
	title,
	error,
	onRetry,
	size = "page",
}: ErrorStateProps) => {
	React.useEffect(() => {
		errorLogger.error("render", "showed an error to the user", {
			title,
			error,
		})
	}, [title, error])

	return (
		<div className={cx("ErrorState", `ErrorState--${size}`)} role="alert">
			<AlertIcon />
			<div className="ErrorState-body">
				<div className="ErrorState-title">{title}</div>
				<p className="ErrorState-description">{describeError(error)}</p>
				<div className="ErrorState-actions">
					{onRetry && (
						<Button className="ErrorState-retry" onClick={onRetry}>
							Try again
						</Button>
					)}
					<Collapsible.Root className="ErrorState-collapsible">
						<Collapsible.Trigger className="ErrorState-details-toggle">
							Details
							<ChevronIcon />
						</Collapsible.Trigger>
						<Collapsible.Panel className="ErrorState-details">
							<code>{error.message}</code>
						</Collapsible.Panel>
					</Collapsible.Root>
				</div>
			</div>
		</div>
	)
}

/**
 * Shows an ErrorState instead of a blank page when rendering throws. React
 * reports the error itself (see createRoot's onCaughtError in App.tsx).
 */
export class ErrorBoundary extends React.Component<
	{children: React.ReactNode},
	{error: Error | null}
> {
	state: {error: Error | null} = {error: null}

	static getDerivedStateFromError(error: unknown) {
		return {
			error: error instanceof Error ? error : new Error(String(error)),
		}
	}

	render() {
		if (this.state.error) {
			return (
				<PageShell>
					<ErrorState
						title="Something went wrong on this page"
						error={this.state.error}
						onRetry={() => this.setState({error: null})}
					/>
				</PageShell>
			)
		}
		return this.props.children
	}
}

const AlertIcon = () => {
	return (
		<svg
			className="ErrorState-icon"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			aria-hidden
		>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 7v6" />
			<path d="M12 16.5v.5" />
		</svg>
	)
}

// --- FilterBar

/** A stack of labelled filter rows, e.g. "Days", "Rinks", "Division". */
export const FilterBar = ({children}: {children: React.ReactNode}) => {
	return <div className="FilterBar">{children}</div>
}

interface FilterRowProps {
	label: string
	children: React.ReactNode
}

export const FilterRow = ({label, children}: FilterRowProps) => {
	return (
		<div className="FilterBar-row" role="group" aria-label={label}>
			<span className="FilterBar-label">{label}</span>
			<div className="FilterBar-controls">{children}</div>
		</div>
	)
}

interface SeasonFilterProps {
	/** Newest first */
	seasons: KHLSeason[]
	value: string
	onChange: (seasonId: string) => void
}

/** A filter row for picking a league season. */
export const SeasonFilter = ({seasons, value, onChange}: SeasonFilterProps) => {
	return (
		<FilterRow label="Season">
			<Picker
				groups={[
					{
						label: "",
						items: seasons.map((s) => ({
							value: s.id,
							label: s.name,
						})),
					},
				]}
				value={value}
				onChange={onChange}
				placeholder="Season"
				className="Detail-select"
			/>
		</FilterRow>
	)
}

// --- Icons

/** Down chevron for select and menu triggers */
export const ChevronIcon = () => {
	return (
		<svg
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden
		>
			<path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
		</svg>
	)
}

// --- Site header

/** Brand (home link), search and nav, on every page. */
export const SiteHeader = () => {
	return (
		<header className="SiteHeader">
			<div className="SiteHeader-inner">
				<Link className="SiteHeader-brand" href="/">
					{STRINGS.PRODUCT_NAME}
				</Link>
				<SiteSearch />
				<div className="SiteHeader-end">
					<SiteNav />
					<ThemeSwitch />
				</div>
			</div>
		</header>
	)
}

const NAV_ITEMS = [
	{href: "/teams", label: "Teams"},
	{href: "/standings", label: "Standings"},
	{href: "/matchup", label: "Matchup"},
]

/** Top-level pages besides home, in the header. */
const SiteNav = () => {
	const location = useLocation()
	return (
		<nav className="SiteNav">
			{NAV_ITEMS.map((item) => (
				<Link
					key={item.href}
					className={cx(
						"SiteNav-link",
						// A team page is under Teams too
						(location.pathname === item.href ||
							location.pathname.startsWith(item.href + "/")) &&
							"SiteNav-link--active",
					)}
					href={item.href}
				>
					{item.label}
				</Link>
			))}
		</nav>
	)
}

// --- Theme

type Theme = "light" | "dark"

const THEME_STORAGE_KEY = "khl-theme"
function writeStorage(key: string, value: string | null) {
	try {
		if (value === null) {
			localStorage.removeItem(key)
		} else {
			localStorage.setItem(key, value)
		}
	} catch {
		// Not persisted; the choice still applies until the page reloads
	}
}

/** Keep in sync with the inline script in index.html. */
function applyTheme(theme: Theme) {
	document.documentElement.dataset.theme = theme
}

/**
 * Sun/moon switch. Starts from the OS setting (see index.html); flipping it
 * saves the choice.
 */
const ThemeSwitch = () => {
	const [theme, setTheme] = React.useState<Theme>(() => {
		return document.documentElement.dataset.theme === "dark"
			? "dark"
			: "light"
	})
	return (
		<Switch.Root
			className="ThemeSwitch"
			checked={theme === "dark"}
			onCheckedChange={(dark) => {
				const next: Theme = dark ? "dark" : "light"
				applyTheme(next)
				writeStorage(THEME_STORAGE_KEY, next)
				setTheme(next)
			}}
			aria-label="Dark mode"
			title={
				theme === "dark"
					? "Switch to light mode"
					: "Switch to dark mode"
			}
		>
			<SunIcon />
			<MoonIcon />
			<Switch.Thumb className="ThemeSwitch-thumb" />
		</Switch.Root>
	)
}

const SunIcon = () => {
	return (
		<svg
			className="ThemeSwitch-icon ThemeSwitch-icon--sun"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			aria-hidden
		>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
		</svg>
	)
}

const MoonIcon = () => {
	return (
		<svg
			className="ThemeSwitch-icon ThemeSwitch-icon--moon"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
		</svg>
	)
}

type SuggestionKind = "player" | "team" | "rink"

/** One autocomplete suggestion, whatever kind of thing it points to. */
interface Suggestion {
	key: string
	kind: SuggestionKind
	label: string
	detail: string
	href: string
	/** Team logo, for players and teams */
	logoUrl: string | null
	/** CityId, for rinks */
	city: string | null
}

const SUGGESTION_LIMITS: Record<SuggestionKind, number> = {
	player: 6,
	team: 5,
	rink: 4,
}

function toSuggestions(response: SearchResponse): Suggestion[] {
	const players = response.players.map((player): Suggestion => {
		const teams = player.registrations.map((r) => r.teamName)
		return {
			key: `player:${player.playerId}`,
			kind: "player",
			label: player.name,
			detail:
				teams.slice(0, 2).join(" · ") +
				(teams.length > 2 ? ` +${teams.length - 2}` : ""),
			href: getPlayerHref(player.playerId),
			logoUrl: player.registrations[0]?.teamLogoUrl ?? null,
			city: null,
		}
	})
	const teams = response.teams.map(({team, divisionName}): Suggestion => ({
		key: `team:${team.id}`,
		kind: "team",
		label: team.name,
		detail: divisionName,
		href: getTeamHref(team),
		logoUrl: team.logoUrl,
		city: null,
	}))
	const rinks = response.rinks.map((rink): Suggestion => {
		const city = getCity(rink.city)
		return {
			key: `rink:${rink.arenaId}`,
			kind: "rink",
			label: rink.name,
			detail: city ? `${city.name}, ${city.state}` : "",
			href: getRinkHref(rink.arenaId),
			logoUrl: null,
			city: rink.city,
		}
	})
	return [
		...players.slice(0, SUGGESTION_LIMITS.player),
		...teams.slice(0, SUGGESTION_LIMITS.team),
		...rinks.slice(0, SUGGESTION_LIMITS.rink),
	]
}

type SearchStatus =
	| {kind: "idle"}
	| {kind: "searching"}
	| {kind: "done"; query: string}
	| {kind: "error"; query: string; error: Error}

const searchLogger = new Logger("SiteSearch")

/**
 * Header search with autocomplete across players, teams, and rinks. Arrow
 * keys move through suggestions; Enter or a click opens one.
 */
const SiteSearch = () => {
	const {history} = React.useContext(AppContext)
	const location = useLocation()
	const [input, setInput] = React.useState("")
	const [suggestions, setSuggestions] = React.useState<Suggestion[]>([])
	const [status, setStatus] = React.useState<SearchStatus>({kind: "idle"})
	const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
	const latestQuery = React.useRef("")

	const search = (query: string) => {
		latestQuery.current = query
		if (timer.current) {
			clearTimeout(timer.current)
		}
		if (query.length < 2) {
			setSuggestions([])
			setStatus({kind: "idle"})
			return
		}
		setStatus({kind: "searching"})
		// Wait for a pause in typing; ignore responses for older queries
		timer.current = setTimeout(() => {
			doRequest(SEARCH_ENDPOINT, {q: query}).then(
				(response) => {
					if (latestQuery.current === query) {
						setSuggestions(toSuggestions(response))
						setStatus({kind: "done", query})
					}
				},
				(cause: unknown) => {
					const error =
						cause instanceof Error
							? cause
							: new Error(String(cause))
					searchLogger.error("search", "search failed", {
						query,
						error,
					})
					if (latestQuery.current === query) {
						setSuggestions([])
						setStatus({kind: "error", query, error})
					}
				},
			)
		}, 200)
	}

	// Leaving the page (e.g. after picking a suggestion) clears the search
	React.useEffect(() => {
		setInput("")
		setSuggestions([])
		setStatus({kind: "idle"})
		latestQuery.current = ""
	}, [location.pathname])

	const message =
		status.kind === "searching" && suggestions.length === 0
			? "Searching…"
			: status.kind === "done" && suggestions.length === 0
				? `No players, teams, or rinks match “${status.query}”.`
				: null

	return (
		<Autocomplete.Root
			items={suggestions}
			value={input}
			filter={null}
			autoHighlight
			itemToStringValue={(item: Suggestion) => item.label}
			onValueChange={(value, details) => {
				if (details.reason === "item-press") {
					// Clicks are handled by the item's own link (see below); this
					// is Enter on the highlighted item
					const picked = suggestions.find((s) => s.label === value)
					if (picked && details.event instanceof KeyboardEvent) {
						history.push(picked.href)
					}
					return
				}
				setInput(value)
				search(value.trim())
			}}
		>
			<div className="SiteSearch">
				<SearchIcon />
				<Autocomplete.Input
					className="SiteSearch-input"
					aria-label="Search players, teams, and rinks"
					placeholder="Search players, teams, and rinks"
				/>
			</div>
			<Autocomplete.Portal hidden={status.kind === "idle"}>
				<Autocomplete.Positioner
					className="SiteSearch-positioner"
					sideOffset={6}
					align="start"
				>
					<Autocomplete.Popup className="SiteSearch-popup">
						<Autocomplete.Status>
							{message && (
								<div className="SiteSearch-message">
									{message}
								</div>
							)}
						</Autocomplete.Status>
						{status.kind === "error" && (
							<ErrorState
								title={`Couldn't search for “${status.query}”`}
								error={status.error}
								onRetry={() => search(status.query)}
								size="inline"
							/>
						)}
						<Autocomplete.List className="SiteSearch-list">
							{(item: Suggestion) => (
								<Autocomplete.Item
									key={item.key}
									value={item}
									className="SiteSearch-item"
									// A real link, so it can be cmd+clicked or middle-clicked
									// into a new tab. Plain clicks navigate in-app instead.
									render={<a href={item.href} />}
									onClick={(e) => {
										// Modified clicks open a new tab natively
										if (!isNewTabClick(e)) {
											e.preventDefault()
											history.push(item.href)
										}
									}}
								>
									<SuggestionIcon suggestion={item} />
									<span className="SiteSearch-item-text">
										<span className="SiteSearch-item-label">
											{item.label}
										</span>
										{item.detail && (
											<span className="SiteSearch-item-detail">
												{item.detail}
											</span>
										)}
									</span>
									<span
										className={cx(
											"SiteSearch-kind",
											`SiteSearch-kind--${item.kind}`,
										)}
									>
										{SUGGESTION_KIND_LABELS[item.kind]}
									</span>
								</Autocomplete.Item>
							)}
						</Autocomplete.List>
					</Autocomplete.Popup>
				</Autocomplete.Positioner>
			</Autocomplete.Portal>
		</Autocomplete.Root>
	)
}

/** Clicks the browser turns into a new tab or window */
function isNewTabClick(event: React.MouseEvent): boolean {
	return event.metaKey || event.ctrlKey || event.shiftKey
}

const SUGGESTION_KIND_LABELS: Record<SuggestionKind, string> = {
	player: "Player",
	team: "Team",
	rink: "Rink",
}

/** Team logo, a person for players, or a pin in the city's color for rinks. */
const SuggestionIcon = ({suggestion}: {suggestion: Suggestion}) => {
	if (suggestion.kind === "team") {
		return (
			<TeamAvatar
				name={suggestion.label}
				logoUrl={suggestion.logoUrl}
				size={30}
			/>
		)
	}
	if (suggestion.kind === "rink") {
		return (
			<span
				className="SiteSearch-icon-circle"
				style={{color: getCity(suggestion.city ?? "")?.color}}
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden
				>
					<path d="M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0Z" />
					<circle cx="12" cy="10" r="3" />
				</svg>
			</span>
		)
	}
	return (
		<span className="SiteSearch-icon-circle">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				aria-hidden
			>
				<circle cx="12" cy="8" r="4" />
				<path d="M4 21a8 8 0 0 1 16 0" />
			</svg>
		</span>
	)
}

const SearchIcon = ({className = "SiteSearch-icon"}: {className?: string}) => {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			aria-hidden
		>
			<circle cx="11" cy="11" r="7" />
			<path d="m20 20-3.5-3.5" />
		</svg>
	)
}

// --- Home/away badge

interface HomeAwayBadgeProps {
	homeAway: "home" | "away"
	/** Just "H" or "A", for tight rows */
	truncated?: boolean
}

/** "Home" or "Away" beside a team name. */
export const HomeAwayBadge = ({homeAway, truncated}: HomeAwayBadgeProps) => {
	const label = homeAway === "home" ? "Home" : "Away"
	return (
		<span
			className={cx(
				"HomeAwayBadge",
				`HomeAwayBadge--${homeAway}`,
				truncated && "HomeAwayBadge--truncated",
			)}
			title={truncated ? label : undefined}
			aria-label={truncated ? label : undefined}
		>
			{truncated ? label[0] : label}
		</span>
	)
}

// --- LiveBarn

interface LiveBarnBadgeProps {
	href: string
	/** Shown instead of "LiveBarn" when a rink has several surfaces */
	surfaceName?: string
	title?: string
}

/** A pill linking out to a LiveBarn feed or replay. */
export const LiveBarnBadge = ({
	href,
	surfaceName,
	title,
}: LiveBarnBadgeProps) => {
	return (
		<Link className="LiveBarnBadge" href={href} title={title}>
			<CameraIcon />
			{surfaceName ?? "LiveBarn"} ↗
		</Link>
	)
}

/**
 * A LiveBarn badge for a rink without a feed: greyed out, with a popover
 * explaining why. Opens on hover, and on tap where there's no hover.
 */
export const NotOnLiveBarn = () => {
	return (
		<Popover.Root>
			<Popover.Trigger
				openOnHover
				delay={100}
				className={cx("LiveBarnBadge", "LiveBarnBadge--unavailable")}
				aria-disabled
				aria-label="LiveBarn unavailable for this rink"
			>
				<CameraIcon />
				LiveBarn
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner sideOffset={6}>
					<Popover.Popup className="InfoPopup">
						<strong>No LiveBarn for this rink.</strong> LiveBarn
						only streams and records rinks with its cameras. We
						couldn't find this rink on LiveBarn, so there's no live
						stream or replay for its games.
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	)
}

const CameraIcon = () => {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden
		>
			<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11" />
			<rect x="2" y="6" width="14" height="12" rx="2" />
		</svg>
	)
}
