import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildCanvasExportCatalog } from "../src/adapters/canvas-export/build-catalog.js";
import { hashCatalogDocument } from "../src/core/hash.js";
import { validateCatalog } from "../src/core/validate.js";
import type { ReplicationConfig } from "../src/adapters/types.js";
import { normalizeReplicationConfig } from "../src/io/normalize-config.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("catalog hash is stable across two builds (fixture)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "replicate-test-"));
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

  const a = buildCanvasExportCatalog(tmp, config).catalog;
  const b = buildCanvasExportCatalog(tmp, config).catalog;
  assert.equal(hashCatalogDocument(a), hashCatalogDocument(b));
  assert.equal(validateCatalog(a).length, 0);
  const homeScreen = a.screens[0] as unknown as Record<string, unknown>;
  assert.equal(homeScreen.designPath, ".", "old referenceSubdir value must carry over as designPath");
  assert.equal("referenceSubdir" in homeScreen, false, "legacy referenceSubdir must not survive the build");
});

test("canvas-export-minimal example catalog builds from in-repo fixture", () => {
  const exampleCwd = path.join(REPO_ROOT, "examples/canvas-export-minimal");
  const configPath = path.join(exampleCwd, ".replication", "replication.config.json");
  assert.ok(fs.existsSync(configPath));
  const config = normalizeReplicationConfig(
    JSON.parse(fs.readFileSync(configPath, "utf8")) as ReplicationConfig,
  );
  const entry = path.resolve(exampleCwd, config.source.entry);
  assert.ok(fs.existsSync(entry), `fixture missing: ${entry}`);
  const { catalog } = buildCanvasExportCatalog(exampleCwd, config);
  assert.equal(catalog.screens.length, 1);
  assert.equal(validateCatalog(catalog).length, 0);
  assert.equal(catalog.adapter, "canvas-export");
  const homeScreen = catalog.screens[0] as unknown as Record<string, unknown>;
  assert.equal(homeScreen.designPath, ".", "old referenceSubdir value must carry over as designPath");
});
