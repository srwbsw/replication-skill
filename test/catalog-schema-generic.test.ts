import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildCanvasExportCatalog } from "../src/adapters/canvas-export/build-catalog.js";
import { validateCatalog } from "../src/core/validate.js";
import { designUrlForScreen } from "../src/parity/urls.js";
import { rootSelectorForScreen } from "../src/parity/dom-extract.js";
import type { ReplicationConfig } from "../src/adapters/types.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Contract under test (not yet implemented — see AGENTS handoff):
//   schemas/catalog.schema.json $defs/screen becomes generic: required
//   ["slug","designPath","livePath","buildable","status"], optional
//   label/rootSelector/thresholds/neutralizers/adapterMeta, additionalProperties:false.
//   Removed entirely: sourceScreen, sourceState, referenceSubdir, rootLocator.
//   canvas-export relocates its private data under adapterMeta at build time and
//   resolves rootLocator.kind into a flat rootSelector string once, at build time.

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "replicate-test-"));
}

function minimalFixtureConfig(tmp: string): ReplicationConfig {
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

/** A minimally-valid NEW-shape screen: only the generic required fields. */
function validNewScreen(
  omit: string[] = [],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    slug: "home",
    designPath: ".",
    livePath: "/",
    buildable: true,
    status: "in-scope",
  };
  for (const key of omit) delete base[key];
  return { ...base, ...overrides };
}

function newShapeCatalog(screens: unknown[]): Record<string, unknown> {
  return {
    schemaVersion: 2,
    closedWorld: true,
    adapter: "canvas-export",
    source: { entry: "entry.html", sha256: "a".repeat(64) },
    screens,
  };
}

/** No error mentions a legacy canvas-export-only field the generic schema must no longer require. */
function hasNoLegacyFieldNoise(errors: string[]): boolean {
  return !errors.some((e) => /sourceScreen|sourceState|referenceSubdir|rootLocator/.test(e));
}

// --- H1 --------------------------------------------------------------------

test("buildCanvasExportCatalog produces the new generic per-screen shape with canvas-export data under adapterMeta", () => {
  const tmp = tmpWorkspace();
  const config = minimalFixtureConfig(tmp);

  const { catalog } = buildCanvasExportCatalog(tmp, config);

  assert.equal(
    validateCatalog(catalog).length,
    0,
    "catalog must validate against the new generic schema",
  );
  assert.equal(catalog.screens.length, 1);

  const screen = catalog.screens[0] as unknown as Record<string, unknown>;

  for (const key of ["slug", "designPath", "livePath", "buildable", "status"]) {
    assert.notEqual(screen[key], undefined, `expected screen.${key} to be set`);
  }

  for (const legacyKey of ["sourceScreen", "sourceState", "referenceSubdir", "rootLocator"]) {
    assert.equal(
      legacyKey in screen,
      false,
      `screen must not carry legacy top-level field "${legacyKey}"`,
    );
  }

  const adapterMeta = screen.adapterMeta as Record<string, unknown> | undefined;
  assert.ok(adapterMeta, "expected screen.adapterMeta to hold canvas-export's private data");
  assert.equal(adapterMeta?.sourceScreen, "home");
  assert.deepEqual(adapterMeta?.sourceState, { isHome: true });
});

// --- H3 ----------------------------------------------------------------------

test("designUrlForScreen resolves the new designPath field the same way the old referenceSubdir resolved", () => {
  const root = { slug: "home", designPath: ".", livePath: "/" };
  assert.equal(
    designUrlForScreen("http://127.0.0.1:4320", root as never),
    "http://127.0.0.1:4320/",
  );

  const nested = { slug: "auth-login", designPath: "screens/auth-login", livePath: "/login" };
  assert.equal(
    designUrlForScreen("http://127.0.0.1:4320/", nested as never),
    "http://127.0.0.1:4320/screens/auth-login/",
  );
});

// --- H4 (pure-unit half) + W3 ------------------------------------------------

