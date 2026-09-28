import { sha256Hex } from "../../core/hash.js";
import type { CatalogDocument, CatalogScreen, ReplicationConfig } from "../types.js";
import { discoverSiteCrawl } from "./discover.js";
import type { FetchPage, SiteCrawlOptions } from "./discover.js";

export interface SiteCrawlBuildDeps {
  fetchPage?: FetchPage;
}

/**
 * Assemble a CatalogDocument by crawling `config.source.entry` (a seed origin URL) same-origin,
 * BFS, per `config.source.crawl` (see SiteCrawlOptions in ./discover.ts for the exact shape and
 * its defaults). Every discovered page becomes one 1:1 in-scope, buildable screen: designPath and
 * livePath are both the discovered path (the "clone this site" default), rootSelector is left
 * unset (defaults to "body" downstream), and adapterMeta records provenance (discoveredFrom/depth).
 */
export async function buildSiteCrawlCatalog(
  cwd: string,
  config: ReplicationConfig,
  deps: SiteCrawlBuildDeps = {},
): Promise<{ catalog: CatalogDocument; warnings: string[] }> {
  void cwd; // site-crawl has no local filesystem entry to resolve against — entry is a URL.

  const seedUrl = config.source.entry;
  if (!seedUrl || typeof seedUrl !== "string") {
    throw new Error(
      'site-crawl requires source.entry (seed origin URL), e.g. "https://example.com" or "http://localhost:5173"',
    );
  }

  const crawlOpts = (config.source.crawl ?? {}) as SiteCrawlOptions;
  const { pages, warnings } = await discoverSiteCrawl(seedUrl, crawlOpts, deps);

  const screens: CatalogScreen[] = pages.map((p) => ({
    slug: p.slug,
    designPath: p.path,
    livePath: p.path,
    buildable: true,
    status: "in-scope",
    adapterMeta: { discoveredFrom: p.discoveredFrom, depth: p.depth },
  }));

  const catalog: CatalogDocument = {
    schemaVersion: 2,
    closedWorld: true,
    adapter: "site-crawl",
    source: {
      entry: seedUrl,
      // No local export file to fingerprint (unlike canvas-export) — hash the seed URL itself so
      // this required field is always a deterministic, always-available sha256, rather than trying
      // to fingerprint the live (mutable) crawled content.
      sha256: sha256Hex(seedUrl),
    },
    screens,
  };

  return { catalog, warnings };
}
