import * as cp from "child_process"
import * as path from "path"
import * as url from "url"
import {createCliTool} from "../pkg/util/CliUtil.js"
import {Logger} from "../pkg/logger/Logger.js"

const logger = new Logger("SetupGitHub")

const ROOT = path.resolve(
	path.dirname(url.fileURLToPath(import.meta.url)),
	"..",
)

// PRs land as squash or rebase merges only, never as merge commits.
const REPO_SETTINGS = {
	allow_merge_commit: false,
	allow_squash_merge: true,
	allow_rebase_merge: true,
}

function gh(args: string[]): string {
	return cp.execFileSync("gh", args, {cwd: ROOT, encoding: "utf8"}).trim()
}

createCliTool(import.meta, async () => {
	const repo = gh([
		"repo",
		"view",
		"--json",
		"nameWithOwner",
		"-q",
		".nameWithOwner",
	])

	const fields = Object.entries(REPO_SETTINGS).flatMap(([key, value]) => [
		"-F",
		`${key}=${value}`,
	])
	gh(["api", "--method", "PATCH", `repos/${repo}`, ...fields, "--silent"])

	logger.info("setupGitHub", "configured repo merge settings", {
		repo,
		...REPO_SETTINGS,
	})
})
