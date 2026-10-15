import {Combobox} from "@base-ui/react/combobox"
import {Popover} from "@base-ui/react/popover"
import {PreviewCard} from "@base-ui/react/preview-card"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import * as React from "react"
import {
	ChevronIcon,
	CityDot,
	Hint,
	HomeAwayBadge,
	Link,
	LIVEBARN_TITLES,
	LiveBarnBadge,
	NotOnLiveBarn,
	RinkLink,
	ScoresheetLink,
	SegmentedControl,
	SearchIcon,
	StatsTable,
	StatsTableColumn,
	TeamAvatar,
	TeamLink,
} from "./Components.js"
import {
	formatGameDate,
	formatGameDay,
	formatGameTime,
	formatRelative,
	formatScore,
	getEndOfMonthDayKey,
	getEndOfWeekDayKey,
	getGameHref,
	useNow,
} from "./Util.js"
import {
	FeedGame,
	HeadToHeadGame,
	LiveBarnLink,
	RecentGame,
	Rink,
	RinkGame,
	RinkInfo,
	SeasonSummary,
	UpcomingGame,
} from "../shared/ApiJson.js"
import {LIMITS} from "../shared/KHLConfig.js"
import {getGoalsByTeam} from "../shared/KHLJson.js"
import {
	DAY_MS,
	getGameEndsAt,
	getLeagueDayKey,
	isGameInProgress,
} from "../shared/LeagueTime.js"

// --- Game cards

export interface RinkStatus {
	rink: Rink
	live: RinkGame | null
	next: RinkGame | null
}

export function getRinkStatus(rink: Rink, now: Date): RinkStatus {
	const live = rink.games.find((g) => isGameInProgress(g, now)) ?? null
	const next =
		rink.games.find((g) => Date.parse(g.startsAt) > now.getTime()) ?? null
	return {rink, live, next}
}

interface GameCardsProps {
	games: UpcomingGame[]
	seasonId: string
	now: Date
	limit?: number
	emptyMessage?: string
}

/** Cards for games that haven't finished, soonest (and live) first. */
export const GameCards = ({
	games,
	seasonId,
	now,
	limit,
	emptyMessage = "No upcoming games scheduled.",
}: GameCardsProps) => {
	const visible = games
		.filter(({game}) => getGameEndsAt(game) > now)
		.slice(0, limit)
	if (visible.length === 0) {
		return <p className="RinkCard-empty">{emptyMessage}</p>
	}
	return (
		<div className="RinkCards-grid">
			{visible.map(({rink, game}) => (
				<RinkCard
					key={game.gameId}
					rink={rink}
					game={game}
					seasonId={seasonId}
					now={now}
				/>
			))}
		</div>
	)
}

interface RinkCardProps {
	rink: RinkInfo
	/** The game to feature, or null for the rink's empty state */
	game: RinkGame | null
	seasonId: string
	now: Date
}

/** A game at a rink: when, who, which division, and how to watch. */
export const RinkCard = ({rink, game, seasonId, now}: RinkCardProps) => {
	const live = game !== null && isGameInProgress(game, now)
	return (
		<article className={cx("RinkCard", live && "RinkCard--live")}>
			<header className="RinkCard-header">
				<h3 className="RinkCard-name">
					<RinkLink arena={{id: rink.arenaId, name: rink.name}} />
				</h3>
				{/* The rink's feed is always available, game or not */}
				<span className="RinkCard-badges">
					{rink.livebarn.length === 0 && <NotOnLiveBarn />}
					{rink.livebarn.map((surface) => (
						<LiveBarnBadge
							key={surface.surfaceId}
							href={surface.liveUrl}
							surfaceName={
								rink.livebarn.length > 1
									? surface.surfaceName
									: undefined
							}
							title={LIVEBARN_TITLES.open(surface.surfaceName)}
						/>
					))}
				</span>
			</header>

			{game ? (
				<GameSummary game={game} seasonId={seasonId} now={now} />
			) : (
				<div className="RinkCard-empty">No games scheduled</div>
			)}
		</article>
	)
}

/**
 * A game's time (or LIVE, linking to the rink's feed), teams, division, and
 * when it starts or started. The body of a RinkCard; also used on its own.
 */
export const GameSummary = ({
	game,
	seasonId,
	now,
}: {
	game: RinkGame
	seasonId: string
	now: Date
}) => {
	const live = isGameInProgress(game, now)
	const [clock, meridiem] = formatGameTime(game.startsAt).split(" ")
	return (
		<>
			<div className="RinkCard-body">
				{/* Status only: the card's LiveBarn badge links to the feed */}
				<div
					className={cx(
						"RinkCard-time",
						live && "RinkCard-time--live",
					)}
				>
					{live ? (
						<span className="RinkCard-time-main">LIVE</span>
					) : (
						<>
							<span className="RinkCard-time-main">
								{clock}
								<span className="RinkCard-meridiem">
									{meridiem}
								</span>
							</span>
							<span className="RinkCard-time-sub">
								{formatGameDate(game.startsAt, now)}
							</span>
						</>
					)}
				</div>
				<ul className="RinkCard-teams">
					<RinkCardTeam
						team={game.awayTeam}
						homeAway="away"
						seasonId={seasonId}
					/>
					<RinkCardTeam
						team={game.homeTeam}
						homeAway="home"
						seasonId={seasonId}
					/>
				</ul>
			</div>
			<footer className="RinkCard-footer">
				<span className="RinkCard-division">
					{getDivisionLabel(game)}
				</span>
				{/* The card's link to the game; its hit area covers the card */}
				<Link
					className={cx("StretchedLink", live && "RinkCard-started")}
					href={getGameHref(game.gameId)}
					aria-label={`${game.awayTeam.name} at ${game.homeTeam.name}`}
				>
					{live
						? `started ${formatGameTime(game.startsAt)}`
						: formatRelative(game.startsAt, now)}
				</Link>
			</footer>
		</>
	)
}

const RinkCardTeam = ({
	team,
	homeAway,
	seasonId,
}: {
	team: RinkGame["homeTeam"]
	homeAway: "home" | "away"
	seasonId: string
}) => {
	return (
		<li className="RinkCard-team">
			<HomeAwayBadge homeAway={homeAway} truncated />
			<TeamAvatar name={team.name} logoUrl={team.logoUrl} size={26} />
			<TeamLink
				className="RinkCard-team-name"
				team={team}
				seasonId={seasonId}
			/>
		</li>
	)
}

/** Usually both teams share a division; show both when they don't. */
function getDivisionLabel(game: RinkGame): string {
	return getDivisions(game).join(" vs ")
}

// --- Past games

interface PastGamesProps {
	/** Oldest first, as returned by the API */
	games: FeedGame[]
	now: Date
	/** Logo for the game's own team (`game.team`) */
	getTeamLogoUrl: (teamId: string) => string | null
	/** Render at most this many of the most recent games */
	limit?: number
}

/** Finished games, most recent first, each linking to its LiveBarn replay. */
export const PastGames = ({
	games,
	now,
	getTeamLogoUrl,
	limit,
}: PastGamesProps) => {
	const past = games.filter((g) => getGameEndsAt(g.game) <= now).reverse()
	return (
		<GameTableCard
			title="Past games"
			count={past.length}
			emptyText="No games played yet."
			// Long histories scroll inside the card, under a fixed header
			maxHeight="24rem"
			rows={past
				.slice(0, limit)
				.map((g) => feedGameToRow(g, getTeamLogoUrl(g.game.team.id)))}
			now={now}
			showResult
			showDay
		/>
	)
}

