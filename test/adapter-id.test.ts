import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAdapterId } from "../src/core/adapter-id.js";

test("normalizeAdapterId maps legacy adapter names", () => {
  assert.equal(normalizeAdapterId("dc-html"), "canvas-export");
  assert.equal(normalizeAdapterId("static-site"), "site-crawl");
  assert.equal(normalizeAdapterId("framework-migration"), "router-migration");
  assert.equal(normalizeAdapterId("canvas-export"), "canvas-export");
  assert.equal(normalizeAdapterId("unknown"), null);
});
