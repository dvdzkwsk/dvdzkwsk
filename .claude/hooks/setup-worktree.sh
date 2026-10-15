#!/bin/bash
set -euo pipefail

# A fresh git worktree has no node_modules and no .env (both gitignored), so
# imports silently resolve through the main checkout's node_modules and
# scripts miss their secrets. Set both up on first entry.

INPUT=$(cat)
DIR=$(echo "$INPUT" | jq -r '.cwd // empty')
DIR="${DIR:-${CLAUDE_PROJECT_DIR:-.}}"

ROOT=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || exit 0
COMMON_DIR=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)
MAIN_ROOT=$(dirname "$COMMON_DIR")

# Symlink rather than copy so edits to the main checkout's .env apply everywhere.
if [[ "$ROOT" != "$MAIN_ROOT" && ! -e "$ROOT/.env" && -f "$MAIN_ROOT/.env" ]]; then
  ln -s "$MAIN_ROOT/.env" "$ROOT/.env"
fi

if [[ ! -d "$ROOT/node_modules" && -f "$ROOT/pnpm-lock.yaml" ]]; then
  cd "$ROOT"
  pnpm install --frozen-lockfile >&2
fi
