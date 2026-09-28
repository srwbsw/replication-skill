# Troubleshooting

## `catalog --check` exit 2 (drift)

Source export or `screen-definitions.json` changed. Run `catalog --freeze` and commit the new `catalog.json` + `catalog.hash`.

## `screenDefinitions not found`

Path in `replication.config.json` is relative to the `--cwd` workspace, not necessarily inside `.replication/`.

## Unknown adapter

Use `canvas-export`, `site-crawl`, `url-pairs`, or `router-migration`. Older configs may still say `dc-html`, `static-site`, or `framework-migration` — they are normalized automatically (`dc-html` → `canvas-export`, `static-site` → `site-crawl`, `framework-migration` → `router-migration`).

## `replicate: command not found`

Run `./install.sh` or `pnpm build && pnpm link --global`, or use `pnpm replicate` inside a checkout.

## `catalog: adapter "site-crawl" builds asynchronously, which this command does not support yet.` (exit 1)

Known current limitation, verified on this version: the `catalog` command only drives adapters whose `buildCatalog` returns synchronously (`canvas-export` and `url-pairs` both do). `site-crawl`'s build runs a real headless-browser crawl and is `async`, so today `replicate catalog` — plain, `--freeze`, or `--check` — exits 1 for any `site-crawl`-adapter config, every time. `replicate init --adapter site-crawl ...` itself works fine; only the `catalog` command is blocked.

Workarounds until the CLI is wired for async adapters:

- Call `buildSiteCrawlCatalog` (or the lower-level `discoverSiteCrawl`) directly from a short script — the same way `test/site-crawl-catalog.test.ts` and `test/site-crawl-discover.test.ts` do — to materialize `.replication/catalog.json` yourself.
- Switch to `url-pairs`: hand-list the pages you want (your own crawl output, or a curated list) as a flat JSON file and run the normal `init` → `catalog --freeze` → `catalog --check` sequence, which is fully CLI-usable today.

## Phase 2+ commands missing

`build-reference`, `report`, and `gate` are not implemented yet. Catalog + check is the current CI slice.

## Generic browser-diff failures

These apply to every adapter — `compare` always loads two real pages in Playwright and diffs DOM structure + text + computed styles per catalog screen. There is no SSIM/pixel-diff comparison in this tool.

- **Flaky/unstable selectors.** `compare` extracts a curated DOM tree rooted at each screen's `rootSelector` (default `body`). If the design/target markup uses auto-generated or order-dependent identifiers (CSS-in-JS hashes, structure a diff would key off `nth-child` position), diffs can appear even when the two pages look identical. Narrow `rootSelector` to a stable container, or add a `neutralizers` entry for the noisy attribute/property.
- **Animation/timing flakiness.** Both pages load with `waitUntil: "networkidle"`, but a CSS transition/animation still in flight, or a client-side hydration reflow landing just after network-idle, can make one run's computed styles differ from the next run's. Re-run before trusting a single diff; prefer catalog screens whose steady state doesn't depend on something still animating.
- **Dynamic content / timestamps.** "Updated 3 minutes ago", live counters, randomized ordering, or any per-request-varying text or markup will diff between the design load and the target load even when the implementation is otherwise correct — the two loads are independent requests, not a single frozen snapshot. Mark the screen `status: "excluded"`, or add a `neutralizers` entry for that region, rather than chasing a diff that can never reach zero.
- **Auth walls.** Both `design.baseUrl` and `target.baseUrl` must be reachable without an interactive login — `compare` and the `site-crawl` crawler both navigate anonymously (no credential injection, no stored session/cookie jar). A page behind auth will either redirect (diffing against a login page instead of the real content) or fail to load entirely. Exclude those screens from the catalog, or front the origin with a pre-authenticated session/cookie it accepts before `replicate` runs.

## site-crawl-specific failures

- **Dead link during crawl.** A page whose fetch throws (404, timeout, DNS failure, 5xx, …) is skipped with a warning — it does **not** abort the crawl or fail the catalog build. If a page you expected in the catalog is missing, check the warnings list first.
- **Same-origin boundary.** Only links whose origin exactly matches the seed URL's origin (scheme + host + port) are followed — `http://localhost:5173` and `http://localhost:3000` are different origins, and a crawl seeded at one will never follow a link to the other. This is intentional (the safety boundary that keeps a crawl bounded); if your app genuinely spans multiple origins, seed/catalog each one separately, or fall back to `url-pairs` for the cross-origin pairs.
- **`maxPages` truncation.** A pathological or ever-growing site (infinite pagination, a "next" link that never ends) is capped by `maxPages` (default 500); the crawl stops and records a warning instead of hanging. Raise `maxPages` or tighten `denyPatterns` if the resulting catalog looks incomplete.
- **Why real-browser rendering matters.** Discovery loads each page in a real headless browser and reads `a[href]` out of the *rendered* DOM, not the raw HTML response — so client-side-rendered navigation (an SPA router, a hydrated mega-menu, links a framework injects only after mount) is discovered correctly. A naive fetch-and-regex/HTML-parse crawler would miss any link that only exists after JS execution; this one doesn't.
- See the `catalog: adapter "site-crawl" builds asynchronously...` entry above for the current CLI wiring gap that blocks driving this adapter's catalog build through the `catalog` command.
