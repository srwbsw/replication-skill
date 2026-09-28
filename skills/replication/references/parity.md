# Browser parity (generic two-origin compare)

**Inputs (both HTTP):**

| Role | Config | CLI override | Examples |
|------|--------|--------------|----------|
| Design ground truth | `design.baseUrl` | `--design-url` | Static server over frozen `reference/` (`http://127.0.0.1:4320`), or a hosted HTML export |
| Implementation | `target.baseUrl` | `--target-url` | `next dev`, `next start`, Vite preview |

**Invariant:** comparison uses the **closed-world catalog** — each in-scope screen maps `designPath` → design URL and `livePath` → target URL (optional `target.localePrefix`). The catalog can come from any implemented adapter (`canvas-export`, `site-crawl`, `url-pairs`) — `compare`/`surplus` never branch on which one built it; they only ever read `designPath`/`livePath`/`rootSelector` off each screen.

**Viewport:** default **1920×1080** (`viewports[0]` or `--viewport desktop`). Mobile is a second pass with the same machinery.

## Commands

```bash
# 1. Serve design reference (consumer project; example anyvet-web)
pnpm design-parity:build
pnpm exec tsx tests/design-parity/static-server.ts 4320 tests/design-parity/reference

# 2. Run implementation
pnpm build && pnpm start   # or pnpm dev

# 3. Compare all catalog screens at FHD
replicate compare --cwd <workspace> \
  --design-url http://127.0.0.1:4320 \
  --target-url http://127.0.0.1:3000 \
  --report

# 4. Surplus audit (routes you built but design catalog does not cover)
replicate surplus --cwd <workspace> --report
```

`compare` loads both pages in Playwright, extracts curated computed-style trees from each screen’s `rootLocator`, and diffs structure + text + styles.

`surplus` reads `.replication/target-routes.json` (or `target.routesFile`) and lists paths not present in the catalog — candidates to delete or mark `excluded`.

## Config snippet

```json
{
  "design": { "baseUrl": "http://127.0.0.1:4320", "kind": "reference" },
  "target": {
    "stack": "next-app-router",
    "baseUrl": "http://127.0.0.1:3000",
    "localePrefix": "/th",
    "routesFile": ".replication/target-routes.json"
  },
  "viewports": [{ "name": "desktop", "width": 1920, "height": 1080 }]
}
```

## Adapters and design sources

`design.kind` describes what `design.baseUrl` actually serves; the **adapter** (`config.adapter`) describes how the catalog's `designPath`/`livePath` list was built in the first place. The two are independent — a `site-crawl`-built catalog's design origin is commonly `kind: "url"` (the live site you crawled), just as a `canvas-export`-built catalog's design origin is commonly `kind: "reference"` (a frozen static server) after a `build-reference` freeze step.

| `design.kind` | How URLs are discovered |
|---------------|-------------------------|
| `reference` | Catalog `designPath` under `design.baseUrl` (a static server over frozen `reference/**`) |
| `url` | Same mapping; `design.baseUrl` is any origin (live site, dev server) that serves those paths |

| Adapter | How the catalog's `designPath`/`livePath` list is built |
|---------|-----------------------------------------------------------|
| `canvas-export` | Parsed from a design-canvas export file + curated `screen-definitions.json` |
| `site-crawl` | Discovered by a bounded same-origin BFS crawl of a live site or dev server (no export file) |
| `url-pairs` | Read verbatim from a flat `[{slug, designPath, livePath}]` JSON file you provide — zero discovery |
| `router-migration` | planned |

HTML **files** are not opened directly — serve them (static server or `file:` is intentionally unsupported so Playwright always matches real deployment).

## Agent gate

After landing/UI work in the consumer repo:

1. `replicate catalog --check`
2. `replicate compare --report` (design + target servers running)
3. `replicate surplus --report` when route surface changes

Do not rely on manual visual review; fix until `REPLICATION_RESULT` exit `0`.
