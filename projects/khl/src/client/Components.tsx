import {AlertDialog} from "@base-ui/react/alert-dialog"
import {Autocomplete} from "@base-ui/react/autocomplete"
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
import {Logger} from "@dvdzkwsk/logger"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import * as React from "react"
import {Helmet} from "react-helmet"
import {
	AppContext,
	AsyncState,
	describeError,
	formatGameDate,
	getPlayerHref,
	getRinkHref,
	getScoresheetUrl,
	getTeamHref,
	IS_DEV,
	useLocation,
} from "./Util.js"
import {
	RosterPlayer,
	SEARCH_ENDPOINT,
	SearchResponse,
	TeamRoster,
} from "../shared/ApiJson.js"
import {getCity} from "../shared/Cities.js"
import {STRINGS, URLS} from "../shared/KHLConfig.js"
import {KHLPlayerRef, KHLSeason} from "../shared/KHLJson.js"
import {DAY_MS, toLeagueInstant} from "../shared/LeagueTime.js"
import {
	getLiveBarnVodDate,
	isLiveBarnVodExpired,
	LIVEBARN_VOD_EXPIRY,
} from "../shared/LiveBarn.js"

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
				props.onClick?.(e)
				// Modified clicks open a new tab or window natively
				if (!e.defaultPrevented && !isNewTabClick(e)) {
					e.preventDefault()
					history.push(props.href)
				}
			}}
		/>
	)
}

