# KHL+ instructions

To run, smoke-test, typecheck, or screenshot the app, use the `run-khl` skill.

## Layout

- `src/server/KHL.ts` scrapes krakenhockeyleague.com: one `getKHL*` per page, each with a `parseKHL*` function. `KHLSyncer.ts` syncs the pages behind the site into the league tables (`LeagueDatabase.ts`), and `Server.ts` builds API responses from those tables.
- `src/shared/` is imported by both sides: API contracts (`ApiJson.ts`), scraped shapes (`KHLJson.ts`), settings (`KHLConfig.ts`), league-local time (`LeagueTime.ts`), and LiveBarn watch URLs (`LiveBarn.ts`).
- `src/client/`: `Components.tsx` holds generic UI, `Games.tsx` holds game lists, cards, and tables, `Util.ts` holds hooks, formatting, and links, and `pages/` has one route per file.

## Server

- Parse failures in `KHL.ts` throw `newParseError(pageUrl, message)` (or `newElementError`), which logs through `logger.newError`. Never use a bare `new Error`.
- Extras that a page can render without (preview stats, rosters, LiveBarn checks) are wrapped so that a KHL failure logs a `warn` and returns null or `[]` instead of failing the request.
- Errors that reach the Express error middleware are logged there. A `FetchError` (the KHL or LiveBarn site failed) returns 502, and anything else returns 500.
- Pages behind the site (teams, schedules, team stats, player pages, games) are synced into the league tables by `KHLSyncer` and read from there: use `getTeamsPage`, `getSchedule`, `getTeamStats`, `getPlayer`, `getBoxScore`, and `getGameStats`, which sync a page that never was. Don't fetch those kinds from a request, and don't write league data from a request (the search endpoint, whose pages aren't synced, is the one exception).
- New derived data goes in processing (`KHLSyncer.process*`) and the league tables (`LeagueDatabase.ts`), by id, with names joined in. Bump `PROCESSING_VERSION` when processing changes what it derives, so stored pages are reprocessed.
- Other KHL pages go through `cache.cached(key, ttl, load)`. A new fetch goes through `fetchKHLPage(url, parse)`, so a page is stored only once it parses; pass `{store: false}` for pages not worth keeping, like searches.
- When a game counts as settled, complete, or due for another look is decided in `GameRecords.ts`; use its helpers rather than restating the rule.
- Pass a registration around as a `RegistrationKey` (`toRegistrationKey`), not as separate KHL player and team ids.
- League-local dates and times come from `shared/LeagueTime.ts` (`getLeagueDayKey`, `toLeagueInstant`, `getGameEndsAt`, `isGameInProgress`, `getGameEventClockTime`, `DAY_MS`, and the other duration constants). Don't build another `Intl.DateTimeFormat` for the league's time zone or write `24 * 60 * 60_000` inline.
- Reuse the existing parsing helpers: `parseClockTime`, `parseArenaLink`, `readStatCells`, `parseSeasonMenus`, and the `TEAM_HREF`, `PLAYER_HREF`, `GAME_HREF`, and `ARENA_HREF` patterns.
- Look up teams with `findListedTeam` and `getListedDivisionName`, the current season with `getCurrentSeason()`, and rinks with `getRinkInfoOrFallback`.

## Client

- Async data loads through `useAsync` and renders with `AsyncContent`. `useAsync` and `ErrorState` already log failures, so don't add another log call.
- Set a page's `<title>` with `<PageTitle>`, not with `Helmet` directly.
- Make in-app links with `Link`, `TeamLink`, `RinkLink`, and the `get*Href` helpers in `Util.ts`.
- Word LiveBarn link tooltips with `LIVEBARN_TITLES`. Build a finished game's replay links with `toReplayLinks`.
- Render every list of games with `GameTable` by mapping the data to `GameTableRow`. For a few options, use `SegmentedControl`. For a dropdown, use `Picker`. For a tooltip, use `Hint` (never a native `title`).
- Format scores through `formatScore` / `formatKHLScore`, and dates and times through the `format*` helpers in `Util.ts`.

## Styles (`src/client/Styles.css`)

- Class names are `Component-part--modifier`, prefixed with the component that renders them. Don't borrow another component's classes (e.g. a `Compare-*` class outside `Compare.tsx`). Give the shared piece its own name instead.
- All values come from the `:root` tokens. Spacing is `calc(var(--spacing) * n)`, sizes are `var(--text-*)`, weights are `var(--weight-*)`, radii are `var(--radius-*)`, and colors are the theme variables. Pick the nearest step on a scale rather than adding a one-off value. When a new token is truly needed, add it to the scale, and for colors define it for both `:root` and `:root[data-theme="dark"]`.
- Raw values are only acceptable for 1px hairlines and optical nudges, for `50%` circles, and for sizes tied to an SVG or image.
