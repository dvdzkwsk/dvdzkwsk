import * as React from "react"
import {Avatar} from "@base-ui/react/avatar"
import {Button} from "@base-ui/react/button"
import {Collapsible} from "@base-ui/react/collapsible"
import {Combobox} from "@base-ui/react/combobox"
import {Popover} from "@base-ui/react/popover"
import {Select} from "@base-ui/react/select"
import {Switch} from "@base-ui/react/switch"
import {Toggle} from "@base-ui/react/toggle"
import {ToggleGroup} from "@base-ui/react/toggle-group"
import {Tooltip} from "@base-ui/react/tooltip"
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
import {STRINGS, URLS} from "../shared/KHLConfig.js"
import {
	AppContext,
	AsyncState,
	describeError,
	getPlayerHref,
	getRinkHref,
	getScoresheetUrl,
	getTeamHref,
	IS_DEV,
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
	/** On the column's header and cells, e.g. to size it */
	className?: string
	render: (row: T) => React.ReactNode
	/**
	 * What the header sorts the rows by; null sorts last either way. Without
	 * it, a column sorts by its cells' text (numbers as numbers), which suits
	 * most columns; dates and times need this.
	 */
	sortValue?: (row: T) => number | string | null
	/** False for a column that makes no sense to sort. Unlabeled columns
	    (e.g. links) aren't sortable either. */
	sortable?: boolean
	/** First click sorts ascending, e.g. names, or GAA where lower is better.
	    By default numbers sort high to low first, text A to Z. */
	sortAscendingFirst?: boolean
}

interface StatsTableProps<T> {
	columns: StatsTableColumn<T>[]
	rows: T[]
	rowKey: (row: T) => string
	rowClassName?: (row: T) => string | undefined
	/** On the table, e.g. to fix its column widths */
	className?: string
}

type SortValue = number | string | null

interface StatsTableSort {
	column: number
	ascending: boolean
	/** For a column without `sortValue`: each row's cell text, by row key */
	values?: Map<string, SortValue>
}

/** A cell's text as a sort value: "1.000", ".667", "+4", "42%" are numbers */
function toCellSortValue(text: string): SortValue {
	const trimmed = text.trim()
	if (trimmed === "" || trimmed === "–" || trimmed === "-") {
		return null
	}
	const number = trimmed
		.replace(/^\+/, "")
		.replace(/%$/, "")
		.replace(/,/g, "")
	return /^-?(\d+\.?\d*|\.\d+)$/.test(number) ? Number(number) : trimmed
}