/** A titled card around a GameTable: "Past games · 7", or `emptyText`. */
export const GameTableCard = ({
	title,
	count,
	emptyText,
	...tableProps
}: React.ComponentProps<typeof GameTable> & {
	title: string
	/** Shown after the title when there are any */
	count?: number
	emptyText: string
}) => {
	return (
		<section className="GameTableCard">
			<h2 className={cx("GameTableCard-title", "SectionLabel")}>
				{title}
				{!!count && ` · ${count}`}
			</h2>
			{tableProps.rows.length === 0 ? (
				<div className="GameTableCard-empty">{emptyText}</div>
			) : (
				<GameTable {...tableProps} />
			)}
		</section>
	)
}

// --- Game filters and list: upcoming games across every rink

type DayPreset = "yesterday" | "today" | "week" | "month"

type DayKey = `${number}-${number}-${number}`

/**
 * A preset, one league-local day as "yyyy-MM-dd", or an inclusive range of
 * days as "yyyy-MM-dd..yyyy-MM-dd"
 */
export type DayFilter = DayPreset | DayKey | `${DayKey}..${DayKey}`

/** The longest range the date picker allows; past days are fetched one by one */
const MAX_RANGE_DAYS = 31

const DAY_FILTERS: {value: DayPreset; label: string}[] = [
	{value: "yesterday", label: "Yesterday"},
	{value: "today", label: "Today"},
	{value: "week", label: "This week"},
	{value: "month", label: "This month"},
]

/** With no day in the URL (and for old "all" links) */
const DEFAULT_DAY: DayFilter = "week"

export interface GameFilterValues {
	day: DayFilter
	/** KHL arena ids; empty means every rink */
	rinks: string[]
	/** Division names, e.g. "Division 4A"; empty means every division */
	divisions: string[]
}

/** Filters live in the URL so they survive reloads and can be shared. */
export function readGameFilters(query: URLSearchParams): GameFilterValues {
	const day = query.get("day")
	return {
		day:
			DAY_FILTERS.some((d) => d.value === day) || getDayRange(day)
				? (day as DayFilter)
				: DEFAULT_DAY,
		rinks: query.get("rinks")?.split(",").filter(Boolean) ?? [],
		divisions: query.get("divisions")?.split(",").filter(Boolean) ?? [],
	}
}

export function writeGameFilters(filters: GameFilterValues): string {
	const query = new URLSearchParams()
	if (filters.day !== DEFAULT_DAY) {
		query.set("day", filters.day)
	}
	if (filters.rinks.length > 0) {
		query.set("rinks", filters.rinks.join(","))
	}
	if (filters.divisions.length > 0) {
		query.set("divisions", filters.divisions.join(","))
	}
	return query.size > 0 ? `?${query}` : ""
}

export interface ScheduledGame {
	rink: RinkInfo
	game: RinkGame
}

interface GameFiltersProps {
	filters: GameFilterValues
	onChange: (changes: Partial<GameFilterValues>) => void
	/** Every upcoming game, for the full rink and division lists */
	games: ScheduledGame[]
	/** Games matching the day filter, for the per-rink counts */
	gamesForDay: ScheduledGame[]
	now: Date
}

/**
 * One toolbar: the day as a segmented switch (plus a date picker), then rink
 * and division dropdowns with checkboxes.
 */
export const GameFilters = ({
	filters,
	onChange,
	games,
	gamesForDay,
	now,
}: GameFiltersProps) => {
	// Alphabetical
	const sortedRinks = [
		...new Map(games.map((g) => [g.rink.arenaId, g.rink])).values(),
	].sort((a, b) => a.name.localeCompare(b.name))
	return (
		<div className="FilterToolbar">
			<span className="FilterToolbar-spacer" />
			<FilterMenu
				label={summarizeSelection(
					filters.rinks.map(
						(id) =>
							sortedRinks.find((r) => r.arenaId === id)?.name ??
							id,
					),
					"All locations",
				)}
				searchLabel="Search locations"
				options={sortedRinks.map((rink) => ({
					value: rink.arenaId,
					label: rink.name,
					checked: filters.rinks.includes(rink.arenaId),
					icon: <CityDot city={rink.city} />,
					count: gamesForDay.filter(
						(g) => g.rink.arenaId === rink.arenaId,
					).length,
				}))}
				onToggle={(id, checked) => {
					onChange({
						rinks: checked
							? [...filters.rinks, id]
							: filters.rinks.filter((r) => r !== id),
					})
				}}
				onClear={() => onChange({rinks: []})}
			/>
			<DivisionMenu
				divisions={games.flatMap((g) => getDivisions(g.game))}
				selected={filters.divisions}
				onChange={(divisions) => onChange({divisions})}
			/>
			{/* Far right: the day presets and calendar, as one switch */}
			<SegmentedControl<DayPreset>
				label="Days"
				options={DAY_FILTERS}
				value={
					DAY_FILTERS.some((d) => d.value === filters.day)
						? (filters.day as DayPreset)
						: null
				}
				onChange={(day) => onChange({day})}
			>
				{/* The switch's last option: a picked day or range shows here,
				    selected, in place of the presets */}
				<DayPicker
					value={getDayRange(filters.day)}
					gameDays={
						new Set(
							games.map((g) =>
								getLeagueDayKey(new Date(g.game.startsAt)),
							),
						)
					}
					today={getLeagueDayKey(now)}
					onChange={(day) => onChange({day})}
				/>
			</SegmentedControl>
		</div>
	)
}

/** "All locations"; "KCI Starbucks"; "KCI Starbucks +2" */
function summarizeSelection(names: string[], none: string): string {
	if (names.length === 0) {
		return none
	}
	return names.length === 1 ? names[0]! : `${names[0]} +${names.length - 1}`
}

interface FilterMenuOption {
	value: string
	label: string
	checked: boolean
	/** A sub-division, under its division */
	indent?: boolean
	icon?: React.ReactNode
	/** Games it has, at the end of the row */
	count?: number
}

/**
 * A toolbar dropdown of checkboxes with a search box. It stays open while
 * ticking several, and its trigger names what's picked.
 */
