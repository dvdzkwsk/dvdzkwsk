import {ScrollArea} from "@base-ui/react/scroll-area"
import {Menu} from "@base-ui/react/menu"
import {Toggle} from "@base-ui/react/toggle"
import {ToggleGroup} from "@base-ui/react/toggle-group"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import {
	FeedGame,
	HeadToHeadGame,
	Rink,
	RinkGame,
	RinkInfo,
	UpcomingGame,
} from "../shared/ApiJson.js"
import {getCity} from "../shared/Cities.js"
import {LEAGUE} from "../shared/KHLConfig.js"
import {
	ChevronIcon,
	CityDot,
	FilterBar,
	FilterRow,
	HomeAwayBadge,
	Link,
	LiveBarnBadge,
	NotOnLiveBarn,
	RinkLink,
	TeamAvatar,
	TeamLink,
} from "./Components.js"
import {
	formatGameDate,
	formatGameDay,
	formatGameTime,
	formatKHLScore,
	formatRelative,
	formatScore,
	formatShortGameDay,
	getEndOfWeekDayKey,
	getGameEndsAt,
	getGameHref,
	getLeagueDayKey,
} from "./Util.js"

// --- Game cards

export interface RinkStatus {
	rink: Rink
	live: RinkGame | null
	next: RinkGame | null
}

export function getRinkStatus(rink: Rink, now: Date): RinkStatus {
	const live = rink.games.find((g) => isRinkGameLive(g, now)) ?? null
	const next =
		rink.games.find((g) => Date.parse(g.startsAt) > now.getTime()) ?? null
	return {rink, live, next}
}

function getRinkGameEndsAt(game: RinkGame): number {
	return Date.parse(game.startsAt) + LEAGUE.GAME_DURATION_MINUTES * 60_000
}