test("rootSelectorForScreen resolves the new flat rootSelector field directly, no kind switch involved", () => {
  assert.equal(
    rootSelectorForScreen({ rootSelector: "[data-design-parity-auth-root]" } as never),
    "[data-design-parity-auth-root]",
  );
});

test("rootSelectorForScreen defaults to body when rootSelector is omitted", () => {
  assert.equal(rootSelectorForScreen({} as never), "body");
});

// --- H4 (build-time half) + E5 ------------------------------------------------

test("buildCanvasExportCatalog resolves rootLocator.kind into a flat rootSelector at build time, preserving the least-common custom-selector case", () => {
  const tmp = tmpWorkspace();
  const entry = path.join(REPO_ROOT, "test/fixtures/minimal.canvas-export");
  const defsPath = path.join(tmp, "defs.json");
  fs.writeFileSync(
    defsPath,
    JSON.stringify({
      schemaVersion: 1,
      screens: [
        {
          slug: "login",
          label: "Login",
          sourceScreen: "login",
          sourceState: { isLogin: true },
          livePath: "/login",
          referenceSubdir: "screens/login",
          rootLocator: { kind: "auth-root" },
          textMustacheFallbacks: { title: "Sign in" },
          buildable: true,
          status: "in-scope",
        },
        {
          slug: "demo",
          label: "Demo",
          sourceScreen: "demo",
          sourceState: {},
          livePath: "/demo",
          referenceSubdir: "screens/demo",
          rootLocator: { kind: "selector", selector: "#demo-shell > .variant-b" },
          buildable: true,
          status: "in-scope",
        },
      ],
    }),
    "utf8",
  );

  const config: ReplicationConfig = {
    schemaVersion: 1,
    adapter: "canvas-export",
    source: { entry, screenDefinitions: "defs.json" },
    target: { stack: "next-app-router", baseUrl: "http://127.0.0.1:3000" },
    outputDir: ".replication",
  };

  const { catalog } = buildCanvasExportCatalog(tmp, config);
  const screens = catalog.screens as unknown as Record<string, unknown>[];
  const login = screens.find((s) => s.slug === "login");
  const demo = screens.find((s) => s.slug === "demo");
  assert.ok(login, "expected a login screen in the built catalog");
  assert.ok(demo, "expected a demo screen in the built catalog");

  assert.equal(login?.rootSelector, "[data-design-parity-auth-root]");
  assert.equal(demo?.rootSelector, "#demo-shell > .variant-b");

  const loginMeta = login?.adapterMeta as Record<string, unknown> | undefined;
  assert.ok(loginMeta, "expected login.adapterMeta to hold relocated canvas-export data");
  assert.deepEqual(loginMeta?.textMustacheFallbacks, { title: "Sign in" });
});

// --- W2 ------------------------------------------------------------------------

test("a screen with no adapterMeta field at all still validates against the new schema", () => {
  const catalog = newShapeCatalog([validNewScreen()]);
  const errors = validateCatalog(catalog);
  assert.equal(errors.length, 0, `expected no errors, got: ${errors.join(" | ")}`);
});

test("designUrlForScreen works from designPath alone when adapterMeta/other fields are absent", () => {
  const screen = validNewScreen();
  assert.equal(
    designUrlForScreen("http://127.0.0.1:4320", screen as never),
    "http://127.0.0.1:4320/",
  );
});

// --- E1 --------------------------------------------------------------------

test("a screen with adapterMeta: {} (present but empty) validates the same as no metadata", () => {
  const catalog = newShapeCatalog([validNewScreen([], { adapterMeta: {} })]);
  const errors = validateCatalog(catalog);
  assert.equal(errors.length, 0, `expected no errors, got: ${errors.join(" | ")}`);
});

// --- E2 ----------------------------------------------------------------------

