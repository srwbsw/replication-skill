# replication-skill

Closed-world UI replication: a **skill** (agent playbook) plus a **CLI** (`replicate`) that derives a finite screen catalog, freezes reference markup, and (later) verifies live routes against that catalog.

Use it to clone another product from a design export, a bounded live-site crawl, or a known route map — without open-ended URL discovery.

Subsystem docs live next to the code:

- **`bin/AGENTS.md`** — CLI entry shim, PATH resolution, exit codes
- **`src/AGENTS.md`** — TypeScript layout, build, where to add commands/adapters
- **`skills/AGENTS.md`** — skill packaging and reference docs
- **`test/AGENTS.md`** — test conventions

## Layout (mirrors second-agent-skill patterns)

```
replication-skill/
├── AGENTS.md                 # this file — source of truth for agents
├── bin/replicate.js          # PATH entry (runs dist/cli.js or tsx src/cli.ts)
├── skills/replication/
│   ├── SKILL.md              # lean playbook (triggers + golden path)
│   └── references/           # phases, adapters, output contract, troubleshooting
├── src/                      # CLI implementation (tsc → dist/)
├── schemas/                  # JSON Schema for config, catalog, routes
├── examples/                 # self-contained demos (no proprietary exports)
└── test/                     # node:test suites
```

## Commands

```bash
pnpm install
pnpm build                    # tsc → dist/ (required for bin/replicate.js in production)
pnpm test                     # node:test
pnpm replicate --help         # dev: tsx via package.json script
pnpm example:freeze           # pin examples/canvas-export-minimal catalog
```

## Agent context files

`AGENTS.md` is the canonical doc. Optional symlinks for other harnesses (same pattern as second-agent-skill):

- `CLAUDE.md → AGENTS.md`

Edit only `AGENTS.md`; do not fork prose into harness-specific files.

## Install for end users

```bash
./install.sh                  # skill dir + replicate on PATH (see --help)
```

## Versioning

Hand-edit `package.json` version until a release workflow exists. Skill + CLI ship from the same repo.
