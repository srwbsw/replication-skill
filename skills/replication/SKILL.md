---
name: replication
description: >-
  Closed-world browser-to-browser UI replication and diffing: compare two HTTP
  origins — a live site, a local dev server (Vite, Next.js, or anything else, since
  both are just an HTTP origin), or frozen reference markup — via DOM-tree structure
  + text + computed-style diffing (no SSIM/pixel comparison). Builds the closed-world
  screen catalog from whichever source you have: a design-canvas export
  (`canvas-export`), a bounded same-origin crawl of a live site or dev server with no
  export file needed at all (`site-crawl`), or a bare `[{slug, designPath, livePath}]`
  list when you already know the pages (`url-pairs`). Then map/verify with
  compare + surplus — never manual path hunting. Use when replicating another
  app/site, or diffing two deployments of the same app, over a defined, finite
  surface area.
---

# Replication (closed-world)

**Invariant:** the catalog is the complete verification surface. If it is not in `catalog.json`, it is out of scope. Nothing outside the catalog is touched once it's built — discovery (if any) only happens as an explicit, bounded catalog-building step, never as ad hoc crawling during compare/verify.

## Choose a source

| Goal | Adapter | Status |
|------|---------|--------|
| Single-file design-canvas export (screen enum + conditional regions) | `canvas-export` | implemented |
| Clone a live site or local dev server, no export file — bounded same-origin crawl from seed URL(s) | `site-crawl` | implemented (discovery engine); `catalog` CLI wiring for its async crawl isn't done yet — see note below |
| You already know the exact page list — a flat `[{slug, designPath, livePath}]` JSON file, zero discovery | `url-pairs` | implemented |
| Match an existing app's router table | `router-migration` | planned |

All three implemented adapters feed the same generic `catalog.json` screen shape (`designPath`/`livePath`/`rootSelector`/...). `compare` and `surplus` never branch on which adapter built the catalog — see `references/adapters.md` for per-adapter detail.

## Golden path

Resolve the runner, run phases in order, read the result line:

```bash
REPLICATE_SCRIPT="${REPLICATION_CLI:-$(command -v replicate || true)}"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/.local/bin/replicate"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/bin/replicate"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/.replication-skill/bin/replicate.js"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/plugins/replication-skill/bin/replicate.js"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$(printf '%s\n' "$HOME"/.claude/plugins/cache/replication-skill/replication-skill/*/bin/replicate.js 2>/dev/null | grep -v '\*' | sort -V | tail -1)"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$PWD/bin/replicate.js"
```

### A — from a design-canvas export

```bash
"$REPLICATE_SCRIPT" init --adapter canvas-export --entry path/to/export --screen-definitions screen-definitions.json --cwd <workspace>
"$REPLICATE_SCRIPT" catalog --freeze --cwd <workspace>
"$REPLICATE_SCRIPT" catalog --check --cwd <workspace>
# Freeze reference HTML in the consumer project (e.g. design-parity:build) and serve it at
# design.baseUrl. `replicate build-reference` does not exist as a CLI command — this step is
# consumer-side work (see references/phases.md, Phase 2).
```

### B — from a live site or a local dev server, no export file at all

`site-crawl` same-origin BFS-crawls from seed path(s) using a real headless browser (Playwright), so it follows JS-rendered navigation too, not just links present in the initial HTML response — this works the same whether `source.entry` is a deployed site or `http://localhost:5173`.

```bash
"$REPLICATE_SCRIPT" init --adapter site-crawl --entry https://example.com --cwd <workspace>
# optionally add source.crawl to .replication/replication.config.json
# (defaults: seeds ["/"], maxDepth 2, maxPages 500), e.g.:
#   "crawl": { "seeds": ["/"], "maxDepth": 2, "maxPages": 200, "denyPatterns": ["/blog/*"] }
"$REPLICATE_SCRIPT" catalog --freeze --cwd <workspace>
```

**Known limitation (verified live on this version):** `catalog --freeze`/`--check` currently only drive adapters whose catalog build is synchronous. `site-crawl`'s build runs a real browser crawl and is `async`, so the last command above exits 1 today with `catalog: adapter "site-crawl" builds asynchronously, which this command does not support yet.` (`init` itself works fine — only `catalog` is blocked.) The crawl/discovery engine is real and unit-tested (`test/site-crawl-discover.test.ts`, `test/site-crawl-catalog.test.ts`, calling `buildSiteCrawlCatalog`/`discoverSiteCrawl` directly). Until the CLI's `catalog` command is wired for async adapters: call `buildSiteCrawlCatalog` yourself from a short script to materialize `catalog.json`, or use `url-pairs` below, which is fully CLI-usable today. Details: `references/troubleshooting.md`.

If you already know the finite page list — you crawled the site yourself, or you're migrating N specific known routes — skip discovery entirely with `url-pairs`:

```bash
cat > pairs.json <<'EOF'
[
  { "slug": "home", "designPath": "/", "livePath": "/" },
  { "slug": "pricing", "designPath": "/pricing", "livePath": "/pricing" }
]
EOF
"$REPLICATE_SCRIPT" init --adapter url-pairs --entry pairs.json --cwd <workspace>
"$REPLICATE_SCRIPT" catalog --freeze --cwd <workspace>
"$REPLICATE_SCRIPT" catalog --check --cwd <workspace>
```

### Compare + surplus — same two-origin model for every adapter

```bash
"$REPLICATE_SCRIPT" compare --design-url <design-origin> --target-url <target-origin> --report --cwd <workspace>
"$REPLICATE_SCRIPT" surplus --report --cwd <workspace>
```

`compare` loads both origins live in Playwright and diffs DOM structure + text + computed styles per catalog screen — there is no SSIM/pixel-diff comparison implemented. `surplus` flags implementation routes not present in the catalog. See `references/parity.md`.

Stdout ends with `REPLICATION_RESULT: {…}` — parse the **last** line. Details: `references/output-contract.md`.

## Agent rules (short)

- Work only from `catalog.json` slugs.
- For `canvas-export`, navigation targets come from `routes.json` `handlers` (discovered from source), never from button labels alone. `site-crawl` and `url-pairs` already fix `livePath` per screen in the catalog — no separate handler-mapping step.
- Do not hand-edit frozen `reference/` or `catalog.json` to pass checks.
- Manual “looks fine” is not verification — only CLI exit codes.
- **Two HTTP origins:** design (`design.baseUrl` or `--design-url`) and implementation (`target.baseUrl` or `--target-url`). Default viewport desktop **1920×1080**.
- Run `compare` after chrome/UI edits; run `surplus` when pruning routes not in the design catalog.

## More detail

- Phases: `references/phases.md`
- Browser parity: `references/parity.md`
- Adapters: `references/adapters.md`
- Failures: `references/troubleshooting.md`
