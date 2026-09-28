# skills/ — replication playbook

`skills/replication/SKILL.md` is the **only skill** this repo registers. Keep it lean: invariant, golden path, resolve-script snippet, forbidden actions.

Deep docs live in `skills/replication/references/`:

| File | Contents |
|------|----------|
| `phases.md` | Phase state machine, stop conditions |
| `adapters.md` | canvas-export / site-crawl / router-migration |
| `output-contract.md` | `REPLICATION_RESULT` JSON tail line |
| `troubleshooting.md` | catalog drift, missing handlers, parity params |

When adding a CLI command or adapter, update the reference doc first, then trim SKILL.md to point at it (same pattern as second-agent's `skills/second-agent/references/`).

## Host integrations (multi-harness install)

Same harness set as [second-agent-skill](https://github.com/srwbsw/second-agent-skill) `install.sh` (minus engine-only hosts). `install.sh` is the source of truth; `test/install-hosts.test.cjs` checks hosts, adapter files, and snippet sync.

| Host | Adapter | Mechanism |
|------|---------|-----------|
| claude | `.claude-plugin` + `skills/replication/SKILL.md` | `claude plugin marketplace add` + `install` |
| codex | `.codex-plugin` + skills | `codex plugin marketplace add` + `add` |
| cursor | `.cursor/rules/replication.mdc` + `~/.cursor/skills/replication` symlink | symlink rule + skill dir |
| opencode | `.opencode/command/replication.md` | copy → `$XDG/opencode/command/` |
| gemini | `gemini-extension.json` + `commands/replication.toml` | `gemini extensions link` |
| qwen | reuses `commands/replication.toml` | copy → `~/.qwen/commands/` |
| copilot | reuses `skills/replication/SKILL.md` | `copilot plugin install <repo>` |
| agy | reuses skills | `agy plugin install <dir>` |
| kilo | reuses `.opencode/command/replication.md` | copy → `$XDG/kilo/command/` |
| cmd | reuses skills | `cmd skills add <repo> -g` |

Host command/rule files embed the **locate-replicate** snippet. **Edit `scripts/locate-replicate.snippet.sh` first**, then mirror into the files below (test enforces equality).

## Locating the runner — canonical snippet

Source of truth: **`scripts/locate-replicate.snippet.sh`**

```bash
REPLICATE_SCRIPT="${REPLICATION_CLI:-$(command -v replicate || true)}"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/.local/bin/replicate"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/bin/replicate"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/.replication-skill/bin/replicate.js"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/plugins/replication-skill/bin/replicate.js"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$(printf '%s\n' "$HOME"/.claude/plugins/cache/replication-skill/replication-skill/*/bin/replicate.js 2>/dev/null | grep -v '\*' | sort -V | tail -1)"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$PWD/bin/replicate.js"
```

Resolution order: `REPLICATION_CLI` → `PATH` → `~/.local/bin` / `~/bin` → managed clone → Codex local → Claude marketplace cache → repo checkout.