const FilterMenu = ({
	label,
	searchLabel,
	options,
	onToggle,
	onClear,
}: {
	label: string
	searchLabel: string
	options: FilterMenuOption[]
	onToggle: (value: string, checked: boolean) => void
	onClear: () => void
}) => {
	const checked = options.filter((o) => o.checked)
	return (
		<Combobox.Root
			multiple
			items={options}
			value={checked}
			autoHighlight
			itemToStringLabel={(option: FilterMenuOption) => option.label}
			isItemEqualToValue={(a: FilterMenuOption, b: FilterMenuOption) =>
				a.value === b.value
			}
			onValueChange={(next: FilterMenuOption[]) => {
				// One item toggles at a time; the caller decides what it implies
				// (e.g. a division checks its sub-divisions)
				const values = new Set(next.map((o) => o.value))
				const toggled = options.find(
					(o) => o.checked !== values.has(o.value),
				)
				if (toggled) {
					onToggle(toggled.value, !toggled.checked)
				}
			}}
		>
			<Combobox.Trigger
				className={cx(
					"FilterPill",
					checked.length > 0 && "FilterPill--active",
				)}
			>
				{label}
				<Combobox.Icon>
					<ChevronIcon />
				</Combobox.Icon>
			</Combobox.Trigger>
			<Combobox.Portal>
				<Combobox.Positioner
					className="Positioner"
					sideOffset={6}
					align="end"
				>
					<Combobox.Popup
						className={cx(
							"SelectPopup",
							"Picker-popup",
							"FilterMenu",
						)}
					>
						<div className="Picker-search">
							<SearchIcon className="Picker-search-icon" />
							<Combobox.Input
								className="Picker-search-input"
								placeholder="Search"
								aria-label={searchLabel}
							/>
						</div>
						<Combobox.Empty className="Picker-empty">
							No matches.
						</Combobox.Empty>
						<Combobox.List className="Picker-list">
							{(option: FilterMenuOption) => (
								<Combobox.Item
									key={option.value}
									value={option}
									className={cx(
										"SelectOption",
										option.indent &&
											"FilterMenu-item--indent",
									)}
								>
									<span className="SelectOption-check">
										✓
									</span>
									{option.icon}
									{option.label}
									{option.count !== undefined && (
										<span className="FilterMenu-count">
											{option.count}
										</span>
									)}
								</Combobox.Item>
							)}
						</Combobox.List>
						{checked.length > 0 && (
							<div className="FilterMenu-footer">
								<button
									type="button"
									className="FilterMenu-clear"
									onClick={onClear}
								>
									Clear
								</button>
							</div>
						)}
					</Combobox.Popup>
				</Combobox.Positioner>
			</Combobox.Portal>
		</Combobox.Root>
	)
}

/**
 * The division dropdown: each division, with its sub-divisions under it.
 * Checking a division picks all of its sub-divisions.
 */
export const DivisionMenu = ({
	divisions,
	selected,
	onChange,
}: {
	/** Division names to offer; duplicates are fine */
	divisions: Iterable<string>
	/** Division names; empty means every division */
	selected: string[]
	onChange: (selected: string[]) => void
}) => {
	// Picked divisions stay listed (and named) even with no games right now
	const groups = groupDivisions(new Set([...divisions, ...selected]))
	// The rows under each group, and the division names each row stands for
	const rowsByGroup = new Map(
		groups.map((group) => [group.label, getDivisionRows(group)]),
	)
	// Whole groups read as "Division 4 (all)" rather than 4A, 4B and 4C
	const names = groups.flatMap((group) => {
		const chosen = group.divisions.filter((d) => selected.includes(d))
		if (
			group.divisions.length > 1 &&
			chosen.length === group.divisions.length
		) {
			return [getGroupRowLabel(group)]
		}
		return rowsByGroup
			.get(group.label)!
			.filter((row) => row.divisions.some((d) => chosen.includes(d)))
			.map((row) => row.label)
	})
	// A group's own row is keyed by its label, prefixed so it can't collide
	// with a division of the same name ("Division 4" alongside 4A-4C)
	const GROUP = "group:"
	const options = groups.flatMap((group): FilterMenuOption[] => {
		const rows = rowsByGroup.get(group.label)!
		const toOption = (row: DivisionRow, indent: boolean) => ({
			value: row.divisions[0]!,
			label: row.label,
			checked: row.divisions.every((d) => selected.includes(d)),
			indent,
		})
		if (group.divisions.length === 1) {
			return rows.map((row) => toOption(row, false))
		}
		return [
			{
				value: GROUP + group.label,
				label: getGroupRowLabel(group),
				checked: group.divisions.every((d) => selected.includes(d)),
			},
			...rows.map((row) => toOption(row, true)),
		]
	})
	return (
		<FilterMenu
			label={summarizeSelection(names, "All divisions")}
			searchLabel="Search divisions"
			options={options}
			onToggle={(value, checked) => {
				const group = value.startsWith(GROUP)
					? groups.find((g) => GROUP + g.label === value)
					: undefined
				const toggled = group
					? group.divisions
					: ([...rowsByGroup.values()]
							.flat()
							.find((row) => row.divisions[0] === value)
							?.divisions ?? [value])
				const others = selected.filter((d) => !toggled.includes(d))
				onChange(checked ? [...others, ...toggled] : others)
			}}
			onClear={() => onChange([])}
		/>
	)
}

interface DivisionRow {
	label: string
	/** The division names it picks: usually one, two when they're the same */
	divisions: string[]
}

/** "Division 4 (all)" for a division with sub-divisions; else its name */
function getGroupRowLabel(group: DivisionGroup): string {
	return group.divisions.length > 1 ? `${group.label} (all)` : group.label
}

/**
 * A group's divisions as menu rows. Where a division has sub-divisions, the
 * league's bare "Division 4" means 4A, so it's listed (and merged) as 4A.
 */
function getDivisionRows(group: DivisionGroup): DivisionRow[] {
	const rows = new Map<string, string[]>()
	for (const division of group.divisions) {
		const label =
			group.divisions.length > 1 && division === group.label
				? `${division}A`
				: division
		rows.set(label, [...(rows.get(label) ?? []), division])
	}
	return [...rows]
		.map(([label, divisions]) => ({label, divisions}))
		.sort((a, b) =>
			a.label.localeCompare(b.label, undefined, {numeric: true}),
		)
}

function isDayKey(day: string | null): day is DayKey {
	return day !== null && /^\d{4}-\d{2}-\d{2}$/.test(day)
}

interface DayRange {
	from: DayKey
	/** Inclusive; the same as `from` for one day */
	to: DayKey
}

/** The days a picked day or range covers; null for presets and junk */
function getDayRange(day: string | null): DayRange | null {
	if (isDayKey(day)) {
		return {from: day, to: day}
	}
	const [from = null, to = null, ...rest] = day?.split("..") ?? []
	if (rest.length > 0 || !isDayKey(from) || !isDayKey(to) || from > to) {
		return null
	}
	return getDaysBetween(from, to) <= MAX_RANGE_DAYS ? {from, to} : null
}

function toDayFilter({from, to}: DayRange): DayFilter {
	return from === to ? from : `${from}..${to}`
}

/** Days from `from` to `to`, counting both */
function getDaysBetween(from: string, to: string): number {
	return (
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
			DAY_MS +
		1
	)
}

/** "2026-10-22", 3 -> "2026-10-25" */
function addDaysToKey(day: string, count: number): DayKey {
	const date = new Date(`${day}T00:00:00Z`)
	date.setUTCDate(date.getUTCDate() + count)
	return date.toISOString().slice(0, 10) as DayKey
}

/** How far back the date picker goes */
const PAST_MONTHS = 24

/**
 * The day switch's calendar button: opens a month calendar for any day. Past
 * days show their results; upcoming days with games are marked.
 */