export function StatsTable<T>({
	columns,
	rows,
	rowKey,
	rowClassName,
	className,
}: StatsTableProps<T>) {
	// Null keeps the order the rows came in
	const [sort, setSort] = React.useState<StatsTableSort | null>(null)
	const bodyRef = React.useRef<HTMLTableSectionElement>(null)
	const isSortable = (column: StatsTableColumn<T>) => {
		return (
			column.sortable ??
			(column.sortValue !== undefined || column.header !== "")
		)
	}
	const sortedRows = React.useMemo(() => {
		const column = sort && columns[sort.column]
		if (!sort || !column) {
			return rows
		}
		const sortValue =
			column.sortValue ??
			((row: T) => sort.values?.get(rowKey(row)) ?? null)
		const direction = sort.ascending ? 1 : -1
		// Array.sort is stable, so ties keep the incoming order
		return rows
			.map((row) => ({row, value: sortValue(row)}))
			.sort((x, y) => {
				if (x.value === null || y.value === null) {
					return (
						(x.value === null ? 1 : 0) - (y.value === null ? 1 : 0)
					)
				}
				const order =
					typeof x.value === "number" && typeof y.value === "number"
						? x.value - y.value
						: String(x.value).localeCompare(
								String(y.value),
								undefined,
								{
									numeric: true,
								},
							)
				return order * direction
			})
			.map(({row}) => row)
	}, [rows, columns, sort, rowKey])

	// Columns without `sortValue` sort by what their cells show
	const readCellValues = (index: number): Map<string, SortValue> => {
		const values = new Map<string, SortValue>()
		for (const tr of Array.from(bodyRef.current?.rows ?? [])) {
			const key = tr.dataset.rowKey
			if (key !== undefined) {
				values.set(
					key,
					toCellSortValue(tr.cells[index]?.textContent ?? ""),
				)
			}
		}
		return values
	}

	const onSort = (index: number, column: StatsTableColumn<T>) => {
		const values = column.sortValue ? undefined : readCellValues(index)
		const isNumeric = column.sortValue
			? !column.isLabel
			: [...values!.values()].every(
					(v) => v === null || typeof v === "number",
				)
		setSort((current) =>
			current?.column === index
				? {column: index, ascending: !current.ascending, values}
				: {
						column: index,
						ascending: column.sortAscendingFirst ?? !isNumeric,
						values,
					},
		)
	}

	return (
		<div className="StatsTable-wrapper">
			<table className={cx("StatsTable", className)}>
				<thead>
					<tr>
						{columns.map((column, index) => {
							const sorted = sort?.column === index ? sort : null
							return (
								<Hint key={column.header} label={column.title}>
									<th
										className={cx(
											column.isLabel &&
												"StatsTable-label",
											column.className,
										)}
										aria-sort={
											sorted
												? sorted.ascending
													? "ascending"
													: "descending"
												: undefined
										}
									>
										{isSortable(column) ? (
											<button
												type="button"
												className={cx(
													"StatsTable-sort",
													sorted &&
														"StatsTable-sort--active",
												)}
												onClick={() =>
													onSort(index, column)
												}
											>
												{column.header}
												<span
													className="StatsTable-sort-arrow"
													aria-hidden
												>
													{sorted?.ascending
														? "↑"
														: "↓"}
												</span>
											</button>
										) : (
											column.header
										)}
									</th>
								</Hint>
							)
						})}
					</tr>
				</thead>
				<tbody ref={bodyRef}>
					{sortedRows.map((row) => (
						<tr
							key={rowKey(row)}
							data-row-key={rowKey(row)}
							className={rowClassName?.(row)}
						>
							{columns.map((column, index) => (
								<td
									key={index}
									className={cx(
										column.isLabel && "StatsTable-label",
										column.className,
									)}
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

/** A game's stat columns, as the league lists them once the game is posted */
const GAME_SKATER_COLUMNS = ["G", "A", "P", "PIM"]
const GAME_GOALIE_COLUMNS = ["SA", "GA", "SV", "SV%", "MIN"]

/** Stats where the best goalie or skater has the smallest number */
const LOWER_IS_BETTER = new Set(["GAA"])

/** A stat cell as a number for sorting, e.g. ".849" or "2.00"; null if blank */
const toSortNumber = (value: string | null | undefined): number | null => {
	if (value === null || value === undefined || value.trim() === "") {
		return null
	}
	const number = Number(value)
	return Number.isNaN(number) ? null : number
}

/** A season's roster, or a game's lineup with its stats in that game */
/**
 * Season stats; one game's stats; or a game whose stats aren't posted yet,
 * which lists the season roster under the game's columns, left blank
 */
export type RosterKind = "season" | "game" | "pending-game"

/** A team's skaters, by points, then its goalies. */
export const RosterTables = ({
	roster,
	skaterLimit,
	kind = "season",
}: {
	roster: TeamRoster
	/** Show only the top skaters, e.g. for a leaders table */
	skaterLimit?: number
	kind?: RosterKind
}) => {
	const {skaters, goalies} = roster
	if (skaters.length === 0 && goalies.length === 0) {
		return (
			<p className="Detail-empty">
				{kind === "game"
					? "The league hasn't posted this game's lineup."
					: "No roster for this season."}
			</p>
		)
	}
	// A game's lineup shows every column the league lists for it
	const skaterColumns = {
		season: SKATER_COLUMNS,
		game: roster.skaterColumns,
		"pending-game": GAME_SKATER_COLUMNS,
	}[kind]
	const goalieColumns = {
		season: GOALIE_COLUMNS,
		game: roster.goalieColumns,
		"pending-game": GAME_GOALIE_COLUMNS,
	}[kind]
	// Season stats don't belong under a game's columns
	const blank = kind === "pending-game"
	// Season tables total points as "PTS", a game's as "P"
	const points = (p: RosterPlayer) =>
		Number(p.stats["PTS"] ?? p.stats["P"]) || 0
	const goals = (p: RosterPlayer) => Number(p.stats["G"]) || 0
	// Blank tables have no stats to rank by, so they go by name
	const sortedSkaters = [...skaters]
		.sort((a, b) =>
			blank
				? a.name.localeCompare(b.name)
				: points(b) - points(a) ||
					goals(b) - goals(a) ||
					a.name.localeCompare(b.name),
		)
		.slice(0, skaterLimit)
	return (
		<>
			<RosterTable
				players={sortedSkaters}
				columns={skaterColumns}
				blank={blank}
			/>
			{goalies.length > 0 && (
				<>
					<h3 className={cx("SectionLabel", "Detail-subtitle")}>
						Goalies
					</h3>
					<RosterTable
						players={goalies}
						columns={goalieColumns}
						blank={blank}
					/>
				</>
			)}
		</>
	)
}

const RosterTable = ({
	players,
	columns,
	blank,
}: {
	players: RosterPlayer[]
	columns: string[]
	/** Stat cells left empty, e.g. before a game's stats are posted */
	blank?: boolean
}) => {
	const tableColumns: StatsTableColumn<RosterPlayer>[] = [
		{
			header: "#",
			isLabel: true,
			render: (p) => p.number ?? "",
			sortValue: (p) => toSortNumber(p.number),
		},
		{
			header: "Player",
			isLabel: true,
			sortValue: (p) => p.name.toLowerCase(),
			render: (p) => (
				<Link className="InlineLink" href={getPlayerHref(p.playerId)}>
					{p.name}
				</Link>
			),
		},
		...columns.map((column) => ({
			header: column,
			render: (p: RosterPlayer) =>
				blank ? (
					<span className="StatsTable-blank" aria-label="Not posted">
						–
					</span>
				) : (
					(p.stats[column] ?? "")
				),
			sortable: !blank,
			sortValue: (p: RosterPlayer) => toSortNumber(p.stats[column]),
			sortAscendingFirst: LOWER_IS_BETTER.has(column),
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
export const RosterPanels = ({
	teams,
	kind = "season",
}: {
	teams: RosterPanelTeam[]
	kind?: RosterKind
}) => {
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
						<Hint label={title}>
							<span className="SectionLabel">
								{note && `${note} · `}
								{kind === "game" ? "Lineup" : "Roster"} ·{" "}
								{roster.skaters.length + roster.goalies.length}
							</span>
						</Hint>
					</h2>
					<RosterTables roster={roster} kind={kind} />
				</section>
			))}
		</div>
	)
}

/** How many skaters each team lists in TopScorers */
const TOP_SCORERS = 3

interface TopScorersTeam {
	name: string
	roster: TeamRoster
}

/**
 * Two teams' top point scorers, keyed with the comparison colors: the first
 * team is "a" (blue), the second "b" (orange).
 */
export const TopScorers = ({
	title,
	teams,
}: {
	title: string
	teams: [TopScorersTeam, TopScorersTeam]
}) => {
	const points = (p: RosterPlayer) => Number(p.stats["PTS"]) || 0
	const goals = (p: RosterPlayer) => Number(p.stats["G"]) || 0
	const top = (roster: TeamRoster) =>
		roster.skaters
			.filter((p) => points(p) > 0)
			.sort(
				(x, y) =>
					points(y) - points(x) ||
					goals(y) - goals(x) ||
					x.name.localeCompare(y.name),
			)
			.slice(0, TOP_SCORERS)
	return (
		<section className={cx("Detail-panel", "Compare")}>
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				{title}
			</h2>
			<div className="TopScorers">
				{teams.map((team, i) => {
					const side = i === 0 ? "a" : "b"
					const players = top(team.roster)
					return (
						<div
							key={side}
							className={cx(
								"TopScorers-team",
								`Compare-team--${side}`,
							)}
						>
							<div className="Compare-team-name">
								<span className="Compare-key" aria-hidden />
								{team.name}
							</div>
							{players.length === 0 ? (
								<p className="Compare-empty">No points yet.</p>
							) : (
								<ol className="TopScorers-list">
									{players.map((p, rank) => (
										<li
											key={p.khlPlayerId}
											className="TopScorers-row"
										>
											<span className="TopScorers-rank">
												{rank + 1}
											</span>
											<span className="TopScorers-player">
												<Link
													className="TopScorers-name"
													href={getPlayerHref(
														p.playerId,
													)}
												>
													{p.name}
												</Link>
												<span className="TopScorers-line">
													{p.number &&
														`#${p.number} · `}
													{p.stats["G"] ?? 0} G ·{" "}
													{p.stats["A"] ?? 0} A ·{" "}
													{p.stats["GP"] ?? 0} GP
												</span>
											</span>
											<span className="TopScorers-points">
												{points(p)}
												<span className="TopScorers-unit">
													{" "}
													PTS
												</span>
											</span>
										</li>
									))}
								</ol>
							)}
						</div>
					)
				})}
			</div>
		</section>
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
			<Hint label={title}>
				<Select.Trigger
					className={cx("FilterPill", "Picker-trigger", className)}
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
			</Hint>
			<Select.Portal>
				<Select.Positioner
					className="Positioner"
					sideOffset={6}
					alignItemWithTrigger={false}
				>
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
			<Hint label={title}>
				<Combobox.Trigger
					className={cx("FilterPill", "Picker-trigger", className)}
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
			</Hint>
			<Combobox.Portal>
				<Combobox.Positioner
					className="Positioner"
					sideOffset={6}
					align="start"
				>
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
	loadingLabel,
	slowNote,
	errorTitle = "Couldn't load this page",
	size,
	children,
}: {
	state: AsyncState<T>
	/** What's loading, e.g. "Loading standings…" */
	loadingLabel?: string
	/** Shown if loading takes a while; see Loader */
	slowNote?: string
	errorTitle?: string
	/** "inline" inside a section, "page" (default) for the whole page */
	size?: "inline" | "page"
	children: (data: T) => React.ReactNode
}) {
	if (state.status === "loading") {
		return <Loader label={loadingLabel} slowNote={slowNote} size={size} />
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

// --- Loader

/** After this long, the loader says it's still working */
const LOADER_SLOW_MS = 5000

/**
 * A puck sliding into a net, on repeat, over what's loading. If it takes a
 * while, adds a note that it's still working.
 */
export const Loader = ({
	label = "Loading…",
	slowNote = "Still working. The first time this loads, it can take a little extra time.",
	size = "page",
}: {
	label?: string
	/** Shown once it's taken a while: why, so it doesn't look stuck */
	slowNote?: string
	/** "inline" inside a section, "page" for the whole page */
	size?: "inline" | "page"
}) => {
	const [slow, setSlow] = React.useState(false)
	React.useEffect(() => {
		const timer = setTimeout(() => setSlow(true), LOADER_SLOW_MS)
		return () => clearTimeout(timer)
	}, [])
	return (
		<div
			className={cx("Loader", `Loader--${size}`)}
			role="status"
			aria-live="polite"
		>
			<svg
				className="Loader-rink"
				viewBox="0 0 200 64"
				aria-hidden="true"
			>
				<defs>
					<pattern
						id="Loader-mesh"
						width="4"
						height="4"
						patternUnits="userSpaceOnUse"
						patternTransform="rotate(45)"
					>
						<path d="M0 0V4M0 0H4" className="Loader-mesh" />
					</pattern>
				</defs>
				<line className="Loader-ice" x1="6" y1="52" x2="194" y2="52" />
				<path
					className="Loader-crease"
					d="M168 52 A14 7 0 0 0 154 52 Z"
				/>
				<g className="Loader-net">
					<path
						d="M168 52V28H182L190 52Z"
						fill="url(#Loader-mesh)"
						className="Loader-netting"
					/>
					<path className="Loader-frame" d="M168 52V28H182L190 52" />
				</g>
				<g className="Loader-puck">
					<line
						className="Loader-streak"
						x1="-16"
						y1="46"
						x2="-4"
						y2="46"
					/>
					<line
						className="Loader-streak"
						x1="-24"
						y1="49"
						x2="-6"
						y2="49"
					/>
					<rect x="0" y="45" width="12" height="7" rx="2" />
				</g>
				<g className="Loader-spray">
					<circle cx="160" cy="50" r="1.2" />
					<circle cx="158" cy="47" r="1" />
					<circle cx="162" cy="45" r="0.8" />
				</g>
			</svg>
			<span className="Loader-label">{label}</span>
			<span className="Loader-note">
				{/* Most data is fetched from the league's site and cached, so
				    a first load is the slow one */}
				{slow && slowNote}
			</span>
		</div>
	)
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

interface SeasonFilterProps {
	/** Newest first */
	seasons: KHLSeason[]
	value: string
	onChange: (seasonId: string) => void
}

/** A filter toolbar's season picker. */
export const SeasonFilter = ({seasons, value, onChange}: SeasonFilterProps) => {
	return (
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
	)
}

// --- SegmentedControl

export interface SegmentedOption<V extends string> {
	value: V
	label: React.ReactNode
	disabled?: boolean
	/** Tooltip, e.g. why it's disabled */
	hint?: string
}

/**
 * Pick one of a few views: the options on one track, the picked one raised.
 * Pressing the picked option again keeps it. `children` go at the end of the
 * track, e.g. the home page's date picker.
 */
export function SegmentedControl<V extends string>({
	label,
	options,
	value,
	onChange,
	children,
}: {
	/** For screen readers, e.g. "Days" */
	label: string
	options: SegmentedOption<V>[]
	/** Null when none of the options is picked, e.g. a custom date */
	value: V | null
	onChange: (value: V) => void
	children?: React.ReactNode
}) {
	return (
		<ToggleGroup
			className="Segmented"
			aria-label={label}
			value={value === null ? [] : [value]}
			onValueChange={([next]) => {
				if (next) {
					onChange(next as V)
				}
			}}
		>
			{options.map((option) => (
				<Hint key={option.value} label={option.hint}>
					<Toggle
						className="Segmented-item"
						value={option.value}
						disabled={option.disabled}
					>
						{option.label}
					</Toggle>
				</Hint>
			))}
			{children}
		</ToggleGroup>
	)
}

// --- Warnings

/**
 * Collapsed by default: a one-line summary of what's missing or wrong, which
 * expands into an explanation (`detail`), the affected `items` and an optional
 * retry.
 */
export const Warnings = ({
	summary,
	detail,
	items,
	onRetry,
}: {
	summary: string
	detail: React.ReactNode
	items: {key: string; label: React.ReactNode; meta?: React.ReactNode}[]
	onRetry?: () => void
}) => {
	return (
		<Collapsible.Root className="Warnings">
			<Collapsible.Trigger className="Warnings-trigger">
				<WarningIcon />
				<span className="Warnings-label">Warnings</span>
				<span className="Warnings-summary">{summary}</span>
				<ChevronIcon />
			</Collapsible.Trigger>
			<Collapsible.Panel className="Warnings-panel">
				<p className="Warnings-detail">{detail}</p>
				<ul className="Warnings-list">
					{items.map((item) => (
						<li key={item.key}>
							<span className="Warnings-item-label">
								{item.label}
							</span>
							{item.meta && (
								<span className="Warnings-item-meta">
									{item.meta}
								</span>
							)}
						</li>
					))}
				</ul>
				{onRetry && (
					<Button className="Warnings-retry" onClick={onRetry}>
						Try again
					</Button>
				)}
			</Collapsible.Panel>
		</Collapsible.Root>
	)
}

const WarningIcon = () => {
	return (
		<svg
			className="Warnings-icon"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M8 2.25 14.25 13.5H1.75Z" />
			<path d="M8 6.5v3M8 11.25v.25" strokeLinecap="round" />
		</svg>
	)
}

// --- Notice

/** A banner above a page's content: what's missing or changed, and why. */
export const Notice = ({
	title,
	children,
}: {
	title: string
	children?: React.ReactNode
}) => {
	return (
		<div className="Notice" role="status">
			<InfoIcon />
			<div className="Notice-body">
				<strong className="Notice-title">{title}</strong>
				{children && <p className="Notice-text">{children}</p>}
			</div>
		</div>
	)
}

const InfoIcon = () => {
	return (
		<svg
			className="Notice-icon"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden
		>
			<circle cx="8" cy="8" r="6.25" />
			<path d="M8 7.25v4M8 4.75v.5" strokeLinecap="round" />
		</svg>
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
	{href: "/matchup", label: "Matchup"},
	...(IS_DEV ? [{href: "/admin", label: "Admin"}] : []),
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
		<Hint
			label={
				theme === "dark"
					? "Switch to light mode"
					: "Switch to dark mode"
			}
		>
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
			>
				<SunIcon />
				<MoonIcon />
				<Switch.Thumb className="ThemeSwitch-thumb" />
			</Switch.Root>
		</Hint>
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
function isEditable(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement)
	)
}

const SiteSearch = () => {
	const {history} = React.useContext(AppContext)
	const location = useLocation()
	const [input, setInput] = React.useState("")
	const [suggestions, setSuggestions] = React.useState<Suggestion[]>([])
	const [status, setStatus] = React.useState<SearchStatus>({kind: "idle"})
	const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
	const latestQuery = React.useRef("")
	const inputRef = React.useRef<HTMLInputElement>(null)

	// "/" focuses the search from anywhere, unless you're typing somewhere
	React.useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (
				e.key !== "/" ||
				e.defaultPrevented ||
				e.metaKey ||
				e.ctrlKey ||
				e.altKey ||
				isEditable(e.target)
			) {
				return
			}
			// Don't type the "/" into the input
			e.preventDefault()
			inputRef.current?.focus()
			inputRef.current?.select()
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [])

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
					ref={inputRef}
					className="SiteSearch-input"
					aria-label="Search players, teams, and rinks"
					aria-keyshortcuts="/"
					placeholder="Search players, teams, and rinks"
				/>
				{/* Hidden while focused or typed in; see styles.css */}
				<kbd className="SiteSearch-key" aria-hidden>
					/
				</kbd>
			</div>
			<Autocomplete.Portal hidden={status.kind === "idle"}>
				<Autocomplete.Positioner
					className={cx("Positioner", "SiteSearch-positioner")}
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

export const SearchIcon = ({
	className = "SiteSearch-icon",
}: {
	className?: string
}) => {
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
		<Hint label={truncated ? label : undefined}>
			<span
				className={cx(
					"HomeAwayBadge",
					`HomeAwayBadge--${homeAway}`,
					truncated && "HomeAwayBadge--truncated",
				)}
				aria-label={truncated ? label : undefined}
			>
				{truncated ? label[0] : label}
			</span>
		</Hint>
	)
}

// --- LiveBarn

interface LiveBarnBadgeProps {
	href: string
	/** Shown instead of "LiveBarn" when a rink has several surfaces */
	surfaceName?: string
	title?: string
	/** Just the camera icon; the label moves to a tooltip */
	compact?: boolean
}

/**
 * An external link shown as just an icon, in a compact LiveBarn badge's pill,
 * with its label in a tooltip.
 */
const IconLink = ({
	href,
	label,
	icon,
}: {
	href: string
	label: string
	icon: React.ReactNode
}) => {
	return (
		<Hint label={label}>
			<a
				className={cx("LiveBarnBadge", "LiveBarnBadge--compact")}
				href={href}
				aria-label={label}
				rel="noopener noreferrer"
				target="_blank"
			>
				{icon}
			</a>
		</Hint>
	)
}

/**
 * A tooltip on `children`, the element that triggers it. Use this instead of
 * a native `title` so every tooltip in the app looks the same. Without a
 * `label`, renders `children` alone.
 */
export const Hint = ({
	label,
	children,
}: {
	label: string | undefined
	children: React.ReactElement
}) => {
	if (!label) {
		return children
	}
	return (
		<Tooltip.Root>
			<Tooltip.Trigger delay={100} render={children} />
			<Tooltip.Portal>
				<Tooltip.Positioner className="Positioner" sideOffset={6}>
					<Tooltip.Popup className="InfoPopup">{label}</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	)
}

/** The league's printable scoresheet for a finished game, as an icon. */
export const ScoresheetLink = ({gameId}: {gameId: string}) => {
	return (
		<IconLink
			href={getScoresheetUrl(gameId)}
			label={`Open the official scoresheet on ${new URL(URLS.KHL).host}`}
			icon={<DocumentIcon />}
		/>
	)
}

/** A pill linking out to a LiveBarn feed or replay. */
export const LiveBarnBadge = ({
	href,
	surfaceName,
	title,
	compact,
}: LiveBarnBadgeProps) => {
	if (compact) {
		return (
			<IconLink
				href={href}
				label={title ?? surfaceName ?? "LiveBarn"}
				icon={<CameraIcon />}
			/>
		)
	}
	return (
		<Hint label={title}>
			<Link className="LiveBarnBadge" href={href}>
				<CameraIcon />
				{surfaceName ?? "LiveBarn"} ↗
			</Link>
		</Hint>
	)
}

/**
 * A LiveBarn badge for a rink without a feed: greyed out, with a popover
 * explaining why. Opens on hover, and on tap where there's no hover.
 */
export const NotOnLiveBarn = ({compact}: {compact?: boolean}) => {
	return (
		<Popover.Root>
			<Popover.Trigger
				openOnHover
				delay={100}
				className={cx(
					"LiveBarnBadge",
					"LiveBarnBadge--unavailable",
					compact && "LiveBarnBadge--compact",
				)}
				aria-disabled
				aria-label="LiveBarn unavailable for this rink"
			>
				<CameraIcon />
				{!compact && "LiveBarn"}
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner className="Positioner" sideOffset={6}>
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

const DocumentIcon = () => {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<path d="M14 2v6h6M8 13h8M8 17h5" />
		</svg>
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
