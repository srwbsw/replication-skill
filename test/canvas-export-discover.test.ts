import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { discoverCanvasExport } from "../src/adapters/canvas-export/discover.js";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "minimal.canvas-export",
);

test("discoverCanvasExport extracts enum, conditional regions, and navigation handlers", () => {
  const d = discoverCanvasExport(FIXTURE);
  assert.deepEqual(d.defaultScreenEnum, ["demo", "home", "login"]);
  assert.ok(d.scIfConditionNames.includes("isHome"));
  assert.ok(d.scIfConditionNames.includes("isLogin"));
  assert.equal(d.navigationHandlers.goLogin, "login");
  assert.equal(d.navigationHandlers.goDemo, "demo");
  assert.equal(d.navigationHandlers.goTrial, "trial");
  assert.match(d.entrySha256, /^[a-f0-9]{64}$/);
});
