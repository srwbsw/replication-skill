import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCatalog } from "../src/commands/catalog.js";
import { writeConfig } from "../src/io/config.js";
import { replicationDir, catalogPath, catalogHashPath } from "../src/paths.js";
import type { ReplicationAdapter } from "../src/adapters/adapter.js";
import type { CatalogDocument, ReplicationConfig } from "../src/adapters/types.js";

/**
 * Bug under test: runCatalog (src/commands/catalog.ts) used to reject any adapter whose
 * buildCatalog returns a Promise, throwing:
 *   `catalog: adapter "${config.adapter}" builds asynchronously, which this command does not
 *   support yet.`
 * even though the ReplicationAdapter contract (src/adapters/adapter.ts) explicitly allows an
 * async buildCatalog. This left every genuinely-async adapter (e.g. site-crawl, which drives a
 * real Playwright crawl) unusable through `replicate catalog --freeze`/`--check`.
 *
 * These tests exercise the real, CLI-facing `runCatalog` function (never the adapter's
 * buildCatalog directly). Since the adapter registry (src/adapters/registry.ts) is a fixed,
 * hard-coded map that this fix is explicitly forbidden from editing, and the only genuinely-async
 * registered adapter (site-crawl) requires a live browser/network with no dependency-injection
 * slot through the ReplicationAdapter interface (see test/site-crawl-catalog.test.ts's CAT3
 * comment), runCatalog gained a second, test-only `adapterOverride` parameter that bypasses the
 * registry lookup. Real callers (src/cli.ts) never pass it, so production behavior is unaffected.
 *
 * Case list:
 * H1   | happy/regression | a real, synchronous adapter (canvas-export, via the real registry —
 *        no override) — runCatalog must still return a plain `number` (never a Promise), and
 *        freeze + check both still succeed exactly as before the fix.
 * H2   | happy/the fix     | a fake adapter whose buildCatalog is genuinely async (via
 *        adapterOverride) — runCatalog must return a Promise<number>, freeze must succeed, and
 *        the written catalog.json/catalog.hash must be byte-identical to what an equivalent SYNC
 *        fake adapter produces for the same catalog data.
 * REGR | regression (the exact live bug report) | a fake adapter mimicking site-crawl's shape
 *        (id: "site-crawl", async buildCatalog) driven through the real runCatalog — must now
 *        succeed where it previously threw "builds asynchronously, which this command does not
 *        support yet."
 * W1   | state & timing (repeated invocation) | freeze then check, twice in a row, against the
 *        same async adapter/input — stable, correct results every time (mirrors the existing
 *        sync-adapter determinism tests in test/catalog-determinism.test.ts).
 * W2   | state & timing (concurrent) | two concurrent runCatalog calls, different cwds and
 *        different async adapters resolving at different times, run via Promise.all — no
 *        cross-invocation interference (each writes only its own catalog data).
 * E1   | error path (rejected promise) | an async adapter's buildCatalog Promise REJECTS —
 *        runCatalog's returned Promise rejects with the adapter's own error verbatim (not
 *        swallowed, not hung, not replaced with a generic message), and no catalog.json is
 *        written.
 * E2   | malformed/adversarial (invalid resolved data) | an async adapter resolves to a catalog
 *        document that fails schema validation (missing a required field) — same exit-1/
 *        schema_invalid handling as the pre-existing sync path, and no catalog.json is written.
 *
 * N/A: content-level boundary/malformed cases (empty/unicode/injection-shaped slugs, empty
 * screens arrays, etc.) are already exhaustively covered by test/catalog-schema-generic.test.ts
 * directly against validateCatalog. This fix is purely about Promise-vs-sync control flow in
 * runCatalog's adapter-invocation step, so this suite's boundary/malformed coverage targets that
 * control-flow dimension only (E1 = rejected promise, E2 = malformed data flowing through the
 * newly-added async branch).
 * N/A: "unmount/cancel mid-flight" — runCatalog is a one-shot CLI command with no cancellation
 * API; there is nothing to unmount or cancel.
 */

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "replicate-async-test-"));
}

function siteCrawlLikeConfig(entry = "http://fixture.test"): ReplicationConfig {
  return {
    schemaVersion: 1,
    adapter: "site-crawl",
    source: { entry },
    target: { stack: "other", baseUrl: "http://localhost:4000" },
    outputDir: ".replication",
  };
}