const DayPicker = ({
	value,
	gameDays,
	today,
	onChange,
}: {
	/** The picked days, or null when a preset is active */
	value: DayRange | null
	/** Upcoming day keys with at least one game */
	gameDays: Set<string>
	today: string
	onChange: (day: DayFilter) => void
}) => {
	const [open, setOpen] = React.useState(false)
	const [month, setMonth] = React.useState(today.slice(0, 7))
	// The first click picks a start; the second picks the end
	const [start, setStart] = React.useState<DayKey | null>(null)
	const [hovered, setHovered] = React.useState<DayKey | null>(null)
	// Back a couple of seasons; forward through the published schedule
	const firstMonth = addMonths(today.slice(0, 7), -PAST_MONTHS)
	const lastScheduled = [...gameDays].sort().at(-1)?.slice(0, 7)
	const nextMonth = addMonths(today.slice(0, 7), 1)
	const lastMonth =
		lastScheduled && lastScheduled > nextMonth ? lastScheduled : nextMonth
	// Mid-pick, the range runs from the start to the hovered day
	const shown: DayRange | null = start
		? hovered && hovered < start
			? {from: hovered, to: start}
			: {from: start, to: hovered ?? start}
		: value
	const pick = (day: DayKey) => {
		if (!start) {
			setStart(day)
			return
		}
		onChange(
			toDayFilter(
				day < start ? {from: day, to: start} : {from: start, to: day},
			),
		)
		setOpen(false)
	}
	return (
		<Popover.Root
			open={open}
			onOpenChange={(open) => {
				setOpen(open)
				setStart(null)
				setHovered(null)
				// Open on the picked day's month
				if (open) {
					setMonth((value?.from ?? today).slice(0, 7))
				}
			}}
		>
			<Hint label={value ? undefined : "Pick dates"}>
				<Popover.Trigger
					className={cx(
						"Segmented-item",
						"Segmented-item--icon",
						!value && "Segmented-item--icon-only",
					)}
					data-pressed={value ? "" : undefined}
					aria-label={value ? undefined : "Pick dates"}
				>
					<CalendarIcon />
					{value && formatDayRange(value)}
				</Popover.Trigger>
			</Hint>
			<Popover.Portal>
				<Popover.Positioner
					className="Positioner"
					sideOffset={6}
					align="end"
				>
					<Popover.Popup className="SelectPopup DayPicker">
						<div className="DayPicker-header">
							<button
								type="button"
								className="DayPicker-nav DayPicker-nav--prev"
								aria-label="Previous month"
								disabled={month <= firstMonth}
								onClick={() => setMonth(addMonths(month, -1))}
							>
								<ChevronIcon />
							</button>
							<span aria-live="polite">{formatMonth(month)}</span>
							<button
								type="button"
								className="DayPicker-nav DayPicker-nav--next"
								aria-label="Next month"
								disabled={month >= lastMonth}
								onClick={() => setMonth(addMonths(month, 1))}
							>
								<ChevronIcon />
							</button>
						</div>
						<div
							className="DayPicker-grid"
							onMouseLeave={() => setHovered(null)}
						>
							{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(
								(weekday) => (
									<span
										key={weekday}
										className="DayPicker-weekday"
										aria-hidden
									>
										{weekday}
									</span>
								),
							)}
							{getMonthDays(month).map((day, i) => {
								if (day === null) {
									return <span key={`blank-${i}`} />
								}
								const key = day as DayKey
								const inRange =
									!!shown &&
									shown.from <= key &&
									key <= shown.to
								// Mid-pick, days too far from the start can't end the range
								const tooFar =
									!!start &&
									getDaysBetween(
										key < start ? key : start,
										key < start ? start : key,
									) > MAX_RANGE_DAYS
								return (
									<button
										key={day}
										type="button"
										className="DayPicker-day"
										aria-label={formatDayKey(day, "long")}
										aria-pressed={inRange}
										disabled={tooFar}
										data-today={
											day === today ? "" : undefined
										}
										data-has-games={
											gameDays.has(day) ? "" : undefined
										}
										data-range-start={
											inRange && key === shown.from
												? ""
												: undefined
										}
										data-range-end={
											inRange && key === shown.to
												? ""
												: undefined
										}
										onMouseEnter={() => setHovered(key)}
										onFocus={() => setHovered(key)}
										onClick={() => pick(key)}
									>
										{Number(day.slice(8))}
									</button>
								)
							})}
						</div>
						<p className="DayPicker-hint" aria-live="polite">
							{start
								? "Now pick the last day, or the same day again for just that day."
								: `Pick a day, or a range of up to ${MAX_RANGE_DAYS} days.`}
						</p>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	)
}

// Day keys are calendar dates, so format and step them in UTC
const dayKeyFormats = {
	short: new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		weekday: "short",
		month: "short",
		day: "numeric",
	}),
	long: new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		weekday: "long",
		month: "long",
		day: "numeric",
	}),
}

const monthFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	month: "long",
	year: "numeric",
})

/** "2026-10-22" -> "Thu, Oct 22" (or "Thursday, October 22") */
export function formatDayKey(
	day: string,
	style: "short" | "long" = "short",
): string {
	return dayKeyFormats[style].format(new Date(`${day}T00:00:00Z`))
}

/** "Thu, Oct 22", or "Oct 22 – Oct 25" for a range */
function formatDayRange({from, to}: DayRange): string {
	if (from === to) {
		return formatDayKey(from)
	}
	const short = (day: string) => {
		return shortDayFormat.format(new Date(`${day}T00:00:00Z`))
	}
	return `${short(from)} – ${short(to)}`
}

const shortDayFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	month: "short",
	day: "numeric",
})

/** "2026-10" -> "October 2026" */
function formatMonth(month: string): string {
	return monthFormat.format(new Date(`${month}-01T00:00:00Z`))
}

/** "2026-12", 1 -> "2027-01" */
function addMonths(month: string, count: number): string {
	const [year, monthIndex] = month.split("-").map(Number)
	return new Date(Date.UTC(year!, monthIndex! - 1 + count, 1))
		.toISOString()
		.slice(0, 7)
}

