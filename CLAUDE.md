# Claude Instructions

## Installing packages

Always use `pnpm add -D -w <package>` (devDependencies) unless a package is explicitly a runtime production dependency.

## Errors and logging

Every thrown error must reach a `logger.error()` from `@dvdzkwsk/logger`.

- Throw `logger.newError(subcontext, message, aux)` rather than `new Error(...)`: it logs at the throw site with structured `aux` (ids, URLs), and returns the Error to throw.
- An error deliberately caught and degraded (e.g. an optional section left empty) gets a `logger.warn` with what was skipped and the error.
- Anything that can escape goes through a top-level handler that logs it (Express error middleware, `window` error and `unhandledrejection` listeners, React root `onCaughtError` / `onUncaughtError`).
- Normalize `unknown` caught values with `toError` from `@dvdzkwsk/util/ErrorUtil`; don't reimplement `value instanceof Error ? value : new Error(String(value))`.
- Exceptions: `ApiError` (an expected HTTP status, not a fault) and errors inside a logging transport (which would feed back into the logger).

## Reuse before writing

Before adding a helper, search `pkg/util`, the project's `shared/` directory, and its existing utility modules for one that already does it. When two call sites need the same logic, extract it once rather than copying it with small variations.
