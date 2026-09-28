# bin/ — CLI entry

## replicate.js

Thin launcher only — no business logic.

1. If `../dist/cli.js` exists → `node dist/cli.js …`
2. Else → `tsx ../src/cli.ts …` (local dev after `pnpm install`)

Agents and humans should prefer `replicate` on `PATH` (via `install.sh`) or `pnpm replicate` in a checkout.

## Exit codes (current)

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Usage error, missing config, schema failure |
| `2` | `catalog --check` drift (hash mismatch) |

Every successful command prints a final stdout line: `REPLICATION_RESULT: {…}` (JSON). Agents should parse the **last** such line; see `skills/replication/references/output-contract.md`.

## Adding a command

Implement under `src/commands/`, wire in `src/cli.ts`, document in `skills/replication/references/phases.md`.