/** A month's day keys, led by nulls so the first lands on its weekday (Monday first) */
function getMonthDays(month: string): (string | null)[] {
	const [year, monthIndex] = month.split("-").map(Number)
	const first = new Date(Date.UTC(year!, monthIndex! - 1, 1))
	const count = new Date(Date.UTC(year!, monthIndex!, 0)).getUTCDate()
	return [
		...Array<null>((first.getUTCDay() + 6) % 7).fill(null),
		...Array.from(
			{length: count},
			(_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
		),
	]
}

const CalendarIcon = () => {
	return (
		<svg
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden
		>
			<rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
			<path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
		</svg>
	)
}

interface DivisionGroup {
	/** "Division 4", or a division without sub-divisions, e.g. "40+ Fall 26" */
	label: string
	/** e.g. ["Division 4A", "Division 4B"] */
	divisions: string[]
}

/**
 * `items` in the order DivisionMenu lists their divisions (numbered ones
 * first, e.g. 40+ and women's last). Use it for anything listed per
 * division, so pages read in the same order as their filter.
 */
export function sortByDivision<T>(
	items: T[],
	getDivision: (item: T) => string,
): T[] {
	const order = groupDivisions(new Set(items.map(getDivision))).flatMap(
		(group) => group.divisions,
	)
	const rank = new Map(order.map((division, i) => [division, i]))
	return [...items].sort(
		(a, b) => rank.get(getDivision(a))! - rank.get(getDivision(b))!,
	)
}

/** Numbered divisions grouped by number ("Division 4" holds 4A-4C); others alone. */
function groupDivisions(divisions: Iterable<string>): DivisionGroup[] {
	const byLabel = new Map<string, string[]>()
	for (const division of divisions) {
		const label = division.match(/^Division \d+/)?.[0] ?? division
		byLabel.set(label, [...(byLabel.get(label) ?? []), division])
	}
	const compare = (a: string, b: string) => {
		return a.localeCompare(b, undefined, {numeric: true})
	}
	return [...byLabel]
		.map(([label, divisions]) => ({
			label,
			divisions: divisions.sort(compare),
		}))
		.sort((a, b) => {
			// Numbered divisions first, in order, then the rest by name
			const aNumbered = /^Division \d/.test(a.label) ? 0 : 1
			const bNumbered = /^Division \d/.test(b.label) ? 0 : 1
			return aNumbered - bNumbered || compare(a.label, b.label)
		})
}

export const GameList = ({
	games,
	seasonId,
	now,
	empty,
}: {
	games: ScheduledGame[]
	seasonId: string
	now: Date
	/** Shown instead when there are no games, e.g. NoGames */
	empty?: React.ReactNode
}) => {
	if (games.length === 0) {
		return (
			empty ?? (
				<div className="GameList-empty">
					No games match these filters.
				</div>
			)
		)
	}
	const days = new Map<string, ScheduledGame[]>()
	for (const game of games) {
		const key = getLeagueDayKey(new Date(game.game.startsAt))
		days.set(key, [...(days.get(key) ?? []), game])
	}
	return (
		<div className="GameList-days">
			{[...days.values()].map((dayGames) => (
				<section key={dayGames[0]!.game.startsAt}>
					<h2 className={cx("GameList-day-title", "SectionLabel")}>
						{formatGameDay(dayGames[0]!.game.startsAt, now)} ·{" "}
						{dayGames.length}{" "}
						{dayGames.length === 1 ? "game" : "games"}
					</h2>
					<div className="GameList-panel">
						<GameTable
							rows={dayGames.map((g) =>
								toGameTableRow(g, seasonId, now),
							)}
							now={now}
						/>
					</div>
				</section>
			))}
		</div>
	)
}

/** A team in a games table row */
export interface GameTableTeamInfo {
	id: string
	name: string
	logoUrl: string | null
	divisionName?: string | null
	/** Two-team tables (head-to-head): the team's color, as in Compare */
	accent?: "a" | "b"
}

/**
 * One game as a row of a GameTable. Every list of games (home page, rink,
 * team, and player pages) maps its own data to this.
 */
export interface GameTableRow {
	gameId: string | null
	/** For team links; team ids are reused across seasons */
	seasonId: string
	startsAt: string
	away: GameTableTeamInfo
	home: GameTableTeamInfo
	/** Once final, split per team */
	score: {away: number; home: number} | null
	/** A team's own lists: its result ("W", "L", "T"), shown as a chip */
	result?: string | null
	/** The side whose perspective the list is from (a team's or player's own
	    games): its name is highlighted */
	highlight?: "away" | "home"
	rink: {id: string; name: string} | null
	/** Feeds or replays; empty when the rink isn't on LiveBarn */
	livebarn: {surfaceId: number; href: string; title: string}[]
	/** Playing now */
	live?: boolean
}

/**
 * Games as a table: (result,) (date,) time, each team with its division, the
 * rink, then the scoresheet and LiveBarn. The row links to the game. Fixed
 * column widths, so stacked tables (e.g. one per day) line up.
 */
export const GameTable = ({
	rows,
	now,
	showResult,
	showDay,
	showRink = true,
	maxHeight,
}: {
	rows: GameTableRow[]
	now: Date
	/** A W/L/T chip first, for a team's own games */
	showResult?: boolean
	/** When rows span several days and nothing above says which */
	showDay?: boolean
	/** Off on a rink's own page */
	showRink?: boolean
	/** Rows scroll past this height under a fixed header */
	maxHeight?: string
}) => {
	// Once any game here has a score, it sits between the teams like a
	// scoreboard: "ESB [logo] 3 – 8 [logo] ALTP". Upcoming-only tables don't
	// need it.
	const scoreboard = rows.some((row) => row.score)
	// Both team columns as wide as the longest name here, so a table of short
	// names doesn't spread them out
	const teamChars = scoreboard ? getTeamColumnChars(rows) : null
	const columns: StatsTableColumn<GameTableRow>[] = [
		...(showResult
			? [
					{
						header: "",
						className: "GameTable-col--result",
						sortable: false,
						render: (row: GameTableRow) =>
							row.result && (
								<span
									className={cx(
										"GameFeed-result",
										`GameFeed-result--${row.result}`,
									)}
								>
									{row.result}
								</span>
							),
					},
				]
			: []),
		{
			// "Sun, Oct 11 10:30 PM" when rows span days; else just the time
			header: showDay ? "Date" : "Time",
			isLabel: true,
			className: showDay ? "GameTable-col--when" : "GameTable-col--time",
			sortValue: (row) => row.startsAt,
			render: (row) => {
				const time = (
					<>
						{row.live && (
							<span className="GameTable-live">LIVE</span>
						)}
						<span>
							{showDay && (
								<>
									{/* Fixed width, so the times line up */}
									<span className="GameTable-date">
										{formatGameDate(row.startsAt, now)}
									</span>
								</>
							)}
							{formatGameTime(row.startsAt)}
						</span>
					</>
				)
				// The row's link to the game; its hit area covers the row
				return row.gameId ? (
					<Link
						className={cx("GameTable-time", "StretchedLink")}
						href={getGameHref(row.gameId)}
						aria-label={`${row.away.name} at ${row.home.name}, ${formatGameDate(row.startsAt, now)} ${formatGameTime(row.startsAt)}`}
					>
						{time}
					</Link>
				) : (
					<span className="GameTable-time">{time}</span>
				)
			},
		},
		{
			header: "Away",
			isLabel: true,
			className: scoreboard ? "GameTable-col--away" : undefined,
			render: (row) => (
				<GameTableTeam
					team={row.away}
					seasonId={row.seasonId}
					highlighted={row.highlight === "away"}
					mirrored={scoreboard}
				/>
			),
		},
		...(scoreboard
			? [
					{
						header: "",
						className: "GameTable-col--score",
						sortable: false,
						render: (row: GameTableRow) =>
							row.score && <GameTableScore row={row} />,
					},
				]
			: []),
		{
			header: "Home",
			isLabel: true,
			className: scoreboard ? "GameTable-col--home" : undefined,
			render: (row) => (
				<GameTableTeam
					team={row.home}
					seasonId={row.seasonId}
					highlighted={row.highlight === "home"}
				/>
			),
		},
		...(showRink
			? [
					{
						header: "Location",
						isLabel: true,
						className: "GameTable-col--rink",
						render: (row: GameTableRow) =>
							row.rink && <RinkLink arena={row.rink} />,
					},
				]
			: []),
		{
			header: "",
			className: "GameTable-col--links",
			render: (row) => (
				<span className="GameTable-links">
					{/* The league posts a scoresheet once the game is final */}
					{row.gameId && row.score && (
						<ScoresheetLink gameId={row.gameId} />
					)}
					{row.livebarn.map((link) => (
						<LiveBarnBadge
							key={link.surfaceId}
							compact
							href={link.href}
							title={link.title}
						/>
					))}
					{row.livebarn.length === 0 && <NotOnLiveBarn compact />}
				</span>
			),
		},
	]
	return (
		<StatsTable<GameTableRow>
			className={cx("GameTable", scoreboard && "GameTable--scoreboard")}
			style={
				teamChars
					? ({
							"--GameTable-team-chars": teamChars,
						} as React.CSSProperties)
					: undefined
			}
			maxHeight={maxHeight}
			rows={rows}
			rowKey={(row) => row.gameId ?? `${row.startsAt}:${row.away.id}`}
			rowClassName={(row) =>
				cx("GameTable-row", row.live && "GameTable-row--live")
			}
			columns={columns}
		/>
	)
}

/** Team columns fit names up to this long; longer ones end in an ellipsis */
const TEAM_COLUMN_CHARS = {min: 8, max: 22}

/**
 * The longest team name (or division, which is set smaller) in these rows,
 * in characters, clamped to `TEAM_COLUMN_CHARS`.
 */
function getTeamColumnChars(rows: GameTableRow[]): number {
	const longest = Math.max(
		0,
		...rows.flatMap((row) =>
			[row.away, row.home].map((team) =>
				Math.max(
					team.name.length,
					// --text-xs is about 0.8 of the names' size
					Math.ceil((team.divisionName?.length ?? 0) * 0.8),
				),
			),
		),
	)
	return Math.min(
		TEAM_COLUMN_CHARS.max,
		Math.max(TEAM_COLUMN_CHARS.min, longest),
	)
}

/**
 * "2 – 9", away first: the winner's goals bold (in its color, when the table
 * colors its teams) and the loser's muted. A tie is plain.
 */
const GameTableScore = ({row}: {row: GameTableRow}) => {
	const {away, home} = row.score!
	const goals = (mine: number, other: number, team: GameTableTeamInfo) => {
		return (
			<span
				className={cx(
					"GameTable-goals",
					mine > other && "GameTable-goals--won",
					mine < other && "GameTable-goals--lost",
					mine > other &&
						`GameTable-tint--${team.accent ?? "neutral"}`,
				)}
			>
				{mine}
			</span>
		)
	}
	return (
		<span
			className="GameTable-score"
			aria-label={`${row.away.name} ${away}, ${row.home.name} ${home}`}
		>
			{goals(away, home, row.away)}
			<span className="GameTable-score-dash"> – </span>
			{goals(home, away, row.home)}
		</span>
	)
}

/** An upcoming (or playing) league game, with its rink's live feeds */
export function toGameTableRow(
	{rink, game}: {rink: RinkInfo; game: RinkGame},
	seasonId: string,
	now: Date,
): GameTableRow {
	// A final score means it's over, even inside its slot
	const live = !game.score && isGameInProgress(game, now)
	return {
		gameId: game.gameId,
		seasonId,
		startsAt: game.startsAt,
		away: game.awayTeam,
		home: game.homeTeam,
		score: game.score ?? null,
		rink: {id: rink.arenaId, name: rink.name},
		livebarn: rink.livebarn.map((surface) => ({
			surfaceId: surface.surfaceId,
			href: surface.liveUrl,
			title: live
				? LIVEBARN_TITLES.live(surface.surfaceName)
				: LIVEBARN_TITLES.open(surface.surfaceName),
		})),
		live,
	}
}

/** A finished game from a team's schedule, with its replays */
function feedGameToRow(
	{game, opponentLogoUrl, livebarn}: FeedGame,
	teamLogoUrl: string | null,
): GameTableRow {
	const goals = getGoalsByTeam(game)
	const team = {...game.team, logoUrl: teamLogoUrl}
	const opponent = {...game.opponent, logoUrl: opponentLogoUrl}
	const [away, home] =
		game.homeAway === "home" ? [opponent, team] : [team, opponent]
	return {
		gameId: game.id,
		seasonId: game.seasonId,
		startsAt: game.startsAt,
		away,
		home,
		score: goals
			? {away: goals[away.id] ?? 0, home: goals[home.id] ?? 0}
			: null,
		result: game.result,
		highlight: game.homeAway,
		rink: game.arena,
		livebarn: toReplayLinks(livebarn),
	}
}

/** A finished game's LiveBarn replays, as a GameTable row's links */
export function toReplayLinks(
	livebarn: LiveBarnLink[],
): GameTableRow["livebarn"] {
	return livebarn.map((link) => ({
		surfaceId: link.surfaceId,
		href: link.vodUrl,
		title: LIVEBARN_TITLES.replay(link.surfaceName),
	}))
}

/**
 * A team in a games table: logo, then name over division. The list's own
 * team (`GameTableRow.highlight`) is bold and tinted.
 */
const GameTableTeam = ({
	team,
	seasonId,
	highlighted,
	mirrored,
}: {
	team: GameTableTeamInfo
	seasonId: string
	highlighted?: boolean
	/** Logo on the right, text right-aligned: the away side of a scoreboard */
	mirrored?: boolean
}) => {
	return (
		<span
			className={cx(
				"GameTable-team",
				mirrored && "GameTable-team--mirrored",
				highlighted && "GameTable-team--highlighted",
				// Tinted: in its series color in a head-to-head, else grey
				highlighted && `GameTable-tint--${team.accent ?? "neutral"}`,
			)}
		>
			<TeamAvatar name={team.name} logoUrl={team.logoUrl} size={28} />
			<span className="GameTable-team-text">
				<span className="GameTable-team-name">
					<TeamLink team={team} seasonId={seasonId} />
				</span>
				{team.divisionName && (
					<span className="GameTable-team-division">
						{team.divisionName}
					</span>
				)}
			</span>
		</span>
	)
}

/** Games that haven't finished yet, across every rink, soonest first. */
export function getScheduledGames(rinks: Rink[], now: Date): ScheduledGame[] {
	return rinks
		.flatMap((rink) => rink.games.map((game) => ({rink, game})))
		.filter(({game}) => getGameEndsAt(game) > now)
		.sort((a, b) => a.game.startsAt.localeCompare(b.game.startsAt))
}

/** Games matching the day filter, then those also matching rink and division */
export function filterScheduledGames(
	games: ScheduledGame[],
	filters: GameFilterValues,
	now: Date,
): {forDay: ScheduledGame[]; visible: ScheduledGame[]} {
	const forDay = games.filter((g) => matchesDay(g.game, filters.day, now))
	const visible = forDay.filter((g) => matchesRinksAndDivisions(g, filters))
	return {forDay, visible}
}

function matchesRinksAndDivisions(
	{rink, game}: ScheduledGame,
	filters: GameFilterValues,
): boolean {
	return (
		(filters.rinks.length === 0 || filters.rinks.includes(rink.arenaId)) &&
		(filters.divisions.length === 0 ||
			getDivisions(game).some((d) => filters.divisions.includes(d)))
	)
}

/**
 * When nothing matches: says what's empty, then offers the way out, i.e.
 * clearing rink and division filters that hide this day's games, or jumping
 * to the next day with matching games.
 */
export const NoGames = ({
	filters,
	forDay,
	upcoming,
	now,
	onChange,
}: {
	filters: GameFilterValues
	/** Games on the picked days, before rink and division filters */
	forDay: ScheduledGame[]
	/** Every upcoming game, to find the next day with matches */
	upcoming: ScheduledGame[]
	now: Date
	onChange: (changes: Partial<GameFilterValues>) => void
}) => {
	const narrowed = filters.rinks.length > 0 || filters.divisions.length > 0
	const lastDay = getLastDayKey(filters.day, now)
	const later = upcoming.filter((g) => {
		return (
			getLeagueDayKey(new Date(g.game.startsAt)) > lastDay &&
			matchesRinksAndDivisions(g, filters)
		)
	})
	const nextDay = later[0]
		? getLeagueDayKey(new Date(later[0].game.startsAt))
		: null
	const nextCount = later.filter((g) => {
		return getLeagueDayKey(new Date(g.game.startsAt)) === nextDay
	}).length
	return (
		<div className="NoGames">
			<CalendarIcon />
			<h2 className="NoGames-title">
				No games {describeDay(filters.day)}
			</h2>
			<p className="NoGames-text">
				{narrowed && forDay.length > 0
					? `${forDay.length} ${forDay.length === 1 ? "game is" : "games are"} hidden by your location and division filters.`
					: narrowed
						? "Nothing's scheduled then, at any location."
						: "Nothing's scheduled then."}
			</p>
			<div className="NoGames-actions">
				{narrowed && forDay.length > 0 && (
					<button
						type="button"
						className="FilterPill"
						onClick={() => onChange({rinks: [], divisions: []})}
					>
						Show all {forDay.length}{" "}
						{forDay.length === 1 ? "game" : "games"}
					</button>
				)}
				{nextDay && (
					<button
						type="button"
						className={cx("FilterPill", "FilterPill--primary")}
						onClick={() => onChange({day: nextDay as DayFilter})}
					>
						See {formatDayKey(nextDay)} · {nextCount}{" "}
						{nextCount === 1 ? "game" : "games"}
					</button>
				)}
			</div>
		</div>
	)
}

/** "today", "this week", "on Thu, Oct 22", "Oct 13 – Oct 17" */
function describeDay(day: DayFilter): string {
	switch (day) {
		case "yesterday":
		case "today":
			return day
		case "week":
			return "this week"
		case "month":
			return "this month"
	}
	const range = getDayRange(day)
	if (!range) {
		return ""
	}
	return range.from === range.to
		? `on ${formatDayKey(range.from)}`
		: `from ${formatDayRange(range).replace(" – ", " to ")}`
}

/** The last day a day filter covers, as "yyyy-MM-dd" */
function getLastDayKey(day: DayFilter, now: Date): string {
	switch (day) {
		case "yesterday":
			return getLeagueDayKey(addDays(now, -1))
		case "today":
			return getLeagueDayKey(now)
		case "week":
			return getEndOfWeekDayKey(now)
		case "month":
			return getEndOfMonthDayKey(now)
	}
	return getDayRange(day)?.to ?? getLeagueDayKey(now)
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * DAY_MS)
}

