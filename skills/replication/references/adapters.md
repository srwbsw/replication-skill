# Adapters

| Adapter | Source | Finite catalog from |
|---------|--------|---------------------|
| `canvas-export` | Single-file design-canvas export | Screen enum + curated `screen-definitions.json` (+ future handler/state BFS) |
| `site-crawl` | Live origin (bounded) — a deployed site, or any local dev server (Vite, Next.js, or anything else — just an HTTP origin) | Seed URL(s), same-origin BFS, depth/page caps, allow/deny path globs |
| `url-pairs` | A flat JSON file you already have | `[{slug, designPath, livePath}, ...]` — zero discovery |
| `router-migration` | Existing app | Route table + param fixtures (planned) |

## canvas-export (implemented)

1. Parse export: screen enum, conditional region names, `go*` navigation handlers.
2. Merge `screen-definitions.json` (slug, `sourceState`, `livePath`, thresholds, `neutralizers`).
3. `catalog --freeze` writes discovery metadata into `catalog.json`.

Auto state explosion is intentionally **not** enabled yet; explicit definitions keep the closed world auditable.

## site-crawl (implemented)

Use when the source of truth is a browser-viewable origin, not a design file — a deployed site, or **any local dev server** (Vite, Next.js, or anything else; it only has to be an HTTP origin a real browser can load).

**Config** (`replication.config.json`):

```json
{
  "adapter": "site-crawl",
  "source": {
    "entry": "https://example.com",
    "crawl": {
      "seeds": ["/", "/pricing"],
      "maxDepth": 2,
      "maxPages": 500,
      "allowPatterns": ["/docs/*"],
      "denyPatterns": ["/blog/*"]
    }
  }
}
```

- `source.entry` — the seed **origin** URL (`https://example.com`, `http://localhost:5173`, …). Required; anything else throws at catalog-build time.
- `source.crawl.seeds` — extra seed *paths* relative to the entry origin. Default `["/"]`.
- `source.crawl.maxDepth` — BFS depth limit; seed pages are depth 0. Default `2`.
- `source.crawl.maxPages` — safety cap on total fetch attempts for one crawl, so a pathological/ever-growing site (e.g. infinite pagination) can't hang the crawl. Default `500`; when the cap is hit, the crawl stops and records a warning — it does not fail the build, the catalog is still written from whatever was found before the cap.
- `source.crawl.allowPatterns` / `denyPatterns` — simple `*`-glob patterns (e.g. `/blog/*`) matched against a **discovered link's path only** (query/hash stripped). If `allowPatterns` is non-empty, only matching links are followed/kept. Deny always wins when both match. Patterns never filter the seed paths themselves — seeds are trusted, explicit config, not attacker/author-controlled `<a href>` content.

**Discovery mechanics** (`src/adapters/site-crawl/discover.ts`):

- Sequential BFS — one page fetch in flight at a time, by design: it removes any async race between fetches, so two runs of the same crawl produce byte-identical output.
- Real-browser link discovery by default: a headless Playwright page loads each URL (`waitUntil: "networkidle"`) and reads every `a[href]` out of the *rendered* DOM — so JS-rendered navigation (an SPA/client-side router, a hydrated menu, links a framework injects after mount) is discovered, not just links present in the raw initial HTML response a plain HTTP fetch would see.
- **Same-origin only:** a discovered link is followed only when its origin exactly matches the seed origin (scheme + host + port); `mailto:`/`tel:`/`javascript:` and any cross-origin link are dropped as a hard safety boundary.
- Query strings and hash fragments are stripped before dedup — `/x?a=1`, `/x#y`, and `/x` are all treated as the single page `/x`.
- A page whose fetch throws or rejects (dead link, timeout, DNS failure, 5xx, …) is **skipped with a warning**, not a crawl-aborting error — one bad link doesn't take down an otherwise-successful catalog build.
- Each discovered page becomes exactly one catalog screen: `designPath` and `livePath` are both set to the discovered path (the "clone this site as-is" default — same path on both the design and target origin), `rootSelector` is left unset (defaults to `"body"` downstream), `status: "in-scope"`, `buildable: true`, and `adapterMeta` records `{ discoveredFrom, depth }` for provenance.
- The catalog's `source.sha256` hashes the seed URL string itself — there's no local export file to fingerprint, and live content is mutable, so the seed URL is the only always-available, deterministic fingerprint input.

**Known current limitation:** `buildSiteCrawlCatalog` is `async` (it drives a real browser), but the CLI's `catalog` command (`src/commands/catalog.ts`) currently only supports adapters whose `buildCatalog` returns synchronously — it explicitly rejects a Promise result with `catalog: adapter "site-crawl" builds asynchronously, which this command does not support yet.` This was verified live on this version: `replicate init --adapter site-crawl --entry <url>` succeeds and writes a valid config, but the very next `replicate catalog` (plain, `--freeze`, or `--check`) exits 1 with that message every time. The crawl/catalog-assembly logic itself is fully implemented and covered by tests that call `buildSiteCrawlCatalog`/`discoverSiteCrawl` directly with an injected `fetchPage` (`test/site-crawl-discover.test.ts`, `test/site-crawl-catalog.test.ts`). Until the CLI is wired for async adapters: drive it the same way tests do — call `buildSiteCrawlCatalog` from a short script to materialize `.replication/catalog.json` yourself — or use `url-pairs` for a catalog you can `catalog --freeze` via the CLI today.

## url-pairs (implemented) — the escape hatch

The bare escape hatch: zero discovery, zero ceremony. `source.entry` points at a JSON file (validated against `schemas/url-pairs-input.schema.json`) listing the pairs directly:

```json
[
  { "slug": "home", "designPath": "/", "livePath": "/" },
  { "slug": "pricing", "designPath": "/pricing", "livePath": "/pricing", "rootSelector": "#app" },
  { "slug": "legacy-faq", "designPath": "/faq", "livePath": "/help/faq", "status": "excluded", "buildable": false }
]
```

Each entry: `slug` (pattern `^[a-z0-9][a-z0-9-]*$`, required, must be unique within the file), `designPath` + `livePath` (required strings), and optional `label`, `rootSelector` (defaults to `"body"` downstream), `status` (`in-scope` | `excluded` | `unbuildable-todo`, defaults to `in-scope`), `buildable` (defaults to `true`). A malformed file (not JSON, not an array, fails schema validation, or has duplicate slugs) fails the catalog build with the specific error(s), naming the offending field/slug.

`buildUrlPairsCatalog` is a plain synchronous function — `catalog --freeze` and `catalog --check` both work with it end-to-end via the CLI today, no caveats (verified live: `init` → `catalog --freeze` → `catalog --check` all exit 0).

Use this when you already know the exact, finite page list — you ran your own crawl and just want to hand the result to `replicate`, you're migrating N specific known routes, or the surface is small enough to just type out by hand.

## router-migration (planned)

Use when cloning between frameworks (e.g. legacy SPA → App Router):

1. Import a finite route list from the source app.
2. Attach fixture params/query per slug.
3. Verify the target app implements the same surface.

## Adding an adapter

1. `src/adapters/<id>/`
2. Extend config schema via `source.*` options if needed
3. Wire `src/commands/catalog.ts` (and later freeze/report)
4. Fixture under `test/fixtures/`
5. Example under `examples/`
