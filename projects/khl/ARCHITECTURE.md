# KHL+ architecture

KHL+ is a faster, friendlier front end for [krakenhockeyleague.com](https://krakenhockeyleague.com). The league has no API, so a Bun/Express server scrapes its HTML pages, caches them in memory, joins them with LiveBarn's venue data and a small SQLite database, and serves typed JSON to a React single-page app.

```mermaid
flowchart LR
    subgraph Browser
        Pages["pages/*.tsx<br/>one route per file"]
        UI["Components.tsx · Games.tsx · Compare.tsx"]
        Util["Util.ts<br/>useAsync · router context · format* · get*Href"]
        ClientLog["initClientLogging<br/>BatchingLogTransport"]
        Pages --> UI
        Pages --> Util
    end

    subgraph Shared["src/shared (imported by both sides)"]
        ApiJson["ApiJson.ts<br/>*_ENDPOINT contracts + zod schemas"]
        KHLJson["KHLJson.ts<br/>scraped shapes"]
        Config["KHLConfig.ts · LeagueTime.ts · Cities.ts"]
    end

    subgraph Server["Server process (Bun)"]
        Express["Server.ts<br/>registerEndpoint handlers"]
        Cache[("cached()<br/>in-memory Map")]
        KHL["KHL.ts<br/>getKHL* → fetchKHLPage → parseKHL*"]
        LB["LiveBarn.ts"]
        Arenas["Arenas.ts<br/>hand-kept arena ↔ surface map"]
        DB["Database.ts<br/>KHLDatabase"]
        Status["Status.ts<br/>5-min health checks"]
    end

    SQLite[("SQLite<br/>data/khl.sqlite")]
    KHLSite(["krakenhockeyleague.com<br/>HTML"])
    LBAPI(["LiveBarn API<br/>JSON"])

    Util -- "doRequest(ENDPOINT)" --> ApiJson
    ApiJson -- "HTTP /api/*" --> Express
    ClientLog -- "POST /api/logs" --> Express
    Express --> Cache
    Cache --> KHL
    Cache --> LB
    Express --> Arenas
    Express --> DB
    Status --> DB
    DB --> SQLite
    KHL -- "≤2 concurrent" --> KHLSite
    LB --> LBAPI
    Status -. "HEAD" .-> KHLSite
    Status -. "HEAD" .-> LBAPI
```

## Components

| Component | Files | Responsibility |
| --- | --- | --- |
| Scraper | `src/server/KHL.ts` | One `getKHL*` per league page. Each fetches through `fetchKHLPage` (a 2-request concurrency limiter around `doFetch`) and hands the DOM to a pure `parseKHL*` that returns a `KHLJson` shape or throws `newParseError`. Knows nothing about caching or the API. |
| LiveBarn client | `src/server/LiveBarn.ts` | Fetches the venues list (validated by `LiveBarnJson.ts`). The live/VOD watch URLs are built by `src/shared/LiveBarn.ts`, so the client can link scoresheet events to their moment in a replay. |
| Arena mapping | `src/server/Arenas.ts` | Hand-maintained map from KHL arena id to LiveBarn surfaces, display name, and city. The two sites disagree on names and addresses, so nothing here is inferred. |
| API server | `src/server/Server.ts` | Express app. Owns the `cached()` layer and TTLs, composes scraped pages into API responses, enriches them (LiveBarn links, logos, preview stats, rosters), serves the built SPA, and maps errors to status codes. |
| Database | `src/server/Database.ts` | `bun:sqlite` with append-only migrations. Stores the person-level player identity the KHL lacks, plus status-check history. |
| Status monitor | `src/server/Status.ts` | On boot and every 5 minutes, checks the app/DB, the KHL site, and LiveBarn, records results, and prunes to 90 days. Serves `/api/status` and `DEPLOY_INFO` (git commit). |
| Shared contracts | `src/shared/*` | `ApiJson.ts` defines every endpoint (`uri`, `method`, and request and response zod schemas). `KHLJson.ts` is the scraper's output vocabulary. `KHLConfig.ts` holds strings, URLs, league settings, and limits. `LeagueTime.ts` is the only place that knows the league's time zone, and it estimates when a scoresheet event happened from its period and clock (`getGameEventClockTime`). `LiveBarn.ts` builds watch URLs. |
| Client shell | `src/client/App.tsx`, `Util.ts` | Hand-rolled router over `history` (a `ROUTES` table and `matchRoute`), `AppContext`, per-route `ErrorBoundary`, React root error hooks, and client logging. |
| UI kit | `Components.tsx`, `Games.tsx`, `Compare.tsx`, `Styles.css` | Generic controls built on Base UI (`Picker`, `SegmentedControl`, `Hint`, `AsyncContent`, `PageShell`), game-specific views (`GameTable`, `GameCards`, `TeamForm`), and the matchup comparison bars. |
| Pages | `src/client/pages/*.tsx` | One `Route` per file: `/`, `/games`, `/games/:gameId`, `/players`, `/players/:playerId`, `/teams`, `/teams/:teamId`, `/rinks/:arenaId`, `/matchup`, `/about`, `/help`, `/api` (docs rendered from the `ApiJson.ts` endpoint objects), `/status`, and `/admin` (dev only). |

## Seams

These are the boundaries where one part of the system meets another. Most changes stay on one side of a seam. A change that crosses one usually has to touch both sides together.

### 1. Client ↔ server: `ApiJson.ts` endpoint contracts

```mermaid
sequenceDiagram
    participant Page as Page (useAsync)
    participant Req as doRequest
    participant Reg as registerEndpoint
    participant H as Handler (Server.ts)
    Page->>Req: doRequest(GET_TEAM_ENDPOINT, {teamId, season})
    Req->>Reg: GET /api/teams/:teamId?season=…
    Reg->>Reg: requestSchema.safeParse → 400 on failure
    Reg->>H: typed request
    H-->>Reg: TeamResponse
    Reg->>Reg: responseSchema.safeParse → throws (500) on drift
    Reg-->>Req: JSON
    Req-->>Page: typed data → AsyncContent
```

Both sides import the same `*_ENDPOINT` object, so a route, its parameters, and its response type can't drift silently: the server validates the request on the way in and its own response on the way out. To add an API, define the endpoint in `ApiJson.ts`, register it in `Server.ts`, and call it with `doRequest` inside `useAsync`. Every endpoint also needs a `name`, a `description`, and an `exampleRequest`, and its request fields need `.describe()`. The `/api` docs page renders all of that, plus TypeScript types generated from the zod schemas, for each endpoint in `API_DOCS_SECTIONS`. `ApiDocs.test.ts` fails if an endpoint is in neither that list nor its internal list.

In dev, Vite serves the client on `:3000` and proxies `/api` to the server on `:3001`. In production, one process serves both: `express.static(dist/website)` with an `index.html` fallback for client routes.

### 2. Scraper ↔ server: `KHLJson.ts` and `cached()`

`KHL.ts` turns HTML into `KHLJson` types and does nothing else. `Server.ts` never touches the DOM, and `KHL.ts` never caches or builds API responses. Every scraper call goes through `cached(key, ttl, load)`. That function:

- shares one in-flight promise between concurrent callers,
- drops failures so the next request retries,
- takes a TTL per key: `getSeasonTtl(isCurrentSeason)` caches the current season for 10 minutes and past seasons for 24 hours. An optional `getTtlMs` can also set the TTL from the loaded value.

When the league changes its markup, the fix belongs in the matching `parseKHL*`. When a response needs new data, add a field to `KHLJson.ts` and then use it from `Server.ts`.

The cache is in-process memory. That is why `fly.toml` keeps exactly one machine always running: a cold start loses the cache, and the KHL site starts returning 403s when it gets bursts of requests.

### 3. KHL ↔ LiveBarn: `Arenas.ts` with runtime verification

```mermaid
flowchart LR
    Game["KHLGame.arena.id"] --> Map["KHL_ARENA_LIVEBARN_SURFACES[id]"]
    Map --> V{"verifyArenaMapping<br/>(cached 24h)"}
    KA["getKHLArena(id).name"] --> V
    LS["LiveBarn venues<br/>surface + venue names"] --> V
    V -- "names match" --> Links["LiveBarnLink[]<br/>liveUrl · vodUrl"]
    V -- "mismatch / unmapped" --> Empty["[] + logger.error/warn"]
```

The two external sites share no ids. `Arenas.ts` is the join table. It records the expected names on both sides, so if either site renames or reassigns an id, the link is dropped and logged instead of pointing viewers at the wrong rink. Watch URLs use league-local date and time, which works because every mapped venue is in the league's time zone.

### 4. Scraped ids ↔ stable people: `Database.ts`

The KHL usually issues a new player id for every team registration, but some ids span several teams, so a registration is a (KHL player id, team) pair. Search results, rosters, and box scores all pass through `db.recordRegistrations(...)`, which matches each KHL id to a person-level UUID by normalized name (`normalizePlayerName`). `/players/:playerId` uses that UUID and fans out to all of the person's registrations. The database lives on a Fly volume (`KHL_DB_PATH`), so those UUIDs survive deploys. Migrations in `MIGRATIONS` are append-only, and their order is tracked with `PRAGMA user_version`.

### 5. League time: `LeagueTime.ts`

The schedule lists local dates and times with no zone. `toLeagueInstant` converts them to ISO instants at parse time, `getLeagueDayKey` buckets instants into league days (used for `/api/games?date=` and status history), and `getGameEndsAt` / `isGameInProgress` apply `LEAGUE.GAME_DURATION_MINUTES`. Both the server and the client import these functions, so "today" and "live now" mean the same thing on both sides.

### 6. Failure handling across the stack

```mermaid
flowchart TB
    subgraph Server
        PE["parseKHL* → newParseError<br/>(logger.newError)"] --> MW
        FE["doFetch → FetchError"] --> MW
        Extra["optional extras<br/>(preview stats, rosters, LiveBarn)"] -- "caught" --> Warn["logger.warn → null / []"]
        AE["ApiError(status)"] --> Reg["registerEndpoint → status JSON"]
        MW["Express error middleware<br/>logger.error"] --> Code{"FetchError?"}
        Code -- yes --> R502["502"]
        Code -- no --> R500["500"]
    end
    subgraph Client
        UA["useAsync → logger.error"] --> ES["AsyncContent / ErrorState<br/>describeError + Try again"]
        EB["ErrorBoundary per route<br/>onCaughtError / onUncaughtError"] --> CL
        WIN["window error /<br/>unhandledrejection"] --> CL
        UA --> CL["BatchingLogTransport"]
    end
    CL -- "POST /api/logs" --> SL["server Logger client.*"]
```

A 502 means the KHL or LiveBarn site failed. A 500 means a bug in our code. Optional enrichments never fail a whole page. Client logs are batched, flushed when the tab is hidden, and re-logged on the server under `client.<context>`, so one log stream covers both sides.

## Build and deploy

```mermaid
flowchart LR
    Build["tools/Build.ts (repo root)"] -- "--dev" --> Dev["vite dev :3000<br/>+ bun --watch Server.ts :3001"]
    Build -- "--deploy" --> Art["dist/website (vite build)<br/>dist/server.js (bun bundle)"]
    Art --> Img["Dockerfile<br/>oven/bun:1-slim"]
    Img --> Fly["Fly.io · 1 machine · sjc<br/>volume /data → SQLite<br/>health: /api/health"]
```

`pnpm start` / `build` / `deploy` all go through the repo's `tools/Build.ts`. The production image contains only Bun and the two bundled artifacts. `tools/Benchmark.ts` is dev-only: it uses Puppeteer to time KHL+ against the league's own site, runs from the CLI or from `/admin` via `/api/admin/benchmark`, and is imported lazily so it stays out of the production bundle.
