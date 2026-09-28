# src/ — CLI implementation

Compiled to `dist/` (`pnpm build`). `bin/replicate.js` executes `dist/cli.js`.

## Layout

```
src/
├── cli.ts              # argv parsing, dispatches commands
├── paths.ts            # package root, schema paths, .replication paths
├── commands/           # init, catalog, (future: build-reference, report, gate)
├── adapters/           # canvas-export, (future: site-crawl, router-migration)
├── core/               # hash, validate (ajv), canonical-json, result line
└── io/                 # load/write replication.config.json
```

## Adapters

Each adapter implements discover → catalog merge → (later) build-reference. Shared validation lives in `core/validate.ts`. Schemas in `schemas/*.schema.json`.

Adding an adapter: follow `skills/replication/references/adapters.md`.

## Tests

Import from `../src/...js` in `test/*.test.ts` (tsx loader). Do not test via `dist/` unless asserting the release artifact.
