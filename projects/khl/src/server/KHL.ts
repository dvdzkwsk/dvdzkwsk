import {createConcurrencyLimiter} from "@dvdzkwsk/util/AsyncUtil"
import {zonedTimeToDate} from "@dvdzkwsk/util/DateUtil"
import {doFetch} from "@dvdzkwsk/util/FetchUtil"
import {HTMLElement, parse} from "node-html-parser"
import {z} from "zod"
import {
	KHLDivision,
	KHLArena,
	KHLArenaSchema,
	KHLBoxScore,
	KHLBoxScoreSchema,
	KHLBoxScoreTeam,
	KHLGame,
	KHLGoal,
	KHLGameSchema,
	KHLLeagueGame,
	KHLLeagueGameSchema,
	KHLPenalty,
	KHLPlayer,
	KHLPlayerRef,
	KHLPlayerSchema,
	KHLPlayerSearchResult,
	KHLPlayerSearchResultSchema,
	KHLSeason,
	KHLSeasonStatsTable,
	KHLStandingsDivision,
	KHLStandingsPage,
	KHLStandingsPageSchema,
	KHLStandingsRow,
	KHLStatSection,
	KHLRosterRow,
	KHLTeam,
	KHLTeamStats,
	KHLTeamStatsSchema,
	KHLTeamsPage,
	KHLTeamsPageSchema,
} from "../shared/KHLJson.js"
import {LEAGUE, URLS} from "../shared/KHLConfig.js"

export async function getKHLSeasons(): Promise<KHLSeason[]> {
	const page = await getKHLTeamsPage()
	return page.seasons
}

/** Defaults to the current season. */
export async function getKHLDivisions(
	seasonId?: string,
): Promise<KHLDivision[]> {
	const page = await getKHLTeamsPage(seasonId)
	return page.divisions
}

/** Defaults to the current season. */
export async function getKHLTeams(seasonId?: string): Promise<KHLTeam[]> {
	const page = await getKHLTeamsPage(seasonId)
	return page.teams
}

/**
 * The /teams page lists every season, plus every division and team for the
 * selected season, so all of the getters above are derived from it.
 */
export async function getKHLTeamsPage(
	seasonId?: string,
): Promise<KHLTeamsPage> {
	const url = new URL("/teams/", URLS.KHL)
	if (seasonId !== undefined) {
		url.searchParams.set("season", seasonId)
	}
	const root = await fetchKHLPage(url)
	return KHLTeamsPageSchema.parse(parseKHLTeamsPage(root, url))
}

/** The season id KHL uses to search every season at once */
export const KHL_ALL_SEASONS = "0"

/**
 * Searches player registrations by name. Defaults to the current season; with
 * KHL_ALL_SEASONS there's one result per registration per season.
 */
export async function searchKHLPlayers(
	query: string,
	seasonId?: string,
): Promise<KHLPlayerSearchResult[]> {
	const url = new URL("/player-search/", URLS.KHL)
	url.searchParams.set("s", query)
	if (seasonId !== undefined) {
		url.searchParams.set("season", seasonId)
	}
	const root = await fetchKHLPage(url)
	return z
		.array(KHLPlayerSearchResultSchema)
		.parse(parseKHLPlayerSearch(root, url))
}

/**
 * A player id is a single team registration, so the team and season are
 * needed for the page to show that team's details.
 */
export async function getKHLPlayer(
	playerId: string,
	teamId: string,
	seasonId: string,
): Promise<KHLPlayer> {
	const url = new URL(`/player/${playerId}/home/`, URLS.KHL)
	url.searchParams.set("team", teamId)
	url.searchParams.set("season", seasonId)
	const root = await fetchKHLPage(url)
	return KHLPlayerSchema.parse(
		parseKHLPlayer(root, url, {playerId, teamId, seasonId}),
	)
}

export async function getKHLTeamSchedule(
	teamId: string,
	seasonId: string,
): Promise<KHLGame[]> {
	const url = new URL(`/team/${teamId}/schedule/`, URLS.KHL)
	url.searchParams.set("season", seasonId)
	const root = await fetchKHLPage(url)
	return z
		.array(KHLGameSchema)
		.parse(parseKHLTeamSchedule(root, url, {teamId, seasonId}))
}

/** A team's roster with stats for one season, plus every season it played. */
export async function getKHLTeamStats(
	teamId: string,
	seasonId: string,
): Promise<KHLTeamStats> {
	const url = new URL(`/team/${teamId}/stats/`, URLS.KHL)
	url.searchParams.set("season", seasonId)
	const root = await fetchKHLPage(url)
	return KHLTeamStatsSchema.parse(
		parseKHLTeamStats(root, url, {teamId, seasonId}),
	)
}