function isRinkGameLive(game: RinkGame, now: Date): boolean {
	const time = now.getTime()
	return Date.parse(game.startsAt) <= time && time < getRinkGameEndsAt(game)
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
		.filter(({game}) => getRinkGameEndsAt(game) > now.getTime())
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
	const live = game !== null && isRinkGameLive(game, now)
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
							title={`Open ${surface.surfaceName} on LiveBarn`}
						/>
					))}
				</span>
			</header>

			{game ? (
				<GameSummary
					rink={rink}
					game={game}
					seasonId={seasonId}
					now={now}
				/>
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
	rink,
	game,
	seasonId,
	now,
}: {
	rink: RinkInfo
	game: RinkGame
	seasonId: string
	now: Date
}) => {
	const live = isRinkGameLive(game, now)
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
							<span className="RinkCard-time-main">{clock}</span>
							<span className="RinkCard-time-sub">
								{meridiem} ·{" "}
								{formatShortGameDay(game.startsAt, now)}
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
export function getDivisionLabel(game: RinkGame): string {
	const divisions = [
		...new Set(
			[game.awayTeam.divisionName, game.homeTeam.divisionName].filter(
				Boolean,
			),
		),
	]
	return divisions.join(" vs ")
}

// --- Past games

interface PastGamesProps {
	/** Oldest first, as returned by the API */
	games: FeedGame[]
	now: Date
	/** Label each game with its team, for players on several teams */
	showTeam: boolean
}

/** Finished games, most recent first, each linking to its LiveBarn replay. */
export const PastGames = ({games, now, showTeam}: PastGamesProps) => {
	const past = games.filter((g) => getGameEndsAt(g.game) <= now).reverse()
	return (
		<section className="GameFeed-card">
			<h2 className={cx("GameFeed-title", "SectionLabel")}>
				Past games{past.length > 0 && ` · ${past.length}`}
			</h2>
			{past.length === 0 ? (
				<div className="GameFeed-empty">No games played yet.</div>
			) : (
				<ScrollArea.Root className="GameFeed-scroll">
					<ScrollArea.Viewport className="GameFeed-viewport">
						<ScrollArea.Content>
							<ol className="GameFeed-list">
								{past.map((feedGame) => (
									<PastGame
										key={`${feedGame.game.team.id}:${feedGame.game.startsAt}`}
										feedGame={feedGame}
										now={now}
										showTeam={showTeam}
									/>
								))}
							</ol>
						</ScrollArea.Content>
					</ScrollArea.Viewport>
					<ScrollArea.Scrollbar className="GameFeed-scrollbar">
						<ScrollArea.Thumb className="GameFeed-thumb" />
					</ScrollArea.Scrollbar>
				</ScrollArea.Root>
			)}
		</section>
	)
}

const PastGame = ({
	feedGame,
	now,
	showTeam,
}: {
	feedGame: FeedGame
	now: Date
	showTeam: boolean
}) => {
	const {game, opponentLogoUrl, livebarn} = feedGame
	return (
		<li className="GameFeed-item">
			<div className="GameFeed-when">
				{formatGameDate(game.startsAt, now)} ·{" "}
				{formatGameTime(game.startsAt)}
				{game.arena && (
					<>
						{" · "}
						<RinkLink arena={game.arena} />
					</>
				)}
			</div>
			<div className="GameFeed-outcome">
				{game.result && (
					<span
						className={cx(
							"GameFeed-result",
							`GameFeed-result--${game.result}`,
						)}
					>
						{game.result}
					</span>
				)}
				<span className="GameFeed-score">
					{game.id ? (
						<Link
							className="InlineLink"
							href={getGameHref(game.id)}
						>
							{game.score && formatKHLScore(game.score)}
						</Link>
					) : (
						game.score && formatKHLScore(game.score)
					)}
				</span>
			</div>
			<div className="GameFeed-matchup">
				<div className="GameFeed-opponent">
					<span className="GameFeed-vs">
						{game.homeAway === "home" ? "vs" : "@"}
					</span>
					<TeamAvatar
						name={game.opponent.name}
						logoUrl={opponentLogoUrl}
						size={24}
					/>
					<TeamLink team={game.opponent} seasonId={game.seasonId} />
				</div>
				{showTeam && (
					<div className="GameFeed-team">
						<TeamLink team={game.team} seasonId={game.seasonId} />
					</div>
				)}
			</div>
			<div className="GameFeed-links">
				{/* Always rendered, so the LiveBarn link sits in the same spot
				    whether or not there's a box score */}
				<span className="GameFeed-boxscore">
					{game.id && (
						<Link href={getGameHref(game.id)}>Box score</Link>
					)}
				</span>
				{livebarn.map((link) => (
					<LiveBarnBadge
						key={link.surfaceId}
						href={link.vodUrl}
						surfaceName={
							livebarn.length > 1 ? link.surfaceName : undefined
						}
						title={`Watch the replay on LiveBarn (${link.surfaceName})`}
					/>
				))}
				{livebarn.length === 0 && <NotOnLiveBarn />}
			</div>
		</li>
	)
}

// --- Game filters and list: upcoming games across every rink

export type DayFilter = "all" | "today" | "tomorrow" | "week"

const DAY_FILTERS: {value: DayFilter; label: string}[] = [
	{value: "all", label: "All"},
	{value: "today", label: "Today"},
	{value: "tomorrow", label: "Tomorrow"},
	{value: "week", label: "This week"},
]

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
		day: DAY_FILTERS.some((d) => d.value === day)
			? (day as DayFilter)
			: "all",
		rinks: query.get("rinks")?.split(",").filter(Boolean) ?? [],
		divisions: query.get("divisions")?.split(",").filter(Boolean) ?? [],
	}
}

