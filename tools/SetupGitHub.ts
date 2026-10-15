import * as cp from "child_process"
import * as path from "path"
import * as url from "url"
import {Logger} from "../pkg/logger/Logger.js"
import {createCliTool} from "../pkg/util/CliUtil.js"

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

const PROTECTED_BRANCH = "master"

// Changes reach master only through a PR whose TypeScript and ESLint checks
// pass, admins included. The check names are the job names in
// .github/workflows/CI.yml. No approval is required: GitHub doesn't let
// authors approve their own PRs, so one would block a solo maintainer.
const BRANCH_PROTECTION = {
	required_status_checks: {
		strict: false,
		checks: [{context: "TypeScript"}, {context: "ESLint"}],
	},
	enforce_admins: true,
	required_pull_request_reviews: {
		required_approving_review_count: 0,
	},
	restrictions: null,
}

function gh(args: string[], input?: string): string {
	return cp
		.execFileSync("gh", args, {cwd: ROOT, encoding: "utf8", input})
		.trim()
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

	gh(
		[
			"api",
			"--method",
			"PUT",
			`repos/${repo}/branches/${PROTECTED_BRANCH}/protection`,
			"--input",
			"-",
			"--silent",
		],
		JSON.stringify(BRANCH_PROTECTION),
	)

	logger.info("setupGitHub", "configured branch protection", {
		repo,
		branch: PROTECTED_BRANCH,
		...BRANCH_PROTECTION,
	})
})