/** Every division's standings for a season. Defaults to the current season. */
export async function getKHLStandings(
	seasonId?: string,
): Promise<KHLStandingsPage> {
	const url = new URL("/standings/", URLS.KHL)
	if (seasonId !== undefined) {
		url.searchParams.set("season", seasonId)
	}
	const root = await fetchKHLPage(url)
	return KHLStandingsPageSchema.parse(parseKHLStandings(root, url))
}

/** Every upcoming game in the league, starting with today's. */
export async function getKHLLeagueSchedule(): Promise<KHLLeagueGame[]> {
	const url = new URL("/schedule", URLS.KHL)
	const root = await fetchKHLPage(url)
	return z.array(KHLLeagueGameSchema).parse(parseKHLLeagueSchedule(root, url))
}

/** The game's period-by-period score, goals and penalties. */
export async function getKHLBoxScore(gameId: string): Promise<KHLBoxScore> {
	const url = new URL(`/game/${gameId}/summary`, URLS.KHL)
	const root = await fetchKHLPage(url)
	return KHLBoxScoreSchema.parse(parseKHLBoxScore(root, url, gameId))
}

export async function getKHLArena(arenaId: string): Promise<KHLArena> {
	const url = new URL(`/arena/${arenaId}`, URLS.KHL)
	const root = await fetchKHLPage(url)
	return KHLArenaSchema.parse(parseKHLArena(root, url, arenaId))
}

// The site starts returning 403s when hit with ~10 concurrent requests
const limitKHLRequests = createConcurrencyLimiter(2)

async function fetchKHLPage(url: URL): Promise<HTMLElement> {
	const html = await limitKHLRequests(() => {
		return doFetch({
			method: "GET",
			url: url.toString(),
			responseFormat: "text",
			responseSchema: z.string(),
		})
	})
	return parse(html)
}

