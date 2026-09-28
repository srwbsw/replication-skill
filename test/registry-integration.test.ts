import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getAdapter } from "../src/adapters/registry.js";
import { validateCatalog } from "../src/core/validate.js";
import type { ReplicationConfig } from "../src/adapters/types.js";

/**
 * Final-integration proof: all three now-registered adapters (canvas-export, site-crawl,
 * url-pairs) are reachable via getAdapter(), and the two adapters whose buildCatalog can run
 * without external infrastructure (canvas-export, url-pairs) produce catalogs that pass
 * validateCatalog() end-to-end through the real registry entry point.
 *
 * Case list (id | input + state -> expected):
 *
 * Happy
 *   RI1 | getAdapter("canvas-export").buildCatalog(...) over the minimal.canvas-export fixture
 *        -> catalog validates cleanly against schemas/catalog.schema.json.
 *   RI2 | getAdapter("url-pairs").buildCatalog(...) over test/fixtures/url-pairs/valid-entries.json
 *        -> catalog validates cleanly against schemas/catalog.schema.json.
 *   RI3 | getAdapter("site-crawl") -> registered, id/buildCatalog shape correct. NOT invoked live
 *        (requires a real Playwright browser not installed in this sandbox; already covered end-to-
 *        end with an injected fetchPage in test/site-crawl-catalog.test.ts CAT1/CAT2, and its
 *        contract shape is covered there too by CAT3 — this case only proves registry reachability).
 *
 * Boundary
 *   N/A — this test proves reachability/shape through a fixed, tiny set of adapter ids; there is no
 *   numeric/length dimension to bound here (the adapters' own suites already cover their field-level
 *   boundaries).
 *
 * Malformed/adversarial
 *   RI4 | getAdapter("router-migration") — genuinely still unimplemented — still throws the expected
 *        "not implemented" error, proving this round's registry change did not accidentally register
 *        something it shouldn't have.
 *
 * Error paths
 *   Covered by RI4 above (the router-migration throw *is* the error-path case for this file).
 *
 * State & timing
 *   N/A — this is a static registration/shape check (which ids resolve to which adapters), not a
 *   process with timing or concurrency to exercise. No timing/concurrency case is included.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function canvasExportConfig(tmp: string): ReplicationConfig {
  const entry = path.join(REPO_ROOT, "test/fixtures/minimal.canvas-export");
  const defs = path.join(REPO_ROOT, "test/fixtures/minimal-screen-definitions.json");
  fs.copyFileSync(defs, path.join(tmp, "defs.json"));
  return {
    schemaVersion: 1,
    adapter: "canvas-export",
    source: { entry, screenDefinitions: "defs.json" },
    target: { stack: "next-app-router", baseUrl: "http://127.0.0.1:3000" },
    outputDir: ".replication",
  };
}

function urlPairsConfig(): ReplicationConfig {
  const entry = path.join(REPO_ROOT, "test/fixtures/url-pairs/valid-entries.json");
  return {
    schemaVersion: 1,
    adapter: "url-pairs",
    source: { entry },
    target: { stack: "other", baseUrl: "http://127.0.0.1:3000" },
    outputDir: ".replication",
  };
}

// --- RI1 (happy) -------------------------------------------------------------

test("RI1: getAdapter('canvas-export').buildCatalog(...) produces a catalog that passes validateCatalog()", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "replicate-registry-integration-"));
  const config = canvasExportConfig(tmp);

  const adapter = getAdapter("canvas-export");
  const { catalog } = await adapter.buildCatalog(tmp, config);

  assert.equal(catalog.adapter, "canvas-export");
  assert.deepEqual(validateCatalog(catalog), []);
});

// --- RI2 (happy) -------------------------------------------------------------

test("RI2: getAdapter('url-pairs').buildCatalog(...) produces a catalog that passes validateCatalog()", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "replicate-registry-integration-"));
  const config = urlPairsConfig();

  const adapter = getAdapter("url-pairs");
  const { catalog } = await adapter.buildCatalog(tmp, config);

  assert.equal(catalog.adapter, "url-pairs");
  assert.equal(catalog.screens.length, 3);
  assert.deepEqual(validateCatalog(catalog), []);
});

// --- RI3 (happy: registry reachability + contract shape only) ----------------

test("RI3: getAdapter('site-crawl') is registered and satisfies the ReplicationAdapter contract shape", () => {
  const adapter = getAdapter("site-crawl");
  assert.equal(adapter.id, "site-crawl");
  assert.equal(typeof adapter.buildCatalog, "function");
  // Not invoked live: buildCatalog(cwd, config) has no dependency-injection slot for a test
  // fetchPage through this entry point, so calling it for real would require a live browser.
  // See test/site-crawl-catalog.test.ts CAT1/CAT2 for the real end-to-end build (with an
  // injected fetchPage) and CAT3 for the same contract-shape assertion at the adapter-export level.
});

// --- RI4 (malformed/adversarial + error path) ---------------------------------

test("RI4: getAdapter('router-migration') still throws — registering the other two adapters did not accidentally register this one", () => {
  assert.throws(
    () => getAdapter("router-migration"),
    (err: unknown) => {
      assert.ok(err instanceof Error, "expected an Error instance, not undefined/silent no-op");
      assert.match(err.message, /router-migration/);
      assert.match(err.message, /not implemented|not registered/i);
      return true;
    },
  );
});
