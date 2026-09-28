# test/ — suites & fixtures

Node's built-in test runner (`node --import tsx --test test/**/*.test.ts`). Run via `pnpm test`.

## Fixtures

`test/fixtures/` — minimal canvas-export source and screen definitions for adapter unit tests. Examples under `examples/` may reference these paths relatively.

## Conventions

- Import implementation from `../src/...js` (tsx resolves TypeScript).
- Prefer deterministic assertions (hashes, enum order) over wall-clock fields.
- Add a new `*.test.ts` file when adding adapters or commands; keep `package.json` `test` script glob in sync.
