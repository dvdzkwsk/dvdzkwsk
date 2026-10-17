# Claude Instructions

## Installing packages

Always use `pnpm add -D -w <package>` (devDependencies) unless a package is explicitly a runtime production dependency.

## Worktrees

A fresh worktree has no `node_modules` or `.env` (both gitignored). Without its own `node_modules`, imports resolve through the main checkout's and workspace packages like `@dvdzkwsk/logger` fail to resolve; without `.env`, scripts like the deploy miss their tokens. `.claude/hooks/setup-worktree.sh` runs `pnpm install` and symlinks the main checkout's `.env`. It runs automatically for sessions started in a worktree; after creating one by hand, run `echo '{"cwd":"<worktree path>"}' | .claude/hooks/setup-worktree.sh` before building or running anything.

## Errors and logging

Every thrown error must reach a `logger.error()` from `@dvdzkwsk/logger`.

- Throw `logger.newError(subcontext, message, aux)` rather than `new Error(...)`: it logs at the throw site with structured `aux` (ids, URLs), and returns the Error to throw.
- An error deliberately caught and degraded (e.g. an optional section left empty) gets a `logger.warn` with what was skipped and the error.
- Anything that can escape goes through a top-level handler that logs it (Express error middleware, `window` error and `unhandledrejection` listeners, React root `onCaughtError` / `onUncaughtError`).
- Normalize `unknown` caught values with `toError` from `@dvdzkwsk/util/ErrorUtil`; don't reimplement `value instanceof Error ? value : new Error(String(value))`.
- Exceptions: `ApiError` (an expected HTTP status, not a fault) and errors inside a logging transport (which would feed back into the logger).

## Branching on unions

Branch on a union with the helpers in `@dvdzkwsk/util/MatchUtil`, not `switch`, `if`/`else` chains, or `x === "a" ? … : …` ternaries.

- `matchFn(value, {a: () => ..., b: (v) => ..., c: () => ...})` calls the handler for a string or number literal `value` and returns its result. Each handler receives `value` narrowed to its key.
- `matchValue(value, {a: "x", b: "y", c: "z"})` returns the entry for `value`. Use it when every case is a plain value rather than a computation.
- `matchField(obj, "kind", {goal: (e) => e.goal.time, penalty: (e) => e.penalty.time})` matches a tagged union on its tag field and passes each handler `obj` narrowed to that variant, so the case can read the variant's own fields.
- All three require a case for every member of the union and reject cases outside it, so adding or removing a member breaks the typecheck at every call site. A `switch` without an exhaustive `default`, or an `else` (or ternary's second branch) that absorbs "everything else", silently mishandles a new member at runtime.
- Don't widen the value to `string` or `number` to get around a missing case (that's a type error by design). Handle the new member.
- Plain conditions are still right for booleans, `null`/`undefined` checks, and strings that aren't a closed union (`process.env.NODE_ENV`, DOM values, user input before it's parsed).

## Reuse before writing

Before adding a helper, search `pkg/util`, the project's `shared/` directory, and its existing utility modules for one that already does it. When two call sites need the same logic, extract it once rather than copying it with small variations.

## Parsing external data

Parse data from outside the program with a zod schema; never cast it (`JSON.parse(text) as Foo`, `response.json() as Foo`, `Bun.TOML.parse(text) as {...}`).

- This covers JSON and TOML text, HTTP responses, CLI output (e.g. `fly ... --json`), files, `localStorage`, and env-derived config. A cast gives the shape a type it was never checked against, so a changed format shows up later as `undefined` deep in the code instead of an error where the data came in.
- Use `safeParse` and throw `logger.newError(...)` with `z.prettifyError(result.error)` in `aux`, so the failure names the source and the mismatched fields.
- Derive the type from the schema (`z.infer<typeof Schema>`) rather than declaring a separate interface that can drift.
- For HTTP, `doFetch` from `@dvdzkwsk/util/FetchUtil` already validates the response against `responseSchema`.
