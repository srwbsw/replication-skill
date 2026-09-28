import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildSiteCrawlCatalog } from "../src/adapters/site-crawl/build-catalog.js";
import { siteCrawlAdapter } from "../src/adapters/site-crawl/index.js";
import type { FetchPage, FetchPageResult } from "../src/adapters/site-crawl/discover.js";
import { hashCatalogDocument } from "../src/core/hash.js";
import { validateCatalog } from "../src/core/validate.js";
import type { ReplicationConfig } from "../src/adapters/types.js";
import fs from "node:fs";

/**
 * Case list (adapter/catalog-shape layer — crawl-logic cases live in site-crawl-discover.test.ts):
 *
 * CAT1 | happy: buildSiteCrawlCatalog over the basic fixture site produces a CatalogDocument with
 *        the right shape (adapter id, schemaVersion, source.sha256, per-screen slug/designPath/
 *        livePath/adapterMeta), and it validates cleanly against schemas/catalog.schema.json.
 * CAT2 | weird (repeated invocation / determinism): building twice → identical hash + identical
 *        JSON serialization.
 * CAT3 | happy (contract): siteCrawlAdapter satisfies the ReplicationAdapter shape (id, function).
 *        Not invoked live here — see comment on the test for why.
 * CAT4 | edge (error path): a config with no usable source.entry throws a clear error, both for a
 *        missing entry and for a non-absolute-URL entry (mirrors Err1 at the adapter boundary).
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASIC_SITE_DIR = path.join(REPO_ROOT, "test/fixtures/site-crawl/basic-site");
const SEED_URL = "http://fixture.test";

function fixtureFetchPage(rootDir: string): FetchPage {
  return async (url: string): Promise<FetchPageResult> => {
    const { pathname } = new URL(url);
    const rel = pathname === "/" ? "index.html" : `${pathname.replace(/^\/+/, "")}.html`;
    const filePath = path.join(rootDir, rel);
    if (!fs.existsSync(filePath)) {
      throw new Error(`fixture file not found: ${filePath}`);
    }
    const html = fs.readFileSync(filePath, "utf8");
    const links = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]!);
    return { links };
  };
}

function baseConfig(overrides: Partial<ReplicationConfig["source"]> = {}): ReplicationConfig {
  return {
    schemaVersion: 1,
    adapter: "site-crawl",
    source: { entry: SEED_URL, ...overrides },
    target: { stack: "other", baseUrl: "http://localhost:4000" },
    outputDir: ".replication",
  };
}

// --- CAT1 (happy) --------------------------------------------------------------

test("CAT1 | buildSiteCrawlCatalog produces a valid CatalogDocument from the fixture site", async () => {
  const { catalog, warnings } = await buildSiteCrawlCatalog(REPO_ROOT, baseConfig(), {
    fetchPage: fixtureFetchPage(BASIC_SITE_DIR),
  });

  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.closedWorld, true);
  assert.equal(catalog.adapter, "site-crawl");
  assert.equal(catalog.source.entry, SEED_URL);
  assert.match(catalog.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(catalog.screens.length, 5);
  assert.deepEqual(warnings, []);

  for (const screen of catalog.screens) {
    assert.match(screen.slug, /^[a-z0-9][a-z0-9-]*$/);
    assert.equal(screen.designPath, screen.livePath, "site-crawl default is a 1:1 path mapping");
    assert.equal(screen.buildable, true);
    assert.equal(screen.status, "in-scope");
    assert.equal(screen.rootSelector, undefined, "no rootSelector set — must default downstream");
    const meta = screen.adapterMeta as { discoveredFrom: string; depth: number };
    assert.equal(typeof meta.discoveredFrom, "string");
    assert.equal(typeof meta.depth, "number");
  }

  assert.deepEqual(validateCatalog(catalog), []);
});

// --- CAT2 (weird: repeated invocation / determinism) ---------------------------

test("CAT2 | building the same catalog twice is byte-identical and hash-stable", async () => {
  const a = await buildSiteCrawlCatalog(REPO_ROOT, baseConfig(), {
    fetchPage: fixtureFetchPage(BASIC_SITE_DIR),
  });
  const b = await buildSiteCrawlCatalog(REPO_ROOT, baseConfig(), {
    fetchPage: fixtureFetchPage(BASIC_SITE_DIR),
  });
  assert.equal(JSON.stringify(a.catalog), JSON.stringify(b.catalog));
  assert.equal(hashCatalogDocument(a.catalog), hashCatalogDocument(b.catalog));
});

// --- CAT3 (happy: adapter contract) ---------------------------------------------

test("CAT3 | siteCrawlAdapter satisfies the ReplicationAdapter contract shape", () => {
  assert.equal(siteCrawlAdapter.id, "site-crawl");
  assert.equal(typeof siteCrawlAdapter.buildCatalog, "function");
  // Not invoked live here: ReplicationAdapter.buildCatalog(cwd, config) has no dependency-injection
  // slot for a test fetchPage, so calling it for real would require a live browser/network. The
  // exact function it delegates to (buildSiteCrawlCatalog) is exercised directly, with an injected
  // fetchPage, in CAT1/CAT2/CAT4.
});

// --- CAT4 (edge: error path) -----------------------------------------------------

test("CAT4 | a config with a missing source.entry throws a clear error", async () => {
  const config = baseConfig();
  (config.source as { entry?: string }).entry = "";
  await assert.rejects(
    () => buildSiteCrawlCatalog(REPO_ROOT, config, { fetchPage: fixtureFetchPage(BASIC_SITE_DIR) }),
    /source\.entry/,
  );
});

test("CAT4 | a config with a non-absolute-URL source.entry throws a clear error", async () => {
  const config = baseConfig({ entry: "not-a-url" });
  await assert.rejects(
    () => buildSiteCrawlCatalog(REPO_ROOT, config, { fetchPage: fixtureFetchPage(BASIC_SITE_DIR) }),
    /absolute URL/i,
  );
});