/**
 * The days before today that the filter picks, oldest first. Past days come
 * from the league's scoreboard rather than the upcoming schedule.
 */
export function getPastDays(day: DayFilter, now: Date): string[] {
	const today = getLeagueDayKey(now)
	if (day === "yesterday") {
		return [getLeagueDayKey(addDays(now, -1))]
	}
	const range = getDayRange(day)
	if (!range || range.from >= today) {
		return []
	}
	const last = range.to < today ? range.to : addDaysToKey(today, -1)
	return Array.from({length: getDaysBetween(range.from, last)}, (_, i) => {
		return addDaysToKey(range.from, i)
	})
}

/** Whether the filter picks today or later, which the upcoming schedule has */
export function includesUpcomingDays(day: DayFilter, now: Date): boolean {
	const range = getDayRange(day)
	return day !== "yesterday" && (!range || range.to >= getLeagueDayKey(now))
}

function matchesDay(game: RinkGame, day: DayFilter, now: Date): boolean {
	const key = getLeagueDayKey(new Date(game.startsAt))
	const today = getLeagueDayKey(now)
	switch (day) {
		case "yesterday":
			return key === getLeagueDayKey(addDays(now, -1))
		case "today":
			return key === today
		case "week":
			return key <= getEndOfWeekDayKey(now)
		case "month":
			return key <= getEndOfMonthDayKey(now)
		default: {
			const range = getDayRange(day)
			return !!range && range.from <= key && key <= range.to
		}
	}
}