export function writeGameFilters(filters: GameFilterValues): string {
	const query = new URLSearchParams()
	if (filters.day !== "all") {
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
	rink: Rink
	game: RinkGame
}

interface GameFiltersProps {
	filters: GameFilterValues
	onChange: (changes: Partial<GameFilterValues>) => void
	/** Every upcoming game, for the full rink and division lists */
	games: ScheduledGame[]
	/** Games matching the day filter, for the per-rink counts */
	gamesForDay: ScheduledGame[]
}

export const GameFilters = ({
	filters,
	onChange,
	games,
	gamesForDay,
}: GameFiltersProps) => {
	// By city, then name, so a city's rinks sit together
	const sortedRinks = [
		...new Map(games.map((g) => [g.rink.arenaId, g.rink])).values(),
	].sort((a, b) => {
		return (
			getCityName(a.city).localeCompare(getCityName(b.city)) ||
			a.name.localeCompare(b.name)
		)
	})
	return (
		<FilterBar>
			<FilterRow label="Days">
				<ToggleGroup
					className="FilterBar-controls"
					value={[filters.day]}
					onValueChange={([day]) => {
						// Pressing the active day again leaves it selected
						if (day) {
							onChange({day: day as DayFilter})
						}
					}}
				>
					{DAY_FILTERS.map(({value, label}) => (
						<Toggle
							key={value}
							className="FilterPill"
							value={value}
						>
							{label}
						</Toggle>
					))}
				</ToggleGroup>
			</FilterRow>
			<FilterRow label="Rinks">
				<ToggleGroup
					className="FilterBar-controls"
					multiple
					value={filters.rinks}
					onValueChange={(rinks) => onChange({rinks})}
				>
					{sortedRinks.map((rink) => (
						<Toggle
							key={rink.arenaId}
							className="FilterPill"
							value={rink.arenaId}
						>
							<CityDot city={rink.city} />
							{rink.name}
							<span className="FilterPill-count">
								{
									gamesForDay.filter(
										(g) => g.rink.arenaId === rink.arenaId,
									).length
								}
							</span>
						</Toggle>
					))}
				</ToggleGroup>
			</FilterRow>
			<DivisionFilter
				divisions={games.flatMap((g) => getDivisions(g.game))}
				selected={filters.divisions}
				onChange={(divisions) => onChange({divisions})}
			/>
		</FilterBar>
	)
}

/**
 * A FilterBar row of division pills. Numbered divisions share a pill
 * ("Division 4" for 4A-4C) whose menu narrows it to some sub-divisions.
 */
export const DivisionFilter = ({
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
	return (
		<FilterRow label="Division">
			{groupDivisions(new Set(divisions)).map((group) => (
				<DivisionPill
					key={group.label}
					group={group}
					selected={selected}
					onChange={onChange}
				/>
			))}
		</FilterRow>
	)
}

interface DivisionGroup {
	/** "Division 4", or a division without sub-divisions, e.g. "40+ Fall 26" */
	label: string
	/** e.g. ["Division 4A", "Division 4B"] */
	divisions: string[]
}

/**
 * `items` in the order DivisionFilter lists their divisions (numbered ones
 * first, e.g. 40+ and women's last). Use it for anything listed per
 * division, so pages read in the same order as their filter.
 */
export function sortByDivision<T>(items: T[], getDivision: (item: T) => string): T[] {
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

/**
 * A division's pill: pressing it selects (or clears) every sub-division, and
 * its chevron opens a checklist to narrow down to some of them.
 */
const DivisionPill = ({
	group,
	selected,
	onChange,
}: {
	group: DivisionGroup
	selected: string[]
	onChange: (selected: string[]) => void
}) => {
	const chosen = group.divisions.filter((d) => selected.includes(d))
	const pressed = chosen.length > 0
	const toggleAll = () => {
		const others = selected.filter((d) => !group.divisions.includes(d))
		onChange(pressed ? others : [...others, ...group.divisions])
	}
	if (group.divisions.length === 1) {
		return (
			<Toggle
				className="FilterPill"
				pressed={pressed}
				onPressedChange={toggleAll}
			>
				{group.label}
			</Toggle>
		)
	}
	const label =
		pressed && chosen.length < group.divisions.length
			? `${group.label} · ${chosen.map(getSubdivisionName).join(", ")}`
			: group.label
	return (
		<span
			className={cx("FilterPill", "FilterPill--split")}
			data-pressed={pressed ? "" : undefined}
		>
			<button
				type="button"
				className="FilterPill-main"
				aria-pressed={pressed}
				onClick={toggleAll}
			>
				{label}
			</button>
			<Menu.Root>
				<Menu.Trigger
					className="FilterPill-menu"
					aria-label={`Choose ${group.label} sub-divisions`}
				>
					<ChevronIcon />
				</Menu.Trigger>
				<Menu.Portal>
					<Menu.Positioner sideOffset={6} align="start">
						<Menu.Popup className="SelectPopup">
							{group.divisions.map((division) => (
								<Menu.CheckboxItem
									key={division}
									className="SelectOption"
									closeOnClick={false}
									checked={selected.includes(division)}
									onCheckedChange={(checked) => {
										onChange(
											checked
												? [...selected, division]
												: selected.filter(
														(d) => d !== division,
													),
										)
									}}
								>
									<span className="SelectOption-check">
										✓
									</span>
									{division}
								</Menu.CheckboxItem>
							))}
						</Menu.Popup>
					</Menu.Positioner>
				</Menu.Portal>
			</Menu.Root>
		</span>
	)
}

/** "Division 4A" -> "4A" */
function getSubdivisionName(division: string): string {
	return division.replace(/^Division /, "")
}

export const GameList = ({
	games,
	seasonId,
	now,
}: {
	games: ScheduledGame[]
	seasonId: string
	now: Date
}) => {
	if (games.length === 0) {
		return (
			<div className="GameList-empty">No games match these filters.</div>
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
					<ol className="GameList-list">
						{dayGames.map(({rink, game}) => (
							<GameRow
								key={game.gameId}
								rink={rink}
								game={game}
								seasonId={seasonId}
								now={now}
							/>
						))}
					</ol>
				</section>
			))}
		</div>
	)
}

const GameRow = ({
	rink,
	game,
	seasonId,
	now,
}: {
	rink: Rink
	game: RinkGame
	seasonId: string
	now: Date
}) => {
	const live = Date.parse(game.startsAt) <= now.getTime()
	return (
		<li className={cx("GameList-game", live && "GameList-game--live")}>
			{/* The row's link to the game; its hit area covers the row */}
			<Link
				className={cx("GameList-time", "StretchedLink")}
				href={getGameHref(game.gameId)}
				aria-label={`${game.awayTeam.name} at ${game.homeTeam.name}, ${formatGameTime(game.startsAt)}`}
			>
				{live ? (
					<>
						<span className="GameList-live">LIVE</span>
						<span className="GameList-started">
							{formatGameTime(game.startsAt)}
						</span>
					</>
				) : (
					formatGameTime(game.startsAt)
				)}
			</Link>
			<div className="GameList-rink">
				<CityDot city={rink.city} />
				<span className="GameList-rink-text">
					<RinkLink
						className="GameList-rink-name"
						arena={{id: rink.arenaId, name: rink.name}}
					/>
					<span className="GameList-rink-city">
						{getCityName(rink.city)}
					</span>
				</span>
			</div>
			<div className="GameList-teams">
				{(
					[
						[game.awayTeam, "away"],
						[game.homeTeam, "home"],
					] as const
				).map(([team, homeAway]) => (
					<div key={team.id} className="GameList-team">
						<HomeAwayBadge homeAway={homeAway} truncated />
						<TeamAvatar
							name={team.name}
							logoUrl={team.logoUrl}
							size={22}
						/>
						<TeamLink team={team} seasonId={seasonId} />
					</div>
				))}
			</div>
			<div className="GameList-divisions">
				{getDivisions(game).map((division) => (
					<span key={division} className="GameList-division">
						{division}
					</span>
				))}
			</div>
			<div className="GameList-links">
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
						title={
							live
								? `Watch live on LiveBarn (${surface.surfaceName})`
								: `Open ${surface.surfaceName} on LiveBarn`
						}
					/>
				))}
			</div>
		</li>
	)
}