test("a screen with an empty slug is rejected by the slug pattern constraint", () => {
  const catalog = newShapeCatalog([validNewScreen([], { slug: "" })]);
  const errors = validateCatalog(catalog);
  assert.ok(
    errors.some((e) => /slug/.test(e)),
    `expected an error mentioning slug, got: ${errors.join(" | ")}`,
  );
  assert.ok(
    hasNoLegacyFieldNoise(errors),
    `schema must not require legacy canvas-export-only fields, got: ${errors.join(" | ")}`,
  );
});

// --- E3 ------------------------------------------------------------------------

test("a screen missing the required livePath field fails validateCatalog with an error naming livePath", () => {
  const catalog = newShapeCatalog([validNewScreen(["livePath"])]);
  const errors = validateCatalog(catalog);
  assert.ok(
    errors.some((e) => /livePath/.test(e)),
    `expected an error naming livePath, got: ${errors.join(" | ")}`,
  );
  assert.ok(
    hasNoLegacyFieldNoise(errors),
    `schema must not require legacy canvas-export-only fields, got: ${errors.join(" | ")}`,
  );
});

// --- malformed/adversarial: injection-shaped strings --------------------------

test("a screen with an injection-shaped slug is rejected via the pattern constraint", () => {
  const catalog = newShapeCatalog([
    validNewScreen([], { slug: "<script>alert(1)</script>" }),
  ]);
  const errors = validateCatalog(catalog);
  assert.ok(
    errors.some((e) => /slug/.test(e) && /pattern/i.test(e)),
    `expected a slug pattern error, got: ${errors.join(" | ")}`,
  );
  assert.ok(
    hasNoLegacyFieldNoise(errors),
    `schema must not require legacy canvas-export-only fields, got: ${errors.join(" | ")}`,
  );
});

test("a screen with an injection-shaped designPath is accepted as an opaque string", () => {
  const catalog = newShapeCatalog([
    validNewScreen([], { designPath: "../../../etc/passwd<script>alert(1)</script>" }),
  ]);
  const errors = validateCatalog(catalog);
  assert.equal(errors.length, 0, `expected no errors, got: ${errors.join(" | ")}`);
});

// --- W4 ------------------------------------------------------------------------

test("catalog --check on an old-shape (schemaVersion 1) catalog.json fails with a clear, actionable message instead of a silent pass or a generic drift dump", async () => {
  const { runCatalog } = await import("../src/commands/catalog.js");
  const { writeConfig } = await import("../src/io/config.js");
  const { replicationDir, catalogPath } = await import("../src/paths.js");

  const tmp = tmpWorkspace();
  const config = minimalFixtureConfig(tmp);
  writeConfig(tmp, config);

  const repDir = replicationDir(tmp, config.outputDir);
  fs.mkdirSync(repDir, { recursive: true });

  const oldShapeCatalog = {
    schemaVersion: 1,
    closedWorld: true,
    adapter: "canvas-export",
    source: { entry: config.source.entry, sha256: "0".repeat(64) },
    screens: [
      {
        slug: "home",
        label: "Home",
        sourceScreen: "home",
        sourceState: { isHome: true },
        livePath: "/",
        referenceSubdir: ".",
        rootLocator: { kind: "body" },
        buildable: true,
        status: "in-scope",
      },
    ],
  };
  fs.writeFileSync(catalogPath(repDir), JSON.stringify(oldShapeCatalog, null, 2), "utf8");

  const captured: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  let exitCode: number;
  try {
    exitCode = runCatalog({ cwd: tmp, check: true });
  } finally {
    console.error = originalError;
  }

  const combined = captured.join("\n");
  assert.notEqual(exitCode, 0, `expected a non-zero exit code, got 0. Output:\n${combined}`);
  assert.match(
    combined,
    /\bv1\b|outdated|old(?:er)? (?:catalog )?shape/i,
    `expected the error to name the catalog as being in the old (v1) shape, got:\n${combined}`,
  );
  assert.match(
    combined,
    /re-?run|freeze/i,
    `expected the error to point at re-running catalog --freeze, got:\n${combined}`,
  );
});
