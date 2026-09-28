import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getAdapter } from "../src/adapters/registry.js";
// Type-only: pins the exact symbol/path the next implementer must create.
// tsx elides type-only imports, so this does not add its own module-not-found signal.
import type { ReplicationAdapter } from "../src/adapters/adapter.js";
import type { ReplicationConfig } from "../src/adapters/types.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixtureConfig(tmp: string): ReplicationConfig {
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

// --- H2 --------------------------------------------------------------------

test("getAdapter('canvas-export') returns an object implementing the ReplicationAdapter contract", () => {
  const adapter: ReplicationAdapter = getAdapter("canvas-export");
  assert.equal(adapter.id, "canvas-export");
  assert.equal(typeof adapter.buildCatalog, "function");
});

// --- W1 (state & timing: repeated/double invocation) ------------------------

test("getAdapter is safe to call repeatedly — no hidden shared mutable state across calls", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "replicate-test-"));
  const config = fixtureConfig(tmp);

  const first = getAdapter("canvas-export");
  const second = getAdapter("canvas-export");

  const resultA = await first.buildCatalog(tmp, config);
  const resultB = await second.buildCatalog(tmp, config);

  assert.deepEqual(resultA.catalog, resultB.catalog);
  assert.deepEqual(resultA.warnings, resultB.warnings);
});

// --- E4 (error paths: thrown error on bad input) -----------------------------

test("getAdapter throws a clear error for a completely unknown adapter id", () => {
  assert.throws(
    () => getAdapter("some-unregistered-id" as never),
    (err: unknown) => {
      assert.ok(err instanceof Error, "expected an Error instance, not undefined/silent no-op");
      assert.match(err.message, /some-unregistered-id/);
      assert.match(err.message, /not implemented|not registered|unknown adapter/i);
      return true;
    },
  );
});

test("getAdapter('url-pairs') returns an object implementing the ReplicationAdapter contract", () => {
  const adapter: ReplicationAdapter = getAdapter("url-pairs");
  assert.equal(adapter.id, "url-pairs");
  assert.equal(typeof adapter.buildCatalog, "function");
});