/** The game's divisions: usually one, two when the teams' differ */
function getDivisions(game: RinkGame): string[] {
	return [
		...new Set(
			[game.awayTeam.divisionName, game.homeTeam.divisionName].flatMap(
				(d) => d || [],
			),
		),
	]
}

// --- Head-to-head

interface HeadToHeadTeam {
	id: string
	name: string
	logoUrl: string | null
}

interface HeadToHeadProps {
	/** The first goals column, e.g. the away team */
	left: HeadToHeadTeam
	right: HeadToHeadTeam
	/** Newest first */
	games: HeadToHeadGame[]
	now: Date
}

/**
 * The series between two teams at a glance: who leads, as a bar in the teams'
 * colors, and when they last met. Their games are in HeadToHeadGames.
 */
export const HeadToHeadSeries = ({
	left,
	right,
	games,
}: Omit<HeadToHeadProps, "now">) => {
	const now = useNow()
	const last = games.find((g) => g.goals)
	if (games.length === 0) {
		return (
			<p className="Detail-empty">
				No earlier games between these teams in recent seasons.
			</p>
		)
	}
	return (
		<>
			<SeriesRecord left={left} right={right} games={games} />
			{last && (
				<p className="HeadToHead-last">
					Last met {formatGameDate(last.startsAt, now)}
					{last.arena && ` at ${last.arena.name}`}
				</p>
			)}
		</>
	)
}

/** Earlier games between two teams, in the same table as every games list. */
export const HeadToHeadGames = ({left, right, games, now}: HeadToHeadProps) => {
	if (games.length === 0) {
		return null
	}
	return (
		<section className="Detail-panel">
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				Previous meetings
			</h2>
			<GameTable
				rows={games.map((game) => headToHeadToRow(game, left, right))}
				now={now}
				showDay
			/>
		</section>
	)
}

function headToHeadToRow(
	game: HeadToHeadGame,
	left: HeadToHeadTeam,
	right: HeadToHeadTeam,
): GameTableRow {
	// The series' colors: left (e.g. the away team) blue, right orange
	const a = {...left, accent: "a" as const}
	const b = {...right, accent: "b" as const}
	const [home, away] = game.homeTeamId === left.id ? [a, b] : [b, a]
	return {
		gameId: game.gameId,
		seasonId: game.seasonId,
		startsAt: game.startsAt,
		away,
		home,
		score: game.goals
			? {away: game.goals[away.id] ?? 0, home: game.goals[home.id] ?? 0}
			: null,
		rink: game.arena,
		livebarn: toReplayLinks(game.livebarn),
	}
}

/** Wins, ties, and losses as one bar in the teams' colors, with a legend. */
const SeriesRecord = ({
	left,
	right,
	games,
}: {
	left: HeadToHeadTeam
	right: HeadToHeadTeam
	games: HeadToHeadGame[]
}) => {
	const scored = games.flatMap((g) => (g.goals ? [g.goals] : []))
	if (scored.length === 0) {
		return null
	}
	const wins = (team: HeadToHeadTeam, other: HeadToHeadTeam) => {
		return scored.filter((goals) => goals[team.id]! > goals[other.id]!)
			.length
	}
	const leftWins = wins(left, right)
	const rightWins = wins(right, left)
	const ties = scored.length - leftWins - rightWins
	const leader =
		leftWins > rightWins ? left : rightWins > leftWins ? right : null
	const segments = [
		{key: "left", count: leftWins, label: `${left.name} wins`},
		{key: "tie", count: ties, label: "Ties"},
		{key: "right", count: rightWins, label: `${right.name} wins`},
	]
	return (
		<div className="SeriesRecord">
			<p className="SeriesRecord-headline">
				{leader
					? `${leader.name} lead ${Math.max(leftWins, rightWins)}–${Math.min(leftWins, rightWins)}`
					: `Even at ${leftWins}–${rightWins}`}
				{ties > 0 && (
					<span className="SeriesRecord-ties">
						{" "}
						· {ties} {ties === 1 ? "tie" : "ties"}
					</span>
				)}
			</p>
			<div
				className="SeriesRecord-bar"
				role="img"
				aria-label={segments
					.map((s) => `${s.label}: ${s.count}`)
					.join(", ")}
			>
				{segments
					.filter((s) => s.count > 0)
					.map((s) => (
						<Hint key={s.key} label={`${s.label}: ${s.count}`}>
							<span
								className={cx(
									"SeriesRecord-segment",
									`SeriesRecord-segment--${s.key}`,
								)}
								style={{flexGrow: s.count}}
							/>
						</Hint>
					))}
			</div>
			<ul className="SeriesRecord-legend">
				{segments.map((s) => (
					<li key={s.key} className="SeriesRecord-legend-item">
						<span
							className={cx(
								"SeriesRecord-swatch",
								`SeriesRecord-segment--${s.key}`,
							)}
							aria-hidden
						/>
						{s.key === "tie" ? (
							"Ties"
						) : (
							<>
								<TeamAvatar
									name={
										s.key === "left"
											? left.name
											: right.name
									}
									logoUrl={
										s.key === "left"
											? left.logoUrl
											: right.logoUrl
									}
									size={18}
								/>
								{s.key === "left" ? left.name : right.name}
							</>
						)}
						<strong className="SeriesRecord-count">
							{s.count}
						</strong>
					</li>
				))}
			</ul>
		</div>
	)
}

