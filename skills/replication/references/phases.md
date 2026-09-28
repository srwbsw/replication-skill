# Phases

Sequential state machine. Do not skip phases; do not invent inputs for a later phase.

| Phase | Command | Artifact | Stop when |
|-------|---------|----------|-----------|
| 0 Discover | `replicate init` | `.replication/replication.config.json`, `routes.json` | Config validates |
| 1 Catalog | `replicate catalog --freeze` | `catalog.json`, `catalog.hash` | Schema valid |
| 1b Pin | `replicate catalog --check` | — | Hash matches source + definitions |
| 2 Freeze | consumer `build-reference` or `design-parity:build` | `reference/**` | HTML servable at `design.baseUrl` |
| 3 Map | edit `routes.json` + app routes | handler table matches source | Every in-scope `livePath` exists |
| 4 Implement | edit target app | — | — |
| 5 Verify | `replicate compare [--slug]` | `reports/compare-*.json` | Exit 0 per slug |
| 5b Surplus | `replicate surplus` | `reports/surplus.json` | No extra public routes |
| 6 Gate | `replicate compare` (all) + `catalog --check` | CI pass | Exit 0 |

**Forbidden:** crawling undocumented URLs; expanding scope without re-running `catalog`; editing `catalog.json` by hand (extend `screen-definitions.json` and re-freeze instead).
