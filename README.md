# replication-skill

Closed-world UI replication for agents: **catalog → freeze → map → implement → verify → gate**.

If a screen is not in `catalog.json`, it is **out of scope**. Discovery is closed and explicit: catalog-building may crawl a bounded, configured surface (`site-crawl`) or read a curated/hand-written list (`canvas-export`, `url-pairs`), but nothing outside `catalog.json` is ever touched afterward — agents never ad hoc crawl the live app during compare/verify to invent paths.

Structure follows [second-agent-skill](https://github.com/srwbsw/second-agent-skill): **`bin/`** entry, **`skills/`** playbook + **`references/`**, **`AGENTS.md`** hierarchy, machine-readable **`REPLICATION_RESULT`** tail line.

## Adapters

| Adapter | Source | Status |
|---------|--------|--------|
| `canvas-export` | Single-file design-canvas export | implemented |
| `site-crawl` | Live site or local dev server (Vite, Next.js, or anything else) — bounded same-origin BFS crawl from seed URL(s), no export file | implemented (discovery); `catalog` CLI wiring for its async build isn't done yet — see `skills/replication/references/troubleshooting.md` |
| `url-pairs` | A flat `[{slug, designPath, livePath}]` JSON list you already have | implemented |
| `router-migration` | Existing app's router table | planned |

`compare` (DOM-tree structure + text + computed-style diffing — no SSIM/pixel comparison) and `surplus` (implementation routes not in the catalog) are adapter-agnostic: every adapter above produces the same generic catalog screen shape. Details: `skills/replication/references/adapters.md`.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/srwbsw/replication-skill/main/install.sh | bash
```

Auto-detects which agent CLIs you have (Claude Code, Codex, Cursor, opencode, Gemini, Qwen, Copilot, Antigravity, Kilo, Command Code), installs the plugin/skill/command adapter into each, clones to `~/.replication-skill`, builds the CLI, and symlinks `replicate` onto `PATH`. Idempotent; `install.sh --help` for `--only=`, `--ref=`, and `--uninstall`.

Review `install.sh` before `curl | bash`; pin `--ref` to a tag or SHA you trust. The installer runs `pnpm`/`npm install` and `build` in the clone (package lifecycle scripts execute with your user permissions).

Manual plugin install:

```bash
claude plugin marketplace add srwbsw/replication-skill && claude plugin install replication-skill@replication-skill
codex plugin marketplace add srwbsw/replication-skill && codex plugin add replication-skill@replication-skill
```

From a git checkout: `pnpm install && pnpm build && ./install.sh`.

## Quickstart

```bash
replicate init --adapter canvas-export --entry path/to/export \
  --screen-definitions screen-definitions.json
replicate catalog --freeze
replicate catalog --check
```

Cloning a live site or dev server with no export file? `replicate init --adapter site-crawl --entry https://example.com` (or `--entry http://localhost:5173`), or hand-list the pages with `replicate init --adapter url-pairs --entry pairs.json` — see `skills/replication/SKILL.md` for the full walkthrough and the current `site-crawl` CLI-wiring caveat.

## Repo map

| Path | Role |
|------|------|
| `skills/replication/SKILL.md` | Agent golden path |
| `skills/replication/references/` | Phases, adapters, output contract |
| `bin/replicate.js` | PATH shim → `dist/cli.js` |
| `src/` | CLI implementation |
| `schemas/` | JSON Schema |
| `examples/canvas-export-minimal/` | In-repo fixture demo |
| `test/` | `node:test` suites |

## Development

```bash
pnpm test
pnpm typecheck
pnpm replicate --help     # dev runner (tsx)
```

Read **`AGENTS.md`** before changing adapters or commands.

## License

MIT