function makeCatalog(entry: string): CatalogDocument {
  return {
    schemaVersion: 2,
    closedWorld: true,
    adapter: "site-crawl",
    source: { entry, sha256: "a".repeat(64) },
    screens: [{ slug: "home", designPath: "/", livePath: "/", buildable: true, status: "in-scope" }],
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- H1 --------------------------------------------------------------------

test("H1 | runCatalog with a real synchronous adapter (canvas-export, no override) still returns a plain number and freeze+check both still succeed", () => {
  const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const tmp = tmpWorkspace();
  const entry = path.join(REPO_ROOT, "test/fixtures/minimal.canvas-export");
  const defs = path.join(REPO_ROOT, "test/fixtures/minimal-screen-definitions.json");
  fs.copyFileSync(defs, path.join(tmp, "defs.json"));
  const config: ReplicationConfig = {
    schemaVersion: 1,
    adapter: "canvas-export",
    source: { entry, screenDefinitions: "defs.json" },
    target: { stack: "next-app-router", baseUrl: "http://127.0.0.1:3000" },
    outputDir: ".replication",
  };
  writeConfig(tmp, config);

  const freezeResult = runCatalog({ cwd: tmp, freeze: true });
  assert.equal(typeof freezeResult, "number", "sync adapters must not get wrapped in a Promise");
  assert.equal(freezeResult, 0);

  const checkResult = runCatalog({ cwd: tmp, check: true });
  assert.equal(typeof checkResult, "number", "sync adapters must not get wrapped in a Promise");
  assert.equal(checkResult, 0);
});

// --- H2 ------------------------------------------------------------------------

test("H2 | runCatalog with an async fake adapter returns a Promise<number>, freezes successfully, and writes catalog.json/catalog.hash byte-identical to an equivalent sync fake adapter", async () => {
  const tmpSync = tmpWorkspace();
  const tmpAsync = tmpWorkspace();
  const entry = "http://fixture.test/h2";
  writeConfig(tmpSync, siteCrawlLikeConfig(entry));
  writeConfig(tmpAsync, siteCrawlLikeConfig(entry));

  const syncAdapter: ReplicationAdapter = {
    id: "site-crawl",
    buildCatalog: () => ({ catalog: makeCatalog(entry), warnings: [] }),
  };
  const asyncAdapter: ReplicationAdapter = {
    id: "site-crawl",
    buildCatalog: async () => {
      await delay(1);
      return { catalog: makeCatalog(entry), warnings: [] };
    },
  };

  const syncResult = runCatalog({ cwd: tmpSync, freeze: true }, syncAdapter);
  assert.equal(typeof syncResult, "number");
  assert.equal(syncResult, 0);

  const asyncResultOrPromise = runCatalog({ cwd: tmpAsync, freeze: true }, asyncAdapter);
  assert.ok(
    asyncResultOrPromise instanceof Promise,
    "an adapter whose buildCatalog returns a Promise must make runCatalog return a Promise",
  );
  const asyncResult = await asyncResultOrPromise;
  assert.equal(asyncResult, 0);

  const repDirSync = replicationDir(tmpSync, ".replication");
  const repDirAsync = replicationDir(tmpAsync, ".replication");

  const syncCatalogJson = fs.readFileSync(catalogPath(repDirSync), "utf8");
  const asyncCatalogJson = fs.readFileSync(catalogPath(repDirAsync), "utf8");
  assert.equal(
    asyncCatalogJson,
    syncCatalogJson,
    "async-adapter catalog.json must match what an equivalent sync adapter would write",
  );

  const syncHash = fs.readFileSync(catalogHashPath(repDirSync), "utf8");
  const asyncHash = fs.readFileSync(catalogHashPath(repDirAsync), "utf8");
  assert.equal(asyncHash, syncHash, "async-adapter catalog.hash must match the sync adapter's hash");
});

// --- REGR (the exact original live bug report) ----------------------------------

test("REGR | a fake adapter mimicking site-crawl's shape (async buildCatalog) now succeeds via the real runCatalog, where it previously threw the 'builds asynchronously' error", async () => {
  const tmp = tmpWorkspace();
  const config = siteCrawlLikeConfig("https://example.com");
  writeConfig(tmp, config);

  const fakeSiteCrawlAdapter: ReplicationAdapter = {
    id: "site-crawl",
    buildCatalog: async (_cwd, cfg) => {
      // Genuinely asynchronous (not just Promise.resolve), like a real crawl would be.
      await delay(1);
      return { catalog: makeCatalog(cfg.source.entry), warnings: [] };
    },
  };

  const result = await runCatalog({ cwd: tmp, freeze: true }, fakeSiteCrawlAdapter);
  assert.equal(result, 0);

  const repDir = replicationDir(tmp, config.outputDir);
  assert.ok(fs.existsSync(catalogPath(repDir)), "expected catalog.json to be written");
  assert.ok(fs.existsSync(catalogHashPath(repDir)), "expected catalog.hash to be written");
});

// --- W1 (state & timing: repeated invocation) ------------------------------------

test("W1 | freeze then check, twice in a row, against the same async adapter is stable and correct every time", async () => {
  const tmp = tmpWorkspace();
  const entry = "http://fixture.test/w1";
  writeConfig(tmp, siteCrawlLikeConfig(entry));

  const asyncAdapter: ReplicationAdapter = {
    id: "site-crawl",
    buildCatalog: async () => {
      await delay(1);
      return { catalog: makeCatalog(entry), warnings: [] };
    },
  };

  const freezeResult = await runCatalog({ cwd: tmp, freeze: true }, asyncAdapter);
  assert.equal(freezeResult, 0);

  const checkResult1 = await runCatalog({ cwd: tmp, check: true }, asyncAdapter);
  assert.equal(checkResult1, 0, "first check right after freeze must report no drift");

  const checkResult2 = await runCatalog({ cwd: tmp, check: true }, asyncAdapter);
  assert.equal(checkResult2, 0, "second check must be equally stable — no leftover timing bug");
});

// --- W2 (state & timing: concurrent invocations) ---------------------------------

test("W2 | two concurrent runCatalog calls against different async adapters/cwds do not interfere with each other", async () => {
  const tmpA = tmpWorkspace();
  const tmpB = tmpWorkspace();
  const entryA = "http://fixture.test/a";
  const entryB = "http://fixture.test/b";
  writeConfig(tmpA, siteCrawlLikeConfig(entryA));
  writeConfig(tmpB, siteCrawlLikeConfig(entryB));

  // Adapter A resolves slower than adapter B, so B settles first — proves no shared mutable state
  // between concurrent runCatalog invocations.
  const adapterA: ReplicationAdapter = {
    id: "site-crawl",
    buildCatalog: async () => {
      await delay(20);
      return { catalog: makeCatalog(entryA), warnings: [] };
    },
  };
  const adapterB: ReplicationAdapter = {
    id: "site-crawl",
    buildCatalog: async () => {
      await delay(5);
      return { catalog: makeCatalog(entryB), warnings: [] };
    },
  };

  const [resultA, resultB] = await Promise.all([
    runCatalog({ cwd: tmpA, freeze: true }, adapterA),
    runCatalog({ cwd: tmpB, freeze: true }, adapterB),
  ]);
  assert.equal(resultA, 0);
  assert.equal(resultB, 0);

  const repDirA = replicationDir(tmpA, ".replication");
  const repDirB = replicationDir(tmpB, ".replication");
  const catalogA = JSON.parse(fs.readFileSync(catalogPath(repDirA), "utf8")) as CatalogDocument;
  const catalogB = JSON.parse(fs.readFileSync(catalogPath(repDirB), "utf8")) as CatalogDocument;
  assert.equal(catalogA.source.entry, entryA, "cwd A's catalog must hold cwd A's data, not B's");
  assert.equal(catalogB.source.entry, entryB, "cwd B's catalog must hold cwd B's data, not A's");
});

// --- E1 (error path: rejected promise) --------------------------------------------

test("E1 | an async adapter whose buildCatalog Promise rejects surfaces the adapter's own error via runCatalog's rejected Promise, and writes no catalog.json", async () => {
  const tmp = tmpWorkspace();
  writeConfig(tmp, siteCrawlLikeConfig("http://fixture.test/e1"));

  const rejectingAdapter: ReplicationAdapter = {
    id: "site-crawl",
    buildCatalog: async () => {
      await delay(1);
      throw new Error("boom: crawl failed");
    },
  };

  await assert.rejects(
    async () => {
      await runCatalog({ cwd: tmp, freeze: true }, rejectingAdapter);
    },
    /boom: crawl failed/,
    "expected the adapter's own rejection reason, not a generic/replaced error",
  );

  const repDir = replicationDir(tmp, ".replication");
  assert.equal(fs.existsSync(catalogPath(repDir)), false, "no catalog.json should be written on rejection");
});

// --- E2 (malformed/adversarial: invalid resolved catalog) -------------------------

test("E2 | an async adapter resolving to a schema-invalid catalog is rejected the same way the sync path rejects it (exit 1, no file written)", async () => {
  const tmp = tmpWorkspace();
  writeConfig(tmp, siteCrawlLikeConfig("http://fixture.test/e2"));

  const invalidCatalog = {
    ...makeCatalog("http://fixture.test/e2"),
    screens: [
      // Missing the required "status" field.
      { slug: "home", designPath: "/", livePath: "/", buildable: true },
    ],
  } as unknown as CatalogDocument;

  const badAdapter: ReplicationAdapter = {
    id: "site-crawl",
    buildCatalog: async () => {
      await delay(1);
      return { catalog: invalidCatalog, warnings: [] };
    },
  };

  const originalError = console.error;
  const captured: string[] = [];
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  let result: number;
  try {
    result = await runCatalog({ cwd: tmp, freeze: true }, badAdapter);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 1, `expected exit 1 for a schema-invalid catalog, got ${result}. Output:\n${captured.join("\n")}`);
  assert.ok(
    captured.some((line) => /status/.test(line)),
    `expected validation errors to mention the missing "status" field, got:\n${captured.join("\n")}`,
  );

  const repDir = replicationDir(tmp, ".replication");
  assert.equal(fs.existsSync(catalogPath(repDir)), false, "no catalog.json should be written on schema validation failure");
});
