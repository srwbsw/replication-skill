# canvas-export minimal example

Self-contained catalog demo using `test/fixtures/minimal.canvas-export` (no external design export required).

```bash
pnpm --dir ../.. example:freeze
pnpm --dir ../.. replicate catalog --check --cwd examples/canvas-export-minimal
```

For your own target app: `replicate init --adapter canvas-export --entry <path-to-export> --cwd <workspace>`, then curate `screen-definitions.json` and `routes.json`.
