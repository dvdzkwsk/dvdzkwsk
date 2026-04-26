#!/bin/bash
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only check source files
if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

ERRORS=""

ESLINT_OUT=$(bunx eslint --fix "$FILE_PATH" 2>&1) || ERRORS+="ESLint errors:\n$ESLINT_OUT\n\n"

TSC_OUT=$(bunx tsc --noEmit 2>&1) || ERRORS+="TypeScript errors:\n$TSC_OUT\n"

if [[ -n "$ERRORS" ]]; then
  printf '%b' "$ERRORS"
  exit 1
fi
