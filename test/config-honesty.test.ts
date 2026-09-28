import assert from "node:assert/strict";
import { test } from "node:test";
import { validateReplicationConfig } from "../src/core/validate.js";
import { ssimNotEnforcedWarnings } from "../src/commands/compare.js";
import type { CatalogDocument } from "../src/adapters/types.js";

// Contract under test (two honesty/generality gaps from the audit):
//
// 1) schemas/replication.config.schema.json's target.stack was `required` with a CLOSED enum
//    ["next-app-router", "vite", "other"], but config.target.stack is never read by any command
//    logic anywhere. Fixed by making it an optional, freeform string (option (a): no enum, not
//    required) so a Rails/Django/plain-HTML/anything-else target no longer has to lie or fall
//    back to the vague "other".
// 2) thresholds.ssim (per-screen) is accepted by the schema and set by real consumers, but no
//    SSIM/pixel-diff comparison exists anywhere in this codebase. Fixed by making the gap honest:
//    `ssimNotEnforcedWarnings` (called from `runCompare` in src/commands/compare.ts, once per
//    screen actually selected for this compare run) returns a one-line warning per screen that
//    configures thresholds.ssim, so nothing is silently ignored.
//
// Case list:
//   H1 (happy)             | target.stack omitted entirely -> validates fine (no longer required)
//   H2 (happy)              | target.stack: "django" (arbitrary non-Next/Vite string) -> validates fine
//   W1 (weird/boundary)     | a screen with thresholds.ssim set -> one warning naming slug+value;
//                             a screen WITHOUT thresholds.ssim -> no warning for it
//   E1 (edge/malformed)     | target.stack as a non-string type (number) -> still rejected
//
// Additional probe-category coverage (boundary / malformed / error / state-timing), per the
// global Test Quality Standards:
//   B1  (boundary) | target.stack: "" (empty string) -> still valid (purely descriptive, unconstrained)
//   B2  (boundary) | target present but target.baseUrl missing -> still rejected (regression guard:
//                    removing stack's requiredness must not loosen baseUrl's)
//   M1  (malformed) | target.stack as an array / object -> rejected, error names "stack"
//   S1  (state)     | validateReplicationConfig called twice on the same input -> same result both
//                    times (idempotent, no hidden mutation) — stands in for "repeated invocation"
//   B3  (boundary) | thresholds.ssim === 0 (falsy-but-defined) -> still produces a warning (guards
//                    against an `if (ssim)` truthiness bug that would silently drop the 0 case)
//   B4  (boundary) | thresholds present but ssim is undefined (only viewports set) -> no warning
//   B5  (boundary) | empty screens array -> returns an empty warnings array
//   M2  (malformed) | a screen with `thresholds: undefined` explicitly assigned -> no warning, no throw
//   S2  (state)     | ssimNotEnforcedWarnings called twice on the same input array -> same result
//                    both times and the input array is left unmutated
//
// N/A: "Error paths (thrown errors, rejected promises, network failure)" for both units under
// test — validateReplicationConfig and ssimNotEnforcedWarnings are synchronous, pure, in-memory
// functions with no I/O, so there is no network/async failure surface to probe here.

type Screen = CatalogDocument["screens"][number];

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    adapter: "canvas-export",
    source: { entry: "entry.html" },
    target: { baseUrl: "http://127.0.0.1:3000" },
    outputDir: ".replication",
    ...overrides,
  };
}

function screen(overrides: Partial<Screen> = {}): Screen {
  return {
    slug: "home",
    designPath: ".",
    livePath: "/",
    buildable: true,
    status: "in-scope",
    ...overrides,
  } as Screen;
}

// --- H1 ----------------------------------------------------------------------

test("H1: target.stack omitted entirely validates fine (no longer required)", () => {
  const config = baseConfig({ target: { baseUrl: "http://127.0.0.1:3000" } });
  const errors = validateReplicationConfig(config);
  assert.deepEqual(errors, []);
});

// --- H2 ------------------------------------------------------------------------

test("H2: target.stack as an arbitrary non-Next/Vite string (e.g. django) validates fine", () => {
  const config = baseConfig({
    target: { stack: "django", baseUrl: "http://127.0.0.1:3000" },
  });
  const errors = validateReplicationConfig(config);
  assert.deepEqual(errors, []);
});

// --- W1 --------------------------------------------------------------------

test("W1: a screen with thresholds.ssim set gets a not-yet-enforced warning naming its slug and value; a screen without thresholds.ssim gets none", () => {
  const withSsim = screen({ slug: "pricing", thresholds: { ssim: 0.98 } });
  const withoutSsim = screen({ slug: "home" });

  const warnings = ssimNotEnforcedWarnings([withSsim, withoutSsim]);

  assert.equal(warnings.length, 1, `expected exactly one warning, got: ${warnings.join(" | ")}`);
  assert.match(warnings[0], /pricing/);
  assert.match(warnings[0], /0\.98/);
  assert.match(warnings[0], /not.*enforc/i);
  assert.ok(
    !warnings.some((w) => /\bhome\b/.test(w)),
    "the screen without thresholds.ssim must not produce a warning",
  );
});

