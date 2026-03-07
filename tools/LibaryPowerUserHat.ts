import * as cp from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as url from "url"
import {z} from "zod"
import {createCliTool} from "../pkg/util/CliUtil.js"
import {doRequest} from "../pkg/util/FetchUtil.js"
import {Logger} from "../pkg/util/Logger.js"

const logger = new Logger("LibaryPowerUserHat")

const ROOT = path.resolve(
	path.dirname(url.fileURLToPath(import.meta.url)),
	"..",
)
const STATE_FILE = path.join(ROOT, "logs", "LibaryPowerUserHat.state.json")

interface FailureState {
	consecutiveFailures: number
	lastFailureDate: string | null
}

function readState(): FailureState {
	try {
		const raw = fs.readFileSync(STATE_FILE, "utf8")
		return JSON.parse(raw) as FailureState
	} catch {
		return {consecutiveFailures: 0, lastFailureDate: null}
	}
}

function writeState(state: FailureState) {
	fs.mkdirSync(path.dirname(STATE_FILE), {recursive: true})
	fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function todayDate(): string {
	return new Date().toISOString().slice(0, 10)
}

const PRODUCT_URL =
	"https://studiotoujours.com/products/library-power-user-hat.js"

const ALERT_SKIP_COLOR = "Sunshine Yellow"

const ShopifyProductSchema = z.object({
	variants: z.array(
		z.object({
			id: z.number(),
			title: z.string(),
			option1: z.string().nullable(),
			available: z.boolean(),
		}),
	),
})

async function checkHatAvailability() {
	logger.info("checkHatAvailability", "fetching product data...")

	const product = await doRequest(PRODUCT_URL, ShopifyProductSchema)
	const maxLen = Math.max(
		...product.variants.map((v) => (v.option1 ?? v.title).length),
	)

	console.log("")
	for (const v of product.variants) {
		const color = (v.option1 ?? v.title).padEnd(maxLen)
		const status = v.available ? "Available" : "Sold Out"
		console.log(`${color} : ${status}`)
	}

	const available = product.variants.filter(
		(v) => v.available && v.option1 !== ALERT_SKIP_COLOR,
	)
	if (available.length > 0) {
		const colors = available.map((v) => v.option1 ?? v.title).join(", ")
		notify("Hat Alert!", `Library Power User Hat available in: ${colors}`)
	}
}

function notify(title: string, message: string) {
	const script = `display notification "${message}" with title "${title}" sound name "Glass"`
	cp.execSync(`osascript -e '${script}'`)
}

createCliTool(import.meta, async () => {
	try {
		await checkHatAvailability()
		writeState({consecutiveFailures: 0, lastFailureDate: null})
	} catch (error) {
		const state = readState()
		const today = todayDate()
		if (state.lastFailureDate !== today) {
			state.consecutiveFailures += 1
			state.lastFailureDate = today
		}
		writeState(state)
		if (state.consecutiveFailures >= 2) {
			notify(
				"Hat Check Failed",
				`LibaryPowerUserHat has failed ${state.consecutiveFailures} days in a row`,
			)
		}
		throw error
	}
})
