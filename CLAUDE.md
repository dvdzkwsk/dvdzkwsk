# Claude Instructions

## Installing packages

Always use `bun add -d <package>` (devDependencies) unless a package is explicitly a runtime production dependency.

## After making code changes

Always run the following two commands and fix any errors before finishing:

```
bunx eslint --fix .
bunx tsc --noEmit
```

- If `eslint --fix` leaves unfixable lint errors, resolve them manually.
- If `tsc` reports type errors, fix them before considering the task done.
