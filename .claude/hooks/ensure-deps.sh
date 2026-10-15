#!/bin/bash
set -euo pipefail

# A fresh git worktree has no node_modules, so imports silently resolve
# through the main checkout's node_modules instead. Install on first entry.

INPUT=$(cat)
DIR=$(echo "$INPUT" | jq -r '.cwd // empty')
DIR="${DIR:-${CLAUDE_PROJECT_DIR:-.}}"

ROOT=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || exit 0

if [[ -d "$ROOT/node_modules" || ! -f "$ROOT/pnpm-lock.yaml" ]]; then
  exit 0
fi

cd "$ROOT"
pnpm install --frozen-lockfile >&2