/** Clicks the browser turns into a new tab or window */
function isNewTabClick(event: React.MouseEvent): boolean {
	return event.metaKey || event.ctrlKey || event.shiftKey
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

/**
 * A scoresheet player's name, linking to their player page when `playerIds`
 * has our UUID for them. Inherits surrounding styles.
 */
export const PlayerName = ({
	player,
	playerIds,
}: {
	player: KHLPlayerRef
	/** Our player UUID for each KHL player id */
	playerIds: Record<string, string>
}) => {
	const playerId = playerIds[player.id]
	return playerId ? (
		<Link className="InlineLink" href={getPlayerHref(playerId)}>
			{player.name}
		</Link>
	) : (
		<>{player.name}</>
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
	/** On the table, e.g. CSS variables its columns size from */
	style?: React.CSSProperties
	/** Rows scroll past this height; the header row stays in view */
	maxHeight?: string
	/**
	 * Show only the first this many rows (after sorting), with a button for
	 * the rest, so long tables render quickly. Unrendered rows have no cell
	 * text, so only columns with a `sortValue` can sort.
	 */
	rowLimit?: number
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
	style,
	maxHeight,
	rowLimit,
}: StatsTableProps<T>) {
	// Null keeps the order the rows came in
	const [sort, setSort] = React.useState<StatsTableSort | null>(null)
	const [showAll, setShowAll] = React.useState(false)
	const bodyRef = React.useRef<HTMLTableSectionElement>(null)
	const isSortable = (column: StatsTableColumn<T>) => {
		if (rowLimit !== undefined && column.sortValue === undefined) {
			return false
		}
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
	const isLimited =
		rowLimit !== undefined && !showAll && sortedRows.length > rowLimit
	const visibleRows = isLimited ? sortedRows.slice(0, rowLimit) : sortedRows

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
		<>
			<div
				className={cx(
					"StatsTable-wrapper",
					maxHeight && "StatsTable-wrapper--scroll",
				)}
				style={maxHeight ? {maxHeight} : undefined}
			>
				<table className={cx("StatsTable", className)} style={style}>
					<thead>
						<tr>
							{columns.map((column, index) => {
								const sorted =
									sort?.column === index ? sort : null
								return (
									<Hint
										key={column.header}
										label={column.title}
									>
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
						{visibleRows.map((row) => (
							<tr
								key={rowKey(row)}
								data-row-key={rowKey(row)}
								className={rowClassName?.(row)}
							>
								{columns.map((column, index) => (
									<td
										key={index}
										className={cx(
											column.isLabel &&
												"StatsTable-label",
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
			{/* Outside the wrapper, so it doesn't scroll sideways with the table */}
			{isLimited && (
				<button
					type="button"
					className="StatsTable-more"
					onClick={() => setShowAll(true)}
				>
					Show all {sortedRows.length}
				</button>
			)}
		</>
	)
}

// --- Roster

/** Skater and goalie columns to show, from the league's stats tables. */
export const SKATER_COLUMNS = ["GP", "G", "A", "PTS", "PIM"]
export const GOALIE_COLUMNS = ["GP", "W", "L", "T", "GAA", "SV%"]

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

/** Skaters by points, then goals, then name */
export function compareSkaters(
	a: {name: string; stats: Record<string, string>},
	b: {name: string; stats: Record<string, string>},
): number {
	// Season tables total points as "PTS", a game's as "P"
	const points = (p: typeof a) => Number(p.stats["PTS"] ?? p.stats["P"]) || 0
	const goals = (p: typeof a) => Number(p.stats["G"]) || 0
	return (
		points(b) - points(a) ||
		goals(b) - goals(a) ||
		a.name.localeCompare(b.name)
	)
}

/** StatsTable columns for the league's stat columns, e.g. ["GP", "G"] */
export function toStatColumns<T>(
	columns: string[],
	/** The row's stats, keyed by the league's column headers */
	getStats: (row: T) => Record<string, string>,
	{blank}: {blank?: boolean} = {},
): StatsTableColumn<T>[] {
	return columns.map((column) => ({
		header: column,
		render: (row: T) =>
			blank ? (
				<span className="StatsTable-blank" aria-label="Not posted">
					–
				</span>
			) : (
				(getStats(row)[column] ?? "")
			),
		sortable: !blank,
		sortValue: (row: T) => toSortNumber(getStats(row)[column]),
		sortAscendingFirst: LOWER_IS_BETTER.has(column),
	}))
}

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
	// Blank tables have no stats to rank by, so they go by name
	const sortedSkaters = [...skaters]
		.sort(blank ? (a, b) => a.name.localeCompare(b.name) : compareSkaters)
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
		...toStatColumns<RosterPlayer>(columns, (p) => p.stats, {blank}),
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
			{item.icon}
			<span className="Picker-item-label">{item.label}</span>
			{item.hint && <span className="Detail-meta-hint">{item.hint}</span>}
			<span className="SelectOption-check">✓</span>
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

/**
 * Overrides the route's <title> with what the page is about, e.g. a team's
 * name, in the same "X | KHL+" format.
 */
export const PageTitle = ({children}: {children: string}) => {
	return (
		<Helmet>
			<title>{`${children} | ${STRINGS.PRODUCT_NAME}`}</title>
		</Helmet>
	)
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
	/** Shown if loading takes a while; see PageLoader */
	slowNote?: string
	errorTitle?: string
	/** "inline" inside a section, "page" (default) for the whole page */
	size?: "inline" | "page"
	children: (data: T) => React.ReactNode
}) {
	if (state.status === "loading") {
		return size === "inline" ? (
			<InlineLoader label={loadingLabel} slowNote={slowNote} />
		) : (
			<PageLoader label={loadingLabel} slowNote={slowNote} />
		)
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

// --- Loaders: PageLoader for a whole page, InlineLoader inside a section

/** After this long, a loader says it's still working */
const LOADER_SLOW_MS = 5000

const DEFAULT_SLOW_NOTE =
	"Still working. The first time this loads, it can take a little extra time."

interface LoaderProps {
	/** What's loading, e.g. "Loading standings…" */
	label?: string
	/** Shown once it's taken a while: why, so it doesn't look stuck */
	slowNote?: string
}

/** Whether loading has taken long enough to show the slow note */
const useIsSlow = () => {
	const [slow, setSlow] = React.useState(false)
	React.useEffect(() => {
		const timer = setTimeout(() => setSlow(true), LOADER_SLOW_MS)
		return () => clearTimeout(timer)
	}, [])
	return slow
}

/**
 * The loader for a whole page, centered below the header: a Zamboni lapping
 * the rink from above, the ice shining behind it. If it takes a while, adds a
 * note that it's still working.
 */
export const PageLoader = ({
	label = "Loading…",
	slowNote = DEFAULT_SLOW_NOTE,
}: LoaderProps) => {
	const slow = useIsSlow()
	return (
		<div className="PageLoader" role="status" aria-live="polite">
			<ZamboniLap />
			<span className="PageLoader-label">{label}</span>
			<span className="PageLoader-note">
				{/* Most data is fetched from the league's site and cached, so
				    a first load is the slow one */}
				{slow && slowNote}
			</span>
		</div>
	)
}

/**
 * The loader inside a section: three pucks beside the label, with the slow
 * note under it.
 */
export const InlineLoader = ({
	label = "Loading…",
	slowNote = DEFAULT_SLOW_NOTE,
}: LoaderProps) => {
	const slow = useIsSlow()
	return (
		<div className="InlineLoader" role="status" aria-live="polite">
			<div className="InlineLoader-row">
				<PuckDots />
				<span className="InlineLoader-label">{label}</span>
			</div>
			<span className="InlineLoader-note">{slow && slowNote}</span>
		</div>
	)
}

/** The Zamboni's lap, inset from the boards; the trail and Zamboni share it */
const LAP_PATH =
	"M46 20H154A26 26 0 0 1 180 46V54A26 26 0 0 1 154 80H46A26 26 0 0 1 20 54V46A26 26 0 0 1 46 20Z"

/** A rink from above, with a Zamboni lapping it and fresh ice behind it */
const ZamboniLap = () => {
	return (
		<svg className="ZamboniLap" viewBox="0 0 200 100" aria-hidden="true">
			<rect
				className="ZamboniLap-boards"
				x="6"
				y="6"
				width="188"
				height="88"
				rx="40"
			/>
			<line
				className="ZamboniLap-blue-line"
				x1="72"
				y1="6"
				x2="72"
				y2="94"
			/>
			<line
				className="ZamboniLap-blue-line"
				x1="128"
				y1="6"
				x2="128"
				y2="94"
			/>
			<line
				className="ZamboniLap-red-line"
				x1="100"
				y1="6"
				x2="100"
				y2="94"
			/>
			<circle className="ZamboniLap-faceoff" cx="100" cy="50" r="12" />
			<path className="ZamboniLap-trail" pathLength="100" d={LAP_PATH} />
			{/* Rides the lap with CSS offset-path; points along it, tank at
			    the front */}
			<g
				className="ZamboniLap-zamboni"
				style={{offsetPath: `path("${LAP_PATH}")`}}
			>
				<rect
					className="ZamboniLap-body"
					x="-11"
					y="-6.5"
					width="22"
					height="13"
					rx="2.5"
				/>
				<rect
					className="ZamboniLap-tank"
					x="0"
					y="-5"
					width="10"
					height="10"
					rx="1.5"
				/>
				<rect
					className="ZamboniLap-stripe"
					x="3"
					y="-5"
					width="2"
					height="10"
				/>
				<circle className="ZamboniLap-driver" cx="-5" cy="0" r="2.2" />
			</g>
		</svg>
	)
}

/** Three pucks lighting up and hopping in turn, like a typing indicator */
const PuckDots = () => {
	return (
		<svg className="PuckDots" viewBox="0 0 34 10" aria-hidden="true">
			{[0, 12.5, 25].map((x) => (
				<rect key={x} x={x} y="3" width="9" height="5" rx="1.5" />
			))}
		</svg>
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
			{size === "page" ? (
				<MissedShot className="ErrorState-art" />
			) : (
				<AlertIcon />
			)}
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
		return {error: toError(error)}
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

/** A page that isn't there: a shot off the post, and a way back home */
export const NotFoundState = ({
	size = "page",
}: {
	/** "page" centers it below the header; "inline" fits a section */
	size?: "inline" | "page"
}) => {
	return (
		<div className={cx("NotFoundState", `NotFoundState--${size}`)}>
			<MissedShot className="NotFoundState-art" />
			<h1 className="NotFoundState-title">Page not found</h1>
			<p className="NotFoundState-description">
				This page doesn't exist, or it may have moved.
			</p>
			<Link className="NotFoundState-link" href="/">
				Back to upcoming games
			</Link>
		</div>
	)
}

/**
 * A net, side on, mouth to the left: the front post is at x=168
 * and the ice at y=52.
 */
export const GoalNet = ({className}: {className?: string}) => {
	const meshId = React.useId()
	return (
		<g className={cx("GoalNet", className)}>
			<defs>
				<pattern
					id={meshId}
					width="4"
					height="4"
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(45)"
				>
					<path d="M0 0V4M0 0H4" className="GoalNet-mesh" />
				</pattern>
			</defs>
			<path
				d="M168 52V28H182L190 52Z"
				fill={`url(#${meshId})`}
				className="GoalNet-netting"
			/>
			<path className="GoalNet-frame" d="M168 52V28H182L190 52" />
		</g>
	)
}

/** A shot that rang off the post and missed, for a page that isn't there or didn't load */
const MissedShot = ({className}: {className?: string}) => {
	return (
		<svg
			className={cx("MissedShot", className)}
			viewBox="0 0 200 64"
			aria-hidden="true"
		>
			<line className="MissedShot-ice" x1="6" y1="52" x2="194" y2="52" />
			<path
				className="MissedShot-crease"
				d="M168 52 A14 7 0 0 0 154 52 Z"
			/>
			<GoalNet />
			{/* Along the ice, off the post, and up and away */}
			<path className="MissedShot-path" d="M24 49L165 40Q150 18 140 14" />
			<path
				className="MissedShot-ping"
				d="M160 37.5L155 35M161 44L157 47"
			/>
			<rect
				className="MissedShot-puck"
				x="-6"
				y="-3.5"
				width="12"
				height="7"
				rx="2"
				transform="translate(132 12) rotate(-25)"
			/>
		</svg>
	)
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
 * expands into an explanation (`detail`), the affected `items`, and an optional
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

/** Brand (home link), search, and nav, on every page. */
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

// --- Site footer

const FOOTER_LINKS = [
	{href: "/about", label: "About"},
	{href: "/help", label: "Help / Feedback"},
	{href: "/status", label: "Status"},
	{href: URLS.GITHUB, label: "GitHub ↗"},
]

/** About, feedback, and source links, on every page. */
export const SiteFooter = () => {
	return (
		<footer className="SiteFooter">
			<div className="SiteFooter-inner">
				<span className="SiteFooter-brand">{STRINGS.PRODUCT_NAME}</span>
				<nav className="SiteFooter-nav">
					{FOOTER_LINKS.map((item) => (
						<Link
							key={item.href}
							className="SiteFooter-link"
							href={item.href}
						>
							{item.label}
						</Link>
					))}
				</nav>
			</div>
		</footer>
	)
}

const NAV_ITEMS = [
	// Also active on a game's page, /games/:id
	{href: "/games", label: "Games"},
	{href: "/teams", label: "Teams"},
	// Also active on a player's page, /players/:id
	{href: "/players", label: "Players"},
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

function isEditable(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement)
	)
}

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
					const error = toError(cause)
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
				? `No players, teams, or locations match “${status.query}”.`
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
					aria-label="Search players, teams, and locations"
					aria-keyshortcuts="/"
					placeholder="Search players, teams, and locations"
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

const SUGGESTION_KIND_LABELS: Record<SuggestionKind, string> = {
	player: "Player",
	team: "Team",
	rink: "Location",
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
	onClick,
}: {
	href: string
	label: string
	icon: React.ReactNode
	onClick?: React.MouseEventHandler<HTMLAnchorElement>
}) => {
	return (
		<Hint label={label}>
			<a
				className={cx("LiveBarnBadge", "LiveBarnBadge--compact")}
				href={href}
				onClick={onClick}
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
	label: React.ReactNode
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

/** Tooltips for LiveBarn links, so every page words them the same */
export const LIVEBARN_TITLES = {
	/** A rink's feed, with nothing playing yet */
	open: (surfaceName: string) => `Open ${surfaceName} on LiveBarn`,
	live: (surfaceName: string) => `Watch live on LiveBarn (${surfaceName})`,
	replay: (surfaceName: string) =>
		`Watch the replay on LiveBarn (${surfaceName})`,
	/** A replay from about when a goal or penalty happened */
	moment: (surfaceName: string) =>
		`Watch this moment on LiveBarn (${surfaceName})`,
}

/**
 * A pill linking out to a LiveBarn feed or replay. A replay older than
 * LiveBarn keeps recordings asks first, since it may be gone.
 */
export const LiveBarnBadge = ({
	href,
	surfaceName,
	title,
	compact,
}: LiveBarnBadgeProps) => {
	const [confirming, setConfirming] = React.useState(false)
	const onClick = isLiveBarnVodExpired(href, new Date())
		? (e: React.MouseEvent) => {
				e.preventDefault()
				setConfirming(true)
			}
		: undefined
	return (
		<>
			{compact ? (
				<IconLink
					href={href}
					label={title ?? surfaceName ?? "LiveBarn"}
					icon={<CameraIcon />}
					onClick={onClick}
				/>
			) : (
				<Hint label={title}>
					<Link
						className="LiveBarnBadge"
						href={href}
						onClick={onClick}
					>
						<CameraIcon />
						{surfaceName ?? "LiveBarn"} ↗
					</Link>
				</Hint>
			)}
			{onClick && (
				<ExpiredReplayDialog
					href={href}
					open={confirming}
					onOpenChange={setConfirming}
				/>
			)}
		</>
	)
}

/** Warns that a replay may be gone before opening it on LiveBarn. */
const ExpiredReplayDialog = ({
	href,
	open,
	onOpenChange,
}: {
	href: string
	open: boolean
	onOpenChange: (open: boolean) => void
}) => {
	const date = getLiveBarnVodDate(href)
	const recordedOn = date
		? `, and this one is from ${formatGameDate(toLeagueInstant(date, "12:00"), new Date())}`
		: ""
	return (
		<AlertDialog.Root open={open} onOpenChange={onOpenChange}>
			<AlertDialog.Portal>
				<AlertDialog.Backdrop className="ReplayDialog-backdrop" />
				<AlertDialog.Popup className="ReplayDialog">
					<AlertDialog.Title className="ReplayDialog-title">
						This replay may be gone
					</AlertDialog.Title>
					<AlertDialog.Description className="ReplayDialog-text">
						LiveBarn only keeps recordings for{" "}
						{LIVEBARN_VOD_EXPIRY / DAY_MS} days{recordedOn}. The
						video may no longer be available.
					</AlertDialog.Description>
					<div className="ReplayDialog-actions">
						<AlertDialog.Close className="FilterPill">
							Cancel
						</AlertDialog.Close>
						<a
							className="ReplayDialog-open"
							href={href}
							rel="noopener noreferrer"
							target="_blank"
							onClick={() => onOpenChange(false)}
						>
							Open LiveBarn anyway ↗
						</a>
					</div>
				</AlertDialog.Popup>
			</AlertDialog.Portal>
		</AlertDialog.Root>
	)
}

/**
 * A popover explaining `trigger`, the element that opens it: on hover, and on
 * tap where there's no hover.
 */
export const InfoPopover = ({
	trigger,
	children,
}: {
	trigger: React.ReactElement
	children: React.ReactNode
}) => {
	return (
		<Popover.Root>
			<Popover.Trigger openOnHover delay={100} render={trigger} />
			<Popover.Portal>
				<Popover.Positioner className="Positioner" sideOffset={6}>
					<Popover.Popup className="InfoPopup">
						{children}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	)
}

/**
 * A LiveBarn badge for a rink without a feed: greyed out, with a popover
 * explaining why.
 */
export const NotOnLiveBarn = ({compact}: {compact?: boolean}) => {
	return (
		<InfoPopover
			trigger={
				<button
					type="button"
					className={cx(
						"LiveBarnBadge",
						"LiveBarnBadge--unavailable",
						compact && "LiveBarnBadge--compact",
					)}
					aria-disabled
					aria-label="LiveBarn unavailable for this location"
				>
					<CameraIcon />
					{!compact && "LiveBarn"}
				</button>
			}
		>
			<strong>No LiveBarn for this location.</strong> We couldn't find
			this location on LiveBarn, so there's no live stream or replay for
			its games.
		</InfoPopover>
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
