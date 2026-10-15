#!/bin/bash
# Screenshots a page of the KHL dev client with headless Chrome.
# Usage: screenshot.sh <out-dir> <path> <width,height> <name> [port]
# Writes <out-dir>/<name>.png. Chrome won't lay out narrower than ~500px.
set -euo pipefail

out_dir=$1
page=$2
size=$3
name=$4
port=${5:-3998}

chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$chrome" ]; then
	chrome=$(command -v google-chrome || command -v chromium || command -v chromium-browser)
fi

"$chrome" --headless=new --disable-gpu --hide-scrollbars \
	--user-data-dir="$out_dir/chrome-profile" \
	--virtual-time-budget=15000 \
	--window-size="$size" \
	--screenshot="$out_dir/$name.png" \
	"http://localhost:$port$page" >/dev/null 2>&1

echo "$out_dir/$name.png"