/** Games that haven't finished yet, across every rink, soonest first. */
export function getScheduledGames(rinks: Rink[], now: Date): ScheduledGame[] {
	const cutoff = now.getTime() - LEAGUE.GAME_DURATION_MINUTES * 60_000
	return rinks
		.flatMap((rink) => rink.games.map((game) => ({rink, game})))
		.filter(({game}) => Date.parse(game.startsAt) > cutoff)
		.sort((a, b) => a.game.startsAt.localeCompare(b.game.startsAt))
}

/** Games matching the day filter, then those also matching rink and division */
export function filterScheduledGames(
	games: ScheduledGame[],
	filters: GameFilterValues,
	now: Date,
): {forDay: ScheduledGame[]; visible: ScheduledGame[]} {
	const forDay = games.filter((g) => matchesDay(g.game, filters.day, now))
	const visible = forDay.filter((g) => {
		return (
			(filters.rinks.length === 0 ||
				filters.rinks.includes(g.rink.arenaId)) &&
			(filters.divisions.length === 0 ||
				getDivisions(g.game).some((d) => filters.divisions.includes(d)))
		)
	})
	return {forDay, visible}
}

function matchesDay(game: RinkGame, day: DayFilter, now: Date): boolean {
	const key = getLeagueDayKey(new Date(game.startsAt))
	const today = getLeagueDayKey(now)
	switch (day) {
		case "all":
			return true
		case "today":
			return key === today
		case "tomorrow":
			return (
				key ===
				getLeagueDayKey(new Date(now.getTime() + 24 * 60 * 60_000))
			)
		case "week":
			return key <= getEndOfWeekDayKey(now)
	}
}

function getDivisions(game: RinkGame): string[] {
	return [
		...new Set(
			[game.awayTeam.divisionName, game.homeTeam.divisionName].flatMap(
				(d) => d ?? [],
			),
		),
	]
}

const getCityName = (id: string) => getCity(id)?.name ?? id

