import * as cp from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as url from "url"
import {createCliTool} from "../pkg/util/CliUtil.js"
import {Logger} from "../pkg/util/Logger.js"

const logger = new Logger("SetupCron")

const ROOT = path.resolve(
	path.dirname(url.fileURLToPath(import.meta.url)),
	"..",
)

interface CronEntry {
	tag: string
	schedule: string
	command: string
}

const BUN = cp.execSync("which bun", {encoding: "utf8"}).trim()

const ENTRIES: CronEntry[] = [
	{
		tag: "LibaryPowerUserHat",
		schedule: "0 9 * * *",
		command: `${BUN} ${ROOT}/tools/LibaryPowerUserHat.ts >> ${ROOT}/logs/LibaryPowerUserHat.log 2>&1`,
	},
]

function getCrontab(): string {
	try {
		return cp.execSync("crontab -l", {encoding: "utf8"})
	} catch {
		return ""
	}
}

function setCrontab(contents: string) {
	cp.execSync("crontab -", {input: contents})
}

createCliTool(import.meta, async () => {
	fs.mkdirSync(path.join(ROOT, "logs"), {recursive: true})

	const lines = getCrontab().split("\n").filter(Boolean)

	for (const entry of ENTRIES) {
		const marker = `# managed:${entry.tag}`
		const line = `${entry.schedule} ${entry.command} ${marker}`
		const i = lines.findIndex((l) => l.includes(marker))
		if (i >= 0) {
			lines[i] = line
		} else {
			lines.push(line)
		}
		logger.info("setupCron", "installed cron entry", {tag: entry.tag})
	}

	setCrontab(lines.join("\n") + "\n")
})