// --- E1 ------------------------------------------------------------------------

test("E1: target.stack as a non-string type (number) is still rejected by the schema", () => {
  const config = baseConfig({
    target: { stack: 42, baseUrl: "http://127.0.0.1:3000" },
  });
  const errors = validateReplicationConfig(config);
  assert.ok(errors.length > 0, "expected validation errors for a numeric target.stack");
  assert.ok(
    errors.some((e) => /stack/.test(e)),
    `expected an error mentioning "stack", got: ${errors.join(" | ")}`,
  );
});

// --- B1 --------------------------------------------------------------------

test("B1: target.stack as an empty string is still valid (unconstrained, purely descriptive)", () => {
  const config = baseConfig({ target: { stack: "", baseUrl: "http://127.0.0.1:3000" } });
  const errors = validateReplicationConfig(config);
  assert.deepEqual(errors, []);
});

// --- B2 --------------------------------------------------------------------

test("B2: target.baseUrl is still required even though target.stack no longer is", () => {
  const config = baseConfig({ target: { stack: "django" } });
  const errors = validateReplicationConfig(config);
  assert.ok(errors.length > 0, "expected validation errors for a missing target.baseUrl");
  assert.ok(
    errors.some((e) => /baseUrl/.test(e)),
    `expected an error mentioning "baseUrl", got: ${errors.join(" | ")}`,
  );
});

// --- M1 ------------------------------------------------------------------------

test("M1: target.stack as an array or object is rejected, error names stack", () => {
  const arrayConfig = baseConfig({
    target: { stack: ["next-app-router"], baseUrl: "http://127.0.0.1:3000" },
  });
  const arrayErrors = validateReplicationConfig(arrayConfig);
  assert.ok(arrayErrors.length > 0, "expected errors for an array target.stack");
  assert.ok(arrayErrors.some((e) => /stack/.test(e)));

  const objectConfig = baseConfig({
    target: { stack: { name: "django" }, baseUrl: "http://127.0.0.1:3000" },
  });
  const objectErrors = validateReplicationConfig(objectConfig);
  assert.ok(objectErrors.length > 0, "expected errors for an object target.stack");
  assert.ok(objectErrors.some((e) => /stack/.test(e)));
});

// --- S1 --------------------------------------------------------------------

test("S1: validateReplicationConfig is idempotent across repeated calls on the same input", () => {
  const config = baseConfig({ target: { baseUrl: "http://127.0.0.1:3000" } });
  const first = validateReplicationConfig(config);
  const second = validateReplicationConfig(config);
  assert.deepEqual(first, []);
  assert.deepEqual(second, []);

  const badConfig = baseConfig({ target: { stack: 42, baseUrl: "http://127.0.0.1:3000" } });
  const firstBad = validateReplicationConfig(badConfig);
  const secondBad = validateReplicationConfig(badConfig);
  assert.deepEqual(firstBad, secondBad);
});

// --- B3 --------------------------------------------------------------------

test("B3: thresholds.ssim === 0 (falsy-but-defined) still produces a warning", () => {
  const warnings = ssimNotEnforcedWarnings([screen({ slug: "zero-ssim", thresholds: { ssim: 0 } })]);
  assert.equal(warnings.length, 1, `expected one warning for ssim: 0, got: ${warnings.join(" | ")}`);
  assert.match(warnings[0], /zero-ssim/);
});

// --- B4 --------------------------------------------------------------------

test("B4: thresholds present but ssim undefined (only viewports set) produces no warning", () => {
  const warnings = ssimNotEnforcedWarnings([
    screen({ slug: "viewports-only", thresholds: { viewports: ["desktop", "mobile"] } }),
  ]);
  assert.deepEqual(warnings, []);
});

// --- B5 --------------------------------------------------------------------

test("B5: an empty screens array returns an empty warnings array", () => {
  assert.deepEqual(ssimNotEnforcedWarnings([]), []);
});

// --- M2 ------------------------------------------------------------------------

test("M2: a screen with thresholds explicitly set to undefined produces no warning and does not throw", () => {
  const s = screen({ slug: "explicit-undefined", thresholds: undefined });
  assert.doesNotThrow(() => ssimNotEnforcedWarnings([s]));
  assert.deepEqual(ssimNotEnforcedWarnings([s]), []);
});

// --- S2 --------------------------------------------------------------------

test("S2: ssimNotEnforcedWarnings is pure — repeated calls return equal results and never mutate the input array", () => {
  const screens = [
    screen({ slug: "a", thresholds: { ssim: 0.9 } }),
    screen({ slug: "b" }),
  ];
  const snapshotBefore = JSON.stringify(screens);

  const first = ssimNotEnforcedWarnings(screens);
  const second = ssimNotEnforcedWarnings(screens);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(screens), snapshotBefore, "input screens array must not be mutated");
});