// --- Recent results

/**
 * Under a team's name in a game's or matchup's header: its division, then its
 * record and last five results.
 */
export const TeamForm = ({
	form,
	showDivision = true,
}: {
	form: SeasonSummary
	/** Off where the header's pickers already name the season and division */
	showDivision?: boolean
}) => {
	return (
		<>
			{showDivision && form.divisionName && (
				<div className="BoxScore-division">{form.divisionName}</div>
			)}
			{/* No title here: it would show over the chips' hover cards */}
			<div className="BoxScore-form">
				{form.recent.length > 0 && (
					<>
						<span className="BoxScore-record">
							{form.wins}-{form.losses}-{form.ties}
						</span>
						<span className="BoxScore-form-divider" aria-hidden />
					</>
				)}
				<span className="Detail-meta-hint">Last 5</span>
				<ResultChips
					games={form.recent.slice(-LIMITS.GAME_RECENT_GAMES)}
					slots={LIMITS.GAME_RECENT_GAMES}
				/>
			</div>
		</>
	)
}

/** W/L/T chips, oldest first, each opening its game with a preview on hover. */
export const ResultChips = ({
	games,
	slots,
}: {
	games: RecentGame[]
	/** Always this many chips, empty placeholders after the games, e.g. a
	    "Last 5" three games into a season */
	slots?: number
}) => {
	if (games.length === 0 && !slots) {
		return <span className="Compare-empty">No games yet</span>
	}
	const empty = Math.max(0, (slots ?? 0) - games.length)
	return (
		<span className="Compare-chips">
			{games.map((game, i) => (
				<ResultChip
					key={game.gameId ?? `${game.startsAt}-${i}`}
					game={game}
				/>
			))}
			{Array.from({length: empty}, (_, i) => (
				<ResultChipSlot key={`slot-${i}`} />
			))}
		</span>
	)
}

/**
 * "Last 5" and a team's latest results, oldest first, padded with empty
 * slots early in a season. For a team's own (or a player's) schedule.
 */
export const LastResults = ({
	games,
	showLabel = true,
}: {
	games: FeedGame[]
	/** Off where the caller labels it, e.g. a stats block's heading */
	showLabel?: boolean
}) => {
	const recent = games
		.filter((g) => g.game.isFinal && g.game.result)
		.slice(-LIMITS.GAME_RECENT_GAMES)
	return (
		<Hint
			label={`Last ${LIMITS.GAME_RECENT_GAMES} games, oldest to newest`}
		>
			<span className="Detail-form">
				{showLabel && (
					<span className="Detail-meta-hint">
						Last {LIMITS.GAME_RECENT_GAMES}
					</span>
				)}
				{recent.map(({game}) => (
					<span
						key={game.startsAt}
						className={cx(
							"GameFeed-result",
							`GameFeed-result--${game.result}`,
						)}
					>
						{game.result}
					</span>
				))}
				{/* Empty slots for games still to come */}
				{Array.from(
					{length: LIMITS.GAME_RECENT_GAMES - recent.length},
					(_, i) => (
						<ResultChipSlot key={`slot-${i}`} />
					),
				)}
			</span>
		</Hint>
	)
}

/**
 * A labeled row of big numbers in a page's hero, e.g. "This season" or
 * "Record". Player and team pages line these up side by side.
 */
export const HeroStatGroup = ({
	label,
	stats,
}: {
	label: string
	stats: Record<string, number | string>
}) => {
	return (
		<section className="PlayerHero-group" aria-label={label}>
			<h2 className="PlayerHero-group-label">{label}</h2>
			<dl className="PlayerHero-group-stats">
				{Object.entries(stats).map(([name, value]) => (
					<div key={name} className="PlayerHero-stat">
						<dt>{name}</dt>
						<dd>{value}</dd>
					</div>
				))}
			</dl>
		</section>
	)
}

/** "Last 5" as a hero stat block */
export const HeroLastResults = ({games}: {games: FeedGame[]}) => {
	return (
		<section className="PlayerHero-group" aria-label="Last 5">
			<h2 className="PlayerHero-group-label">Last 5</h2>
			<div className="PlayerHero-form">
				<LastResults games={games} showLabel={false} />
			</div>
		</section>
	)
}

/** A result chip's outline, for a game not played yet */
export const ResultChipSlot = () => {
	return (
		<span
			className={cx("GameFeed-result", "Compare-chip", "ResultChip-slot")}
			aria-hidden
		/>
	)
}

const RESULT_WORDS: Record<string, string> = {W: "Win", L: "Loss", T: "Tie"}

const ResultChip = ({game}: {game: RecentGame}) => {
	const now = useNow()
	const className = cx(
		"GameFeed-result",
		`GameFeed-result--${game.result}`,
		"Compare-chip",
	)
	const score = formatScore(game.goalsFor, game.goalsAgainst)
	const label = `${RESULT_WORDS[game.result] ?? game.result} ${score} ${game.homeAway === "home" ? "vs" : "at"} ${game.opponent.name}`
	return (
		<PreviewCard.Root>
			<PreviewCard.Trigger
				delay={150}
				closeDelay={100}
				className={className}
				aria-label={label}
				render={
					game.gameId ? (
						<Link href={getGameHref(game.gameId)} />
					) : (
						<span />
					)
				}
			>
				{game.result}
			</PreviewCard.Trigger>
			<PreviewCard.Portal>
				<PreviewCard.Positioner className="Positioner" sideOffset={6}>
					<PreviewCard.Popup
						className={cx("InfoPopup", "GamePreview")}
					>
						<div className="GamePreview-score">
							<span
								className={cx(
									"GameFeed-result",
									`GameFeed-result--${game.result}`,
								)}
							>
								{game.result}
							</span>
							<strong>{score}</strong>
						</div>
						<div className="GamePreview-opponent">
							{game.homeAway === "home" ? "vs" : "at"}{" "}
							{game.opponent.name}
						</div>
						<div className="GamePreview-meta">
							{formatGameDate(game.startsAt, now)} ·{" "}
							{formatGameTime(game.startsAt)}
							{game.arena && ` · ${game.arena.name}`}
						</div>
						{!game.gameId && (
							<div className="GamePreview-meta">
								No scoresheet posted
							</div>
						)}
					</PreviewCard.Popup>
				</PreviewCard.Positioner>
			</PreviewCard.Portal>
		</PreviewCard.Root>
	)
}