function parseKHLTeamsPage(root: HTMLElement, pageUrl: URL): KHLTeamsPage {
	// The page has two dropdowns: seasons, then divisions within the selected
	// season. An unknown season renders neither.
	const [seasonMenu, divisionMenu] = root.querySelectorAll(".btn-group")
	if (!seasonMenu || !divisionMenu) {
		throw new Error(`${pageUrl}: season not found`)
	}

	const seasons = seasonMenu
		.querySelectorAll("a.dropdown-item")
		.map((a): KHLSeason => {
			return {
				id: getSearchParam(a, "season"),
				name: a.text.trim(),
			}
		})

	// The first division item is "All Divisions" (/teams/?season=N), which
	// tells us which season the page is showing.
	const [allDivisionsItem, ...divisionItems] =
		divisionMenu.querySelectorAll("a.dropdown-item")
	if (!allDivisionsItem) {
		throw new Error(`${pageUrl}: missing "All Divisions" item`)
	}
	const currentSeasonId = getSearchParam(allDivisionsItem, "season")
	const season = seasons.find((s) => s.id === currentSeasonId)
	if (!season) {
		throw new Error(
			`${pageUrl}: season ${currentSeasonId} not in season list`,
		)
	}

	const divisions = divisionItems.map((a): KHLDivision => {
		return {
			id: matchHref(a, /^\/teams\/(\d+)\//),
			name: a.text.trim(),
			seasonId: season.id,
		}
	})
	const divisionsByName = new Map<string, KHLDivision>()
	for (const division of divisions) {
		if (divisionsByName.has(division.name)) {
			throw new Error(`${pageUrl}: duplicate division "${division.name}"`)
		}
		divisionsByName.set(division.name, division)
	}

	// Division headers and team cards are siblings in document order; each team
	// belongs to the most recent header above it. Headers only carry the
	// division name, so map them back to the dropdown entries for ids.
	const teams: KHLTeam[] = []
	let currentDivision: KHLDivision | null = null
	const sections = root.querySelectorAll(
		".bg-color-secondary .text-light, .row.border-top-light.border-bottom-light",
	)
	for (const el of sections) {
		if (el.classList.contains("text-light")) {
			const name = el.text.trim()
			currentDivision = divisionsByName.get(name) ?? null
			if (!currentDivision) {
				throw new Error(`${pageUrl}: unknown division header "${name}"`)
			}
			continue
		}
		if (!currentDivision) {
			throw new Error(`${pageUrl}: team listed before any division`)
		}
		const link = el.querySelector('a[href^="/team/"]')
		const name = el.querySelector(".text-primary")
		if (!link || !name) {
			throw new Error(`${pageUrl}: malformed team card`)
		}
		teams.push({
			id: matchHref(link, /^\/team\/(\d+)\//),
			name: name.text.trim(),
			seasonId: season.id,
			divisionId: currentDivision.id,
			logoUrl: getImageUrl(el, pageUrl),
		})
	}

	return {season, seasons, divisions, teams}
}

function parseKHLPlayerSearch(
	root: HTMLElement,
	pageUrl: URL,
): KHLPlayerSearchResult[] {
	// No matches renders no results table.
	const rows = root.querySelectorAll("table.table tbody tr")
	return rows.map((row): KHLPlayerSearchResult => {
		const [playerCell, positionCell, teamCell] = row.querySelectorAll("td")
		const playerLink = playerCell?.querySelector('a[href^="/player/"]')
		const teamLink = teamCell?.querySelector('a[href^="/team/"]')
		if (!playerLink || !positionCell || !teamCell || !teamLink) {
			throw new Error(`${pageUrl}: malformed search result row`)
		}
		return {
			playerId: matchHref(playerLink, /^\/player\/(\d+)\//),
			name: playerLink.text.trim(),
			position: positionCell.text.trim() || null,
			teamId: getSearchParam(playerLink, "team"),
			teamName: teamLink.text.trim(),
			teamLogoUrl: getImageUrl(teamCell, pageUrl),
			seasonId: getSearchParam(playerLink, "season"),
		}
	})
}

function parseKHLPlayer(
	root: HTMLElement,
	pageUrl: URL,
	ids: {playerId: string; teamId: string; seasonId: string},
): KHLPlayer {
	// Header: "#43 David Zukowski", then "Brewzers OGB - Division 5B", then the
	// position. The number is omitted for players without one.
	const heading = root.querySelector("h1.text-md-12")
	if (!heading) {
		throw new Error(`${pageUrl}: missing player heading`)
	}
	const headingMatch = heading.text.trim().match(/^(?:#(\S+)\s+)?(.+)$/)
	if (!headingMatch?.[2]) {
		throw new Error(`${pageUrl}: malformed player heading`)
	}
	const teamLine = heading.nextElementSibling?.text.trim() || null
	const position =
		heading.parentNode?.querySelector(".text-tertiary")?.text.trim() || null

	// Stat cards are grouped under the most recent "text-primary" heading:
	// the selected season, "Career Highs" and "Career Stats".
	const statSections: KHLStatSection[] = []
	for (const el of root.querySelectorAll("h1.text-primary.p2, .card-body")) {
		if (el.tagName === "H1") {
			statSections.push({title: el.text.trim(), stats: []})
			continue
		}
		const section = statSections.at(-1)
		const label = el.querySelector(".text-muted")?.text.trim()
		const value = el.querySelector(".text-primary")?.text.trim()
		if (!section || !label || value === undefined) {
			throw new Error(`${pageUrl}: malformed stat card`)
		}
		section.stats.push({
			label,
			value,
			note: el.querySelector("a")?.text.trim() || null,
		})
	}

	// Season tables ("Regular Season", "Playoffs", "Tournaments") each follow a
	// "text-secondary" heading.
	const seasonTables: KHLSeasonStatsTable[] = []
	for (const tableHeading of root.querySelectorAll("h1.text-secondary.p2")) {
		const table = tableHeading.nextElementSibling?.querySelector("table")
		if (!table) {
			throw new Error(
				`${pageUrl}: missing table for "${tableHeading.text.trim()}"`,
			)
		}
		const columns = table.querySelectorAll("thead th").map((th) => {
			return th.text.trim()
		})
		const rows = table.querySelectorAll("tbody tr").flatMap((tr) => {
			const cells = tr.querySelectorAll("td")
			const seasonLink = cells[0]?.querySelector("a")
			const teamLink = cells[1]?.querySelector('a[href^="/team/"]')
			// Totals rows have no season link
			if (!seasonLink || !teamLink) {
				return []
			}
			const stats: Record<string, string> = {}
			columns.forEach((column, i) => {
				if (i >= 2) {
					stats[column] = cells[i]?.text.trim() ?? ""
				}
			})
			return [
				{
					seasonId: getSearchParam(seasonLink, "season"),
					seasonName: seasonLink.text.trim(),
					teamId: matchHref(teamLink, /^\/team\/(\d+)\//),
					teamName: teamLink.text.trim(),
					stats,
				},
			]
		})
		seasonTables.push({title: tableHeading.text.trim(), columns, rows})
	}

	return {
		...ids,
		name: headingMatch[2].trim(),
		number: headingMatch[1] ?? null,
		position,
		teamLine,
		statSections,
		seasonTables,
	}
}

function parseKHLTeamStats(
	root: HTMLElement,
	pageUrl: URL,
	ids: {teamId: string; seasonId: string},
): KHLTeamStats {
	// The season menu links /team/:id/stats/?season=N, newest first. Its first
	// item is labelled with the team name and repeats the season being shown,
	// which is listed again in its place, so let later items win both the name
	// and the position.
	const seasons = new Map<string, string>()
	for (const a of root.querySelectorAll("a.dropdown-item")) {
		const href = a.getAttribute("href") ?? ""
		if (href.startsWith(`/team/${ids.teamId}/stats/?season=`)) {
			const seasonId = getSearchParam(a, "season")
			seasons.delete(seasonId)
			seasons.set(seasonId, a.text.trim())
		}
	}

	// Two tables: skaters (# | Player | GP | G | A | PTS | ...), then goalies
	// (# | Player | GP | MIN | W | L | ...). A team without goalie stats may
	// render only the first.
	const tables = root.querySelectorAll("table.table")
	const [skaterTable, goalieTable] = tables
	if (!skaterTable) {
		throw new Error(`${pageUrl}: missing roster table`)
	}
	const skaters = parseRosterTable(skaterTable, pageUrl)
	const goalies = goalieTable
		? parseRosterTable(goalieTable, pageUrl)
		: {columns: [], rows: []}

	return {
		...ids,
		seasons: [...seasons].map(([id, name]) => ({id, name})),
		skaterColumns: skaters.columns,
		skaters: skaters.rows,
		goalieColumns: goalies.columns,
		goalies: goalies.rows,
	}
}

function parseRosterTable(
	table: HTMLElement,
	pageUrl: URL,
): {columns: string[]; rows: KHLRosterRow[]} {
	const headers = table
		.querySelectorAll("thead th")
		.map((th) => th.text.trim())
	const columns = headers.slice(2)
	const rows = table.querySelectorAll("tbody tr").map((tr): KHLRosterRow => {
		const cells = tr.querySelectorAll("td")
		const link = cells[1]?.querySelector('a[href^="/player/"]')
		if (!link) {
			throw new Error(`${pageUrl}: roster row without a player link`)
		}
		const stats: Record<string, string> = {}
		columns.forEach((column, i) => {
			stats[column] = cells[i + 2]?.text.trim() ?? ""
		})
		return {
			playerId: matchHref(link, /^\/player\/(\d+)\//),
			number: cells[0]?.text.trim() || null,
			name: link.text.trim(),
			stats,
		}
	})
	return {columns, rows}
}

function parseKHLStandings(root: HTMLElement, pageUrl: URL): KHLStandingsPage {
	// Same two dropdowns as /teams: seasons, then divisions, whose first item
	// ("All Divisions", /standings/?season=N) says which season is shown.
	const [seasonMenu, divisionMenu] = root.querySelectorAll(".btn-group")
	if (!seasonMenu || !divisionMenu) {
		throw new Error(`${pageUrl}: season not found`)
	}
	const seasons = seasonMenu
		.querySelectorAll("a.dropdown-item")
		.map((a): KHLSeason => {
			return {
				id: getSearchParam(a, "season"),
				name: a.text.trim(),
			}
		})
	const allDivisionsItem = divisionMenu.querySelector("a.dropdown-item")
	if (!allDivisionsItem) {
		throw new Error(`${pageUrl}: missing "All Divisions" item`)
	}
	const currentSeasonId = getSearchParam(allDivisionsItem, "season")
	const season = seasons.find((s) => s.id === currentSeasonId)
	if (!season) {
		throw new Error(
			`${pageUrl}: season ${currentSeasonId} not in season list`,
		)
	}

	// Each division is a heading followed by its table. A division without
	// teams has a heading but no table.
	const divisions: KHLStandingsDivision[] = []
	let name: string | null = null
	for (const el of root.querySelectorAll("h1.text-primary, table.table")) {
		if (el.tagName === "H1") {
			name = el.text.trim()
			continue
		}
		if (!name) {
			throw new Error(`${pageUrl}: standings table before any division`)
		}
		// # | Team | GP | W | L | ...
		const columns = el
			.querySelectorAll("thead th")
			.map((th) => th.text.trim())
			.slice(2)
		const rows = el
			.querySelectorAll("tbody tr")
			.map((tr): KHLStandingsRow => {
				// Stat cells are <th>s (closed with </td>), so take both
				const cells = tr.querySelectorAll("td, th")
				const link = cells[1]?.querySelector('a[href^="/team/"]')
				if (!link) {
					throw new Error(
						`${pageUrl}: standings row without a team link`,
					)
				}
				const stats: Record<string, string> = {}
				columns.forEach((column, i) => {
					stats[column] = cells[i + 2]?.text.trim() ?? ""
				})
				return {
					teamId: matchHref(link, /^\/team\/(\d+)\//),
					teamName: link.text.trim(),
					logoUrl: getImageUrl(cells[1]!, pageUrl),
					stats,
				}
			})
		divisions.push({name, columns, rows})
		name = null
	}

	return {season, seasons, divisions}
}

function parseKHLLeagueSchedule(
	root: HTMLElement,
	pageUrl: URL,
): KHLLeagueGame[] {
	// Each game is rendered twice, for desktop and mobile; read the desktop row:
	// date | away team | time + arena | home team | game link | game sheet
	return root.querySelectorAll("tr.d-none.d-lg-block").flatMap((row) => {
		const cells = row.querySelectorAll("td")
		const [dateCell, awayCell, timeCell, homeCell, gameCell] = cells
		// Today's finished games show "2 - 3 FINAL" in place of the time and
		// arena. The schedule is only used for upcoming games, so skip them.
		if (/FINAL$/i.test(timeCell?.text.trim() ?? "")) {
			return []
		}
		const awayLink = awayCell?.querySelector('a[href^="/team/"]')
		const homeLink = homeCell?.querySelector(
			'a[href^="/team/"]:not(:has(img))',
		)
		const gameLink = gameCell?.querySelector('a[href^="/game/"]')
		if (!dateCell || !timeCell || !awayLink || !homeLink || !gameLink) {
			throw new Error(
				`${pageUrl}: malformed schedule row: ${row.text.trim()}`,
			)
		}

		// "10/14/2026" and "8:55 PM" (followed by the arena link)
		const dateMatch = dateCell.text
			.trim()
			.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
		const timeMatch = timeCell.text
			.trim()
			.match(/^(\d{1,2}):(\d{2}) (AM|PM)/)
		if (!dateMatch || !timeMatch) {
			throw new Error(
				`${pageUrl}: unparseable date/time "${dateCell.text.trim()} ${timeCell.text.trim()}"`,
			)
		}
		const hour =
			(Number(timeMatch[1]) % 12) + (timeMatch[3] === "PM" ? 12 : 0)
		const localDate = `${dateMatch[3]}-${pad2(Number(dateMatch[1]))}-${pad2(Number(dateMatch[2]))}`
		const localTime = `${pad2(hour)}:${timeMatch[2]}`
		const arenaLink = timeCell.querySelector('a[href^="/arena/"]')

		return [
			{
				id: matchHref(gameLink, /^\/game\/(\d+)\//),
				localDate,
				localTime,
				startsAt: zonedTimeToDate(
					localDate,
					localTime,
					LEAGUE.TIME_ZONE,
				).toISOString(),
				arena: arenaLink
					? {
							id: matchHref(arenaLink, /^\/arena\/(\d+)/),
							name: arenaLink.text.trim(),
						}
					: null,
				homeTeam: {
					id: matchHref(homeLink, /^\/team\/(\d+)\//),
					name: homeLink.text.trim(),
					logoUrl: getImageUrl(homeCell!, pageUrl),
				},
				awayTeam: {
					id: matchHref(awayLink, /^\/team\/(\d+)\//),
					name: awayLink.text.trim(),
					logoUrl: getImageUrl(awayCell!, pageUrl),
				},
			},
		]
	})
}

function parseKHLArena(root: HTMLElement, pageUrl: URL, id: string): KHLArena {
	// "Arena Information" heading, then the arena name and its address
	const lines = root.structuredText
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
	const at = lines.indexOf("Arena Information")
	const name = lines[at + 1]
	if (at < 0 || !name || name === "View Larger Map") {
		throw new Error(`${pageUrl}: arena not found`)
	}
	const address = lines[at + 2]
	return {
		id,
		name,
		address: address && address !== "View Larger Map" ? address : null,
	}
}

function parseKHLBoxScore(
	root: HTMLElement,
	pageUrl: URL,
	gameId: string,
): KHLBoxScore {
	const main = root.querySelector('[role="main"]')
	if (!main) {
		throw new Error(`${pageUrl}: missing main content`)
	}

	// The header lists away | time, rink and score | home. (Its mobile copy
	// has broken markup that misnests the home team.)
	const [awayCol, , homeCol] = main.querySelectorAll(".col.col_1")
	const away = parseBoxScoreTeam(awayCol, pageUrl)
	const home = parseBoxScoreTeam(homeCol, pageUrl)

	// "Oct 13, 2026 at 11:05 PM"
	const when = main.querySelector(".text-center.text-3")?.text.trim() ?? ""
	const whenMatch = when.match(
		/^(\w{3}) (\d{1,2}), (\d{4}) at (\d{1,2}):(\d{2}) (AM|PM)$/,
	)
	const monthIndex = MONTHS.indexOf(whenMatch?.[1] ?? "")
	if (!whenMatch || monthIndex < 0) {
		throw new Error(`${pageUrl}: unparseable game time "${when}"`)
	}
	const hour = (Number(whenMatch[4]) % 12) + (whenMatch[6] === "PM" ? 12 : 0)
	const localDate = `${whenMatch[3]}-${pad2(monthIndex + 1)}-${pad2(Number(whenMatch[2]))}`
	const localTime = `${pad2(hour)}:${whenMatch[5]}`
	const arenaLink = main.querySelector('a[href^="/arena/"]')

	// Before the league posts a summary the page just says "No Summary"
	const headings = main.querySelectorAll("h1")
	const findHeading = (title: string) => {
		return headings.find((h) => h.text.trim().toUpperCase() === title)
	}
	const scoringHeading = findHeading("SCORING")
	const periods: string[] = []
	if (scoringHeading) {
		const scoring = parsePeriodTable(scoringHeading, pageUrl)
		periods.push(...scoring.periods)
		applyPeriodTable(scoring, {away, home}, "goals", pageUrl)
		const shotsHeading = findHeading("SHOTS")
		if (shotsHeading) {
			applyPeriodTable(
				parsePeriodTable(shotsHeading, pageUrl),
				{away, home},
				"shots",
				pageUrl,
			)
		}
	}

	const scoringSummary = findHeading("SCORING SUMMARY")
	const penaltySummary = findHeading("PENALTY SUMMARY")
	return {
		gameId,
		localDate,
		localTime,
		startsAt: zonedTimeToDate(
			localDate,
			localTime,
			LEAGUE.TIME_ZONE,
		).toISOString(),
		arena: arenaLink
			? {
					id: matchHref(arenaLink, /^\/arena\/(\d+)/),
					name: arenaLink.text.trim(),
				}
			: null,
		away,
		home,
		hasSummary: scoringHeading !== undefined,
		periods,
		goals: scoringSummary
			? getSummaryCards(scoringSummary).map((card) => {
					return parseGoalCard(card, pageUrl)
				})
			: [],
		penalties: penaltySummary
			? getSummaryCards(penaltySummary).map((card) => {
					return parsePenaltyCard(card, pageUrl)
				})
			: [],
	}
}

function parseBoxScoreTeam(
	col: HTMLElement | undefined,
	pageUrl: URL,
): KHLBoxScoreTeam {
	const link = col?.querySelector('a[href^="/team/"]')
	const name = col?.querySelector("h1")?.text.trim()
	if (!col || !link || !name) {
		throw new Error(`${pageUrl}: missing team header`)
	}
	return {
		id: matchHref(link, /^\/team\/(\d+)\//),
		name,
		logoUrl: getImageUrl(col, pageUrl),
		seasonId: getSearchParam(link, "season"),
		goalsByPeriod: [],
		goals: null,
		shotsByPeriod: [],
		shots: null,
	}
}

interface PeriodTable {
	/** e.g. ["1", "2", "3"], without the total column */
	periods: string[]
	rows: {teamId: string; byPeriod: number[]; total: number}[]
}

/** The "SCORING" and "SHOTS" tables: Team | 1 | 2 | 3 | T, one row per team. */
function parsePeriodTable(heading: HTMLElement, pageUrl: URL): PeriodTable {
	const table = heading.nextElementSibling
	if (table?.tagName !== "TABLE") {
		throw new Error(
			`${pageUrl}: missing table for "${heading.text.trim()}"`,
		)
	}
	// The first header spans the logo and name cells
	const headers = table.querySelectorAll("thead th").map((th) => {
		return th.text.trim()
	})
	const periods = headers.slice(1, -1)
	const rows = table.querySelectorAll("tbody tr").map((tr) => {
		const cells = tr.querySelectorAll("td")
		const link = cells[1]?.querySelector('a[href^="/team/"]')
		const numbers = cells.slice(2).map((td) => Number(td.text.trim()) || 0)
		if (!link || numbers.length !== periods.length + 1) {
			throw new Error(`${pageUrl}: malformed period table row`)
		}
		return {
			teamId: matchHref(link, /^\/team\/(\d+)\//),
			byPeriod: numbers.slice(0, -1),
			total: numbers.at(-1)!,
		}
	})
	return {periods, rows}
}

function applyPeriodTable(
	table: PeriodTable,
	teams: {away: KHLBoxScoreTeam; home: KHLBoxScoreTeam},
	stat: "goals" | "shots",
	pageUrl: URL,
) {
	for (const team of [teams.away, teams.home]) {
		const row = table.rows.find((r) => r.teamId === team.id)
		if (!row) {
			throw new Error(`${pageUrl}: no ${stat} row for team ${team.id}`)
		}
		team[`${stat}ByPeriod`] = row.byPeriod
		team[stat] = row.total
	}
}

/**
 * Summary cards follow their heading as siblings, interleaved with period
 * banners ("1ST PERIOD") and "NO SCORING" notes, until the next heading.
 */
function getSummaryCards(heading: HTMLElement): HTMLElement[] {
	const cards: HTMLElement[] = []
	for (
		let el = heading.nextElementSibling;
		el && el.tagName !== "H1";
		el = el.nextElementSibling
	) {
		if (el.classList.contains("row")) {
			cards.push(el)
		}
	}
	return cards
}

/** "16:16 | 1st" */
function parsePeriodTime(
	card: HTMLElement,
	pageUrl: URL,
): {time: string; period: string} {
	for (const el of card.querySelectorAll("td, div")) {
		const match = el.text.trim().match(/^(\d{1,2}:\d{2}) \| (\S+)$/)
		if (match) {
			return {time: match[1]!, period: match[2]!}
		}
	}
	throw new Error(`${pageUrl}: missing time in "${card.text.trim()}"`)
}

function parseGoalCard(card: HTMLElement, pageUrl: URL): KHLGoal {
	const teamLink = card.querySelector('a[href^="/team/"]')
	const scorerLink = card.querySelector(
		'a.font-weight-bold[href^="/player/"]',
	)
	if (!teamLink || !scorerLink) {
		throw new Error(`${pageUrl}: malformed goal "${card.text.trim()}"`)
	}
	// "Sara Shaker (6)", then "Unassisted" or up to two assist links
	const seasonGoals = scorerLink.parentNode?.text.match(/\((\d+)\)/)?.[1]
	return {
		...parsePeriodTime(card, pageUrl),
		teamId: matchHref(teamLink, /^\/team\/(\d+)\//),
		scorer: toPlayerRef(scorerLink),
		scorerSeasonGoals: seasonGoals ? Number(seasonGoals) : null,
		assists: card
			.querySelectorAll('.mt-0 a[href^="/player/"]')
			.map(toPlayerRef),
		type: card.querySelector(".badge")?.text.trim() || null,
	}
}

function parsePenaltyCard(card: HTMLElement, pageUrl: URL): KHLPenalty {
	const teamLink = card.querySelector('a[href^="/team/"]')
	// Rendered twice, for desktop (col_1) and mobile (col_2)
	const desktop = card.querySelector(".col_1")
	const duration = card.querySelector(".badge")?.text.trim()
	if (!teamLink || !desktop || !duration) {
		throw new Error(`${pageUrl}: malformed penalty "${card.text.trim()}"`)
	}
	const playerLink = desktop.querySelector('a[href^="/player/"]')
	const infraction = playerLink
		? desktop.querySelector("span")?.text.trim()
		: desktop.text.trim()
	if (!infraction) {
		throw new Error(`${pageUrl}: penalty without an infraction`)
	}
	return {
		...parsePeriodTime(card, pageUrl),
		teamId: matchHref(teamLink, /^\/team\/(\d+)\//),
		player: playerLink ? toPlayerRef(playerLink) : null,
		infraction,
		duration,
	}
}

function toPlayerRef(link: HTMLElement): KHLPlayerRef {
	return {
		id: matchHref(link, /^\/player\/(\d+)\//),
		name: link.text.trim(),
	}
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
]

function parseKHLTeamSchedule(
	root: HTMLElement,
	pageUrl: URL,
	ids: {teamId: string; seasonId: string},
): KHLGame[] {
	const teamName = root.querySelector("h1.text-12")?.text.trim()
	if (!teamName) {
		throw new Error(`${pageUrl}: missing team name`)
	}

	// Games are grouped into one table per month, each preceded by a heading
	// like "October 2026". Rows only show "Wed, Oct 21", so the year comes from
	// the heading.
	const games: KHLGame[] = []
	let year: number | null = null
	const elements = root.querySelectorAll(
		"h1.text-primary.p2, table.table-fixed",
	)
	for (const el of elements) {
		if (el.tagName === "H1") {
			const match = el.text.trim().match(/^[A-Za-z]+ (\d{4})$/)
			year = match ? Number(match[1]) : null
			continue
		}
		if (year === null) {
			throw new Error(
				`${pageUrl}: schedule table without a month heading`,
			)
		}
		for (const row of el.querySelectorAll("tbody tr")) {
			games.push(
				parseKHLScheduleRow(row, pageUrl, {...ids, teamName, year}),
			)
		}
	}
	return games
}

function parseKHLScheduleRow(
	row: HTMLElement,
	pageUrl: URL,
	context: {teamId: string; teamName: string; seasonId: string; year: number},
): KHLGame {
	const cells = row.querySelectorAll("td")
	const [, dateCell, timeCell, arenaCell, homeAwayCell, opponentCell] = cells
	const resultCell = cells[6]
	const scoreCell = cells[7]
	// Some finished games have no summary link
	const gameLink = cells[8]?.querySelector('a[href^="/game/"]')
	const opponentLink = opponentCell?.querySelector('a[href^="/team/"]')
	if (
		!dateCell ||
		!timeCell ||
		!arenaCell ||
		!homeAwayCell ||
		!opponentLink
	) {
		throw new Error(
			`${pageUrl}: malformed schedule row: ${row.text.trim()}`,
		)
	}

	// "Wed, Oct 21" + "9:15 PM"
	const dateMatch = dateCell.text.trim().match(/^\w+, (\w{3}) (\d{1,2})$/)
	const monthIndex = MONTHS.indexOf(dateMatch?.[1] ?? "")
	const timeMatch = timeCell.text.trim().match(/^(\d{1,2}):(\d{2}) (AM|PM)$/)
	if (!dateMatch || monthIndex < 0 || !timeMatch) {
		throw new Error(
			`${pageUrl}: unparseable date/time "${dateCell.text.trim()} ${timeCell.text.trim()}"`,
		)
	}
	const hour = (Number(timeMatch[1]) % 12) + (timeMatch[3] === "PM" ? 12 : 0)
	const localDate = `${context.year}-${pad2(monthIndex + 1)}-${pad2(Number(dateMatch[2]))}`
	const localTime = `${pad2(hour)}:${timeMatch[2]}`

	const homeAway = homeAwayCell.text.trim().toLowerCase()
	if (homeAway !== "home" && homeAway !== "away") {
		throw new Error(`${pageUrl}: unexpected home/away "${homeAway}"`)
	}

	const arenaLink = arenaCell.querySelector('a[href^="/arena/"]')
	const [, gameId, gamePage] = gameLink
		? (getHref(gameLink).match(/^\/game\/(\d+)\/(\w+)/) ?? [])
		: []
	if (gameLink && !gameId) {
		throw new Error(`${pageUrl}: malformed game link`)
	}
	const result = resultCell?.text.trim() || null

	return {
		id: gameId ?? null,
		seasonId: context.seasonId,
		team: {id: context.teamId, name: context.teamName},
		opponent: {
			id: matchHref(opponentLink, /^\/team\/(\d+)\//),
			name: opponentLink.text.trim(),
		},
		homeAway,
		localDate,
		localTime,
		startsAt: zonedTimeToDate(
			localDate,
			localTime,
			LEAGUE.TIME_ZONE,
		).toISOString(),
		arena: arenaLink
			? {
					id: matchHref(arenaLink, /^\/arena\/(\d+)/),
					name: arenaLink.text.trim(),
				}
			: null,
		result,
		score: scoreCell?.text.trim() || null,
		isFinal: gamePage === "summary" || result !== null,
	}
}

function pad2(n: number): string {
	return String(n).padStart(2, "0")
}

function getImageUrl(el: HTMLElement, pageUrl: URL): string | null {
	const src = el.querySelector("img")?.getAttribute("src")
	return src ? new URL(src, pageUrl).toString() : null
}

function getHref(el: HTMLElement): string {
	const href = el.getAttribute("href")
	if (!href) {
		throw new Error(`missing href: ${el.outerHTML}`)
	}
	return href
}

function getSearchParam(el: HTMLElement, name: string): string {
	const value = new URL(getHref(el), URLS.KHL).searchParams.get(name)
	if (!value) {
		throw new Error(`missing ?${name}= in href: ${el.outerHTML}`)
	}
	return value
}

function matchHref(el: HTMLElement, pattern: RegExp): string {
	const match = getHref(el).match(pattern)
	if (!match?.[1]) {
		throw new Error(`href does not match ${pattern}: ${el.outerHTML}`)
	}
	return match[1]
}
