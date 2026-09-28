# skills/ — replication playbook

`skills/replication/SKILL.md` is the **only** skill this repo registers. Keep it lean: invariant, golden path, resolve-script snippet, forbidden actions.

Deep docs live in `skills/replication/references/`:

| File | Contents |
|------|----------|
| `phases.md` | Phase state machine, stop conditions |
| `adapters.md` | canvas-export / site-crawl / router-migration |
| `output-contract.md` | `REPLICATION_RESULT` JSON tail line |
| `troubleshooting.md` | catalog drift, missing handlers, parity params |

When adding a CLI command or adapter, update the reference doc first, then trim SKILL.md to point at it (same pattern as second-agent's `skills/second-agent/references/`).

## Install surfaces

`install.sh` copies or links `skills/replication/` into the user's Cursor skills directory. Harness-specific adapters (Claude plugin, Codex plugin) can be added later; keep one canonical SKILL.md here.
