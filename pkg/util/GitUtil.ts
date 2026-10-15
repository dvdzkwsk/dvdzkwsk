import {spawnSync} from "child_process"

export interface GitRevision {
	/** Full SHA of HEAD */
	commit: string
	/** Whether `paths` have uncommitted changes (including untracked files) */
	dirty: boolean
}

/**
 * The commit checked out in `cwd`, and whether `paths` (relative to `cwd`;
 * default: everything) differ from it. Null outside a git repo, or without
 * git installed.
 */
export function getGitRevision(
	cwd: string,
	paths: string[] = [],
): GitRevision | null {
	const commit = git(cwd, ["rev-parse", "HEAD"])
	const status = git(cwd, ["status", "--porcelain", "--", ...paths])
	if (commit === null || status === null) {
		return null
	}
	return {commit: commit.trim(), dirty: status.trim() !== ""}
}

function git(cwd: string, args: string[]): string | null {
	const result = spawnSync("git", args, {cwd, encoding: "utf8"})
	return result.status === 0 ? result.stdout : null
}
