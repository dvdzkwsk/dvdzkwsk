import {Logger} from "@dvdzkwsk/logger"
import {createCliTool} from "@dvdzkwsk/util/CliUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {matchFn} from "@dvdzkwsk/util/MatchUtil"
import puppeteer, {type Browser, type Page} from "puppeteer-core"
import {
	BENCHMARK_SITE_LABELS,
	RunBenchmarkResponse,
	BenchmarkRun,
	BenchmarkSite,
	BenchmarkSummary,
	BenchmarkTiming,
	DEFAULT_BENCHMARK_NAMES,
} from "../src/shared/ApiJson.js"
import {URLS} from "../src/shared/KHLConfig.js"

// Times "open the site, search for a player, open their page" on KHL+ and on
// the league's own player search, in headless Chrome. Each run starts from an
// empty browser cache. KHL+ caches scraped pages on its server, so a name's
// first run measures a cold player page and later runs a warm one.
//
//   bun tools/Benchmark.ts "Ashley Johnson" "Zach Garcia"
//
// Also run from /admin through RUN_BENCHMARK_ENDPOINT.

const logger = new Logger("Benchmark")

const KHL_PLUS_URL = "https://khl.dvdzkwsk.com/"

const CHROME_PATH =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

// The league's site stalls headless Chrome's default user agent
const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

const STEP_TIMEOUT_MS = 60_000

/** Runs each name on both sites, one at a time so they don't compete. */
export async function runBenchmark(
	names: string[],
): Promise<RunBenchmarkResponse> {
	const browser = await puppeteer.launch({
		executablePath: CHROME_PATH,
		headless: true,
	})
	const runs: BenchmarkRun[] = []
	try {
		for (const name of names) {
			for (const site of ["khl-plus", "khl"] as const) {
				runs.push(await runOne(browser, site, name))
			}
		}
	} finally {
		await browser.close()
	}
	return {
		runs,
		summaries: (["khl-plus", "khl"] as const).map((site) =>
			summarize(site, runs),
		),
	}
}

async function runOne(
	browser: Browser,
	site: BenchmarkSite,
	name: string,
): Promise<BenchmarkRun> {
	const context = await browser.createBrowserContext()
	try {
		const page = await context.newPage()
		await page.setUserAgent({userAgent: USER_AGENT})
		page.setDefaultTimeout(STEP_TIMEOUT_MS)
		const timing = await matchFn(site, {
			"khl-plus": () => timeKHLPlus(page, name),
			khl: () => timeKHL(page, name),
		})
		logger.info("runOne", "finished", {site, name, timing})
		return {site, name, timing, error: null}
	} catch (value) {
		const error = toError(value)
		logger.warn("runOne", "run failed; leaving it out of the medians", {
			site,
			name,
			error,
		})
		return {site, name, timing: null, error: error.message}
	} finally {
		await context.close()
	}
}

/** Home page, the header's type-ahead search, then the player page. */
async function timeKHLPlus(page: Page, name: string): Promise<BenchmarkTiming> {
	const start = performance.now()
	await page.goto(KHL_PLUS_URL, {waitUntil: "domcontentloaded"})
	const input = await page.waitForSelector(".SiteSearch-input", {
		visible: true,
	})
	const opened = performance.now()
	await input!.type(name)
	const result = await page.waitForSelector(".SiteSearch-item", {
		visible: true,
	})
	const searched = performance.now()
	await result!.click()
	await page.waitForSelector(".PlayerHero-name", {visible: true})
	return toTiming(start, opened, searched, performance.now())
}

/** The league's player search page, its results page, then a player page. */
async function timeKHL(page: Page, name: string): Promise<BenchmarkTiming> {
	const start = performance.now()
	await page.goto(new URL("/player-search/", URLS.KHL).href, {
		waitUntil: "domcontentloaded",
	})
	const input = await page.waitForSelector("input#s", {visible: true})
	const opened = performance.now()
	await input!.type(name)
	await Promise.all([
		page.waitForNavigation({waitUntil: "domcontentloaded"}),
		page.keyboard.press("Enter"),
	])
	const result = await page.waitForSelector(
		'a[href*="/player/"][href*="/home/"]',
		{visible: true},
	)
	const searched = performance.now()
	// Clicking the result doesn't navigate this tab in headless Chrome, so
	// follow its link instead
	const href = await result!.evaluate((a) => (a as HTMLAnchorElement).href)
	await page.goto(href, {waitUntil: "domcontentloaded"})
	await page.waitForSelector("table")
	return toTiming(start, opened, searched, performance.now())
}

function toTiming(
	start: number,
	opened: number,
	searched: number,
	end: number,
): BenchmarkTiming {
	return {
		open: opened - start,
		results: searched - opened,
		player: end - searched,
		total: end - start,
	}
}

function summarize(
	site: BenchmarkSite,
	runs: BenchmarkRun[],
): BenchmarkSummary {
	const timings = runs
		.filter((run) => run.site === site)
		.flatMap((run) => (run.timing ? [run.timing] : []))
	const medianOf = (step: keyof BenchmarkTiming) => {
		const values = timings.map((t) => t[step]).sort((a, b) => a - b)
		const mid = Math.floor(values.length / 2)
		return values.length % 2
			? values[mid]
			: (values[mid - 1] + values[mid]) / 2
	}
	return {
		site,
		runs: timings.length,
		median: timings.length
			? {
					open: medianOf("open"),
					results: medianOf("results"),
					player: medianOf("player"),
					total: medianOf("total"),
				}
			: null,
	}
}

const toSeconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

createCliTool(import.meta, async () => {
	const names = process.argv.slice(2)
	const {runs, summaries} = await runBenchmark(
		names.length ? names : DEFAULT_BENCHMARK_NAMES,
	)
	const row = (
		label: string,
		name: string,
		timing: BenchmarkTiming | null,
	) => ({
		site: label,
		name,
		open: timing ? toSeconds(timing.open) : "–",
		results: timing ? toSeconds(timing.results) : "–",
		player: timing ? toSeconds(timing.player) : "–",
		total: timing ? toSeconds(timing.total) : "–",
	})
	console.table([
		...runs.map((run) =>
			row(BENCHMARK_SITE_LABELS[run.site], run.name, run.timing),
		),
		...summaries.map((summary) =>
			row(
				BENCHMARK_SITE_LABELS[summary.site],
				`median of ${summary.runs}`,
				summary.median,
			),
		),
	])
})