// --- Head-to-head

interface HeadToHeadTeam {
	id: string
	name: string
}

interface HeadToHeadProps {
	/** Listed first in each game, e.g. the away team */
	left: HeadToHeadTeam
	right: HeadToHeadTeam
	/** Newest first */
	games: HeadToHeadGame[]
	now: Date
}

/** Earlier results between two teams: the series so far, then each game. */
export const HeadToHead = ({left, right, games, now}: HeadToHeadProps) => {
	const scored = games.flatMap((g) => (g.goals ? [g.goals] : []))
	const wins = (teamId: string, otherId: string) => {
		return scored.filter((goals) => goals[teamId]! > goals[otherId]!).length
	}
	const leftWins = wins(left.id, right.id)
	const rightWins = wins(right.id, left.id)
	const ties = scored.length - leftWins - rightWins
	const leader =
		leftWins > rightWins ? left : rightWins > leftWins ? right : null
	return (
		<section className="Detail-panel">
			<h2 className={cx("SectionLabel", "Detail-panel-title")}>
				Head-to-head
				{games.length > 0 && ` · ${games.length}`}
			</h2>
			{games.length === 0 ? (
				<p className="Detail-empty">
					No earlier games between these teams in recent seasons.
				</p>
			) : (
				<>
					{scored.length > 0 && (
						<div className="HeadToHead-series">
							<span className="HeadToHead-series-team">
								{left.name}
							</span>
							<span
								className={cx(
									"HeadToHead-series-wins",
									leader === left &&
										"HeadToHead-series-wins--leader",
								)}
							>
								{leftWins}
							</span>
							<span className="HeadToHead-series-sep">–</span>
							<span
								className={cx(
									"HeadToHead-series-wins",
									leader === right &&
										"HeadToHead-series-wins--leader",
								)}
							>
								{rightWins}
							</span>
							<span className="HeadToHead-series-team">
								{right.name}
							</span>
							<span className="HeadToHead-series-note">
								{leader
									? `${leader.name} lead the series`
									: "Series even"}
								{ties > 0 &&
									` · ${ties} ${ties === 1 ? "tie" : "ties"}`}
							</span>
						</div>
					)}
					<ol className="HeadToHead-list">
						{games.map((game) => (
							<HeadToHeadItem
								key={game.gameId ?? game.startsAt}
								game={game}
								left={left}
								right={right}
								now={now}
							/>
						))}
					</ol>
				</>
			)}
		</section>
	)
}

/** One earlier game, always listed in left/right order. */
const HeadToHeadItem = ({
	game,
	left,
	right,
	now,
}: {
	game: HeadToHeadGame
	left: HeadToHeadTeam
	right: HeadToHeadTeam
	now: Date
}) => {
	const leftGoals = game.goals?.[left.id]
	const rightGoals = game.goals?.[right.id]
	const side = (
		team: HeadToHeadTeam,
		goals: number | undefined,
		other: number | undefined,
	) => (
		<span
			className={cx(
				"HeadToHead-team",
				goals !== undefined &&
					other !== undefined &&
					goals > other &&
					"HeadToHead-team--won",
			)}
		>
			<span className="HeadToHead-team-name">{team.name}</span>
			{team.id === game.homeTeamId && (
				<HomeAwayBadge homeAway="home" truncated />
			)}
		</span>
	)
	const score =
		leftGoals !== undefined && rightGoals !== undefined
			? formatScore(leftGoals, rightGoals)
			: "–"
	return (
		<li className="HeadToHead-item">
			{side(left, leftGoals, rightGoals)}
			{game.gameId ? (
				<Link
					className="HeadToHead-score"
					href={getGameHref(game.gameId)}
					title="Open the box score"
				>
					{score}
				</Link>
			) : (
				<span className="HeadToHead-score">{score}</span>
			)}
			{side(right, rightGoals, leftGoals)}
			<span className="HeadToHead-when">
				{formatGameDate(game.startsAt, now)}
				{game.arena && ` · ${game.arena.name}`}
				{game.livebarn.map((link) => (
					<LiveBarnBadge
						key={link.surfaceId}
						href={link.vodUrl}
						surfaceName={
							game.livebarn.length > 1 ? link.surfaceName : undefined
						}
						title={`Watch the replay on LiveBarn (${link.surfaceName})`}
					/>
				))}
				{game.livebarn.length === 0 && <NotOnLiveBarn />}
			</span>
		</li>
	)
}
