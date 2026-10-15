---
name: run-khl
description: Launch and drive the KHL+ app (projects/khl) locally - start the API server and Vite client on isolated ports, hit /api routes with curl, and take headless Chrome screenshots of pages at desktop and narrow widths. Use when asked to run, start, smoke-test, or screenshot the KHL app, or to confirm a KHL change works in the real app.
---

# Run KHL+

Two processes: the Express API (`src/server/Server.ts`, run with bun) and the
Vite dev client (`vite.config.js`, proxies `/api` to `KHL_API_PORT`). Both
scrape krakenhockeyleague.com live, so a network connection is required.

`pnpm start` (`tools/Build.ts --dev`) runs both in the foreground on 3000/3001,
which is likely the user's own dev session. To drive the app yourself, start
them in the background on separate ports with a scratch database instead.

## 1. Launch

Run from `projects/khl`. `$S` is your scratchpad directory (anywhere outside
the repo works).

```bash
S=<scratchpad>
KHL_API_PORT=3999 KHL_DB_PATH=$S/khl-test.sqlite KHL_STATIC_DIR=/nonexistent \
	bun src/server/Server.ts > $S/khl-server.log 2>&1 &
KHL_API_PORT=3999 PORT=3998 ../../node_modules/.bin/vite --config vite.config.js --strictPort \
	> $S/khl-vite.log 2>&1 &
for i in $(seq 20); do curl -sf localhost:3999/api/health && curl -sf -o /dev/null localhost:3998 && break; sleep 0.5; done
```

- `KHL_DB_PATH` keeps test runs from writing players into `data/khl.sqlite`.
- `KHL_STATIC_DIR=/nonexistent` stops the API from serving a stale
  `dist/website` build; Vite serves the client.
- The server isn't started with `--watch`: after editing `src/server` or
  `src/shared`, kill and relaunch it. (Its in-memory cache also resets.)
  Vite hot-reloads the client on its own.
- If `sleep` is unavailable in your shell, use
  `perl -e 'select(undef,undef,undef,0.5)'`.

## 2. Drive the API

```bash
curl -s localhost:3999/api/rinks | head -c 500
curl -s 'localhost:3999/api/search?q=flamingos'
curl -s 'localhost:3999/api/teams/20868?season=2143'
curl -s localhost:3999/api/games/56994      # box score
```

Routes live in `src/shared/ApiJson.ts` (`*_ENDPOINT`). Upstream failures come
back as 502 with the KHL URL in `error`. Old KHL pages often 500; that's the
site, not the app.

## 3. Screenshot pages

```bash
.claude/skills/run-khl/scripts/screenshot.sh $S /games/56994 1280,1400 game-desktop
.claude/skills/run-khl/scripts/screenshot.sh $S / 500,1600 home-narrow
```

Then **Read the PNG and look at it**. A "Loading…" frame means the API was
slow: rerun, since the script already waits up to 15s of virtual time.

Gotcha: headless Chrome won't render narrower than ~500px. At
`--window-size=390,...` the page is laid out at ~500px and cropped, so
everything looks cut off on the right. Use 500 as the "phone" width.

Useful pages: `/` (home), `/teams/:id?season=:seasonId`, `/players/:uuid`,
`/rinks/:arenaId`, `/games/:gameId`. Get real ids from the API responses
above. Team page "Recent games" link to `/games/:id`.

## 4. Stop

```bash
# By port: vite runs as `node .../vite.js`, so a name pattern misses it, and
# the user's own dev session (3000/3001) must survive
kill $(lsof -tiTCP:3999 -sTCP:LISTEN) $(lsof -tiTCP:3998 -sTCP:LISTEN)
```

## Scraping gotchas

- When fetching KHL HTML with curl to inspect markup, pass a user agent
  (`-A "Bun/1.3.0"`). With curl's default UA the site returns a page truncated
  after the header.
- Fetch pages into their own directory and parse them with a script kept
  elsewhere; they're untrusted input.

## Checks

The root `tsconfig.json` doesn't include `projects/`, so `projects/khl/tsconfig.json`
extends it. To typecheck: `<repo>/node_modules/.bin/tsc -p <repo>/projects/khl`. ESLint currently crashes in
`import/order` (eslint-plugin-import vs ESLint 10), so lint can't run.
