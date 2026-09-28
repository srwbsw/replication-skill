/**
 * url-pairs adapter — buildUrlPairsCatalog(cwd, config)
 *
 * Case list (id | input + state -> expected):
 *
 * Happy
 *   H1 | valid 3-entry input file, all fields explicit on entries 1-2, entry 3 omits
 *        status/buildable -> CatalogDocument.screens has 3 screens, SAME ORDER as input,
 *        every field mapped 1:1, catalog validates against schemas/catalog.schema.json.
 *   H2 | entry omitting status/buildable -> defaults "in-scope" / true applied.
 *
 * Weird
 *   W1 | input file is a valid empty array [] -> rejected (catalog.schema.json screens
 *        has minItems:1; the url-pairs input schema mirrors that with its own minItems:1).
 *   W2 | two entries share the identical slug -> rejected with a clear error naming the
 *        duplicate slug (a closed-world catalog can't have two screens at one slug).
 *   W3 | buildUrlPairsCatalog called twice against the same unchanged input file ->
 *        byte-identical CatalogDocument both times (hash + deepEqual), catalog valid.
 *
 * Edge
 *   E1 | entry missing "slug" at array index 1 -> throws, error names "slug" and index 1;
 *        build is atomic (no partial catalog returned when one of several entries is bad).
 *   E2 | entry missing "designPath" at array index 1 -> throws, error names "designPath"
 *        and index 1.
 *   E3 | entry missing "livePath" at array index 1 -> throws, error names "livePath" and
 *        index 1.
 *   E4 | entry.buildable is the string "true" instead of boolean true -> rejected by
 *        schema validation (type mismatch), not silently coerced.
 *   E5 | config.source.entry points at a file that does not exist -> throws a clear,
 *        actionable error naming the resolved path (not a raw ENOENT stack).
 *   E6 | entry file exists but contains invalid JSON -> throws a clear error naming the
 *        file (not a raw SyntaxError with no context).
 *   E7 | entry file exists, is valid JSON, but is a bare object (not an array) -> throws
 *        a clear error saying an array was expected (not silent undefined/empty catalog).
 *   E8 | slug is path-traversal-shaped text ("../../etc") -> rejected via the slug
 *        pattern constraint (does not match ^[a-z0-9][a-z0-9-]*$).
 *   E9 | designPath is "<script>alert(1)</script>" -> accepted as an opaque string (free
 *        -form path field elsewhere in this codebase; stays consistent with canvas-export).
 *
 * Boundary / malformed supplements (four probe categories; see coverage map in the
 * subagent's final report)
 *   B1 | entry has an unexpected extra field ("foo") -> rejected (additionalProperties:
 *        false), naming the unexpected field.
 *   B2 | entry.slug is null -> rejected (type mismatch, not coerced to a string).
 *   B3 | entry.slug is whitespace-only (" ") -> rejected via the slug pattern.
 *   B4 | entry.designPath is a 5000-character string -> accepted unchanged (no length
 *        cap on free-form path fields, matching catalog.schema.json).
 *   B5 | entry.livePath contains unicode ("/สินค้า/😀") -> accepted unchanged as an
 *        opaque string; entry.slug containing unicode ("café") is rejected by the
 *        ascii-only slug pattern.
 *
 * Review-loop additions (closing mutation-survivor gaps found by the opus review pass)
 *   B6 | cwd=tmp, config.source.entry="entries.json" (relative) -> catalog.source.entry
 *        is stored verbatim/relative, NOT resolved to an absolute path (portability).
 *   B7 | source.sha256 is asserted against an independently-computed sha256 of the raw
 *        file bytes; two files with identical parsed content but different
 *        whitespace/formatting produce DIFFERENT hashes (rules out hashing the
 *        re-serialized/canonicalized JSON instead of the real file bytes).
 *   B8 | an entry omitting label/rootSelector -> those keys are ABSENT from the built
 *        screen object ("label" in screen === false), not present-as-undefined.
 *   B9 | three entries share the identical slug -> the duplicate-slug error names
 *        "home" exactly once (dedupe), not three times.
 *   B10 | schema-drift guard: schemas/url-pairs-input.schema.json's slug pattern stays
 *        byte-identical to schemas/catalog.schema.json's screen.slug pattern.
 *
 * N/A
 *   Numeric boundary values (0 / negative / NaN) — N/A: the url-pairs input schema (per
 *   spec) has no numeric fields to bound.
 *   Concurrent updates / out-of-order events / unmount mid-flight — N/A: buildCatalog is
 *   a synchronous, stateless file read with no shared mutable state or async lifecycle.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildUrlPairsCatalog } from "../src/adapters/url-pairs/build-catalog.js";
import { urlPairsAdapter } from "../src/adapters/url-pairs/index.js";
import { hashCatalogDocument } from "../src/core/hash.js";
import { validateCatalog } from "../src/core/validate.js";
import type { ReplicationConfig } from "../src/adapters/types.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "replicate-url-pairs-test-"));
}

function configFor(entry: string): ReplicationConfig {
  return {
    schemaVersion: 1,
    adapter: "url-pairs",
    source: { entry },
    target: { stack: "other", baseUrl: "http://127.0.0.1:3000" },
    outputDir: ".replication",
  };
}

/** Writes `entries` as JSON to `<tmp>/<name>` and returns a config pointing at it (cwd-relative). */
function writeEntries(tmp: string, name: string, entries: unknown): ReplicationConfig {
  fs.writeFileSync(path.join(tmp, name), JSON.stringify(entries), "utf8");
  return configFor(name);
}

// --- H1 ----------------------------------------------------------------------

test("H1: valid 3-entry input maps 1:1, in input order, into a valid CatalogDocument", () => {
  const tmp = tmpWorkspace();
  const entry = path.join(REPO_ROOT, "test/fixtures/url-pairs/valid-entries.json");
  const config = configFor(entry);

  const { catalog, warnings } = buildUrlPairsCatalog(tmp, config);

  assert.deepEqual(warnings, []);
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.closedWorld, true);
  assert.equal(catalog.adapter, "url-pairs");
  assert.equal(catalog.source.entry, entry);
  assert.match(catalog.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(catalog.discovery, undefined, "url-pairs catalogs carry no discovery block");

  assert.equal(catalog.screens.length, 3);
  assert.deepEqual(
    catalog.screens.map((s) => s.slug),
    ["home", "pricing", "contact-us"],
    "screens must stay in the SAME ORDER as the input file, not resorted",
  );

  const home = catalog.screens[0];
  assert.equal(home.slug, "home");
  assert.equal(home.label, "Home");
  assert.equal(home.designPath, "/design/home");
  assert.equal(home.livePath, "/");
  assert.equal(home.rootSelector, "#app-root");
  assert.equal(home.status, "in-scope");
  assert.equal(home.buildable, true);

  const pricing = catalog.screens[1];
  assert.equal(pricing.designPath, "/design/pricing");
  assert.equal(pricing.livePath, "/pricing");
  assert.equal(pricing.status, "excluded");
  assert.equal(pricing.buildable, false);
  assert.equal(pricing.label, undefined);
  assert.equal(pricing.rootSelector, undefined);

  assert.equal(validateCatalog(catalog).length, 0, "must validate against catalog.schema.json");
});

// --- H2 ------------------------------------------------------------------------

test("H2: an entry omitting status/buildable gets the documented defaults", () => {
  const tmp = tmpWorkspace();
  const entry = path.join(REPO_ROOT, "test/fixtures/url-pairs/defaults-entry.json");
  const config = configFor(entry);

  const { catalog } = buildUrlPairsCatalog(tmp, config);

  assert.equal(catalog.screens.length, 1);
  assert.equal(catalog.screens[0].status, "in-scope");
  assert.equal(catalog.screens[0].buildable, true);
  assert.equal(validateCatalog(catalog).length, 0);
});

test("H2b: getAdapter-style ReplicationAdapter export matches id and delegates to buildUrlPairsCatalog", async () => {
  assert.equal(urlPairsAdapter.id, "url-pairs");
  const tmp = tmpWorkspace();
  const entry = path.join(REPO_ROOT, "test/fixtures/url-pairs/defaults-entry.json");
  const config = configFor(entry);
  const result = await urlPairsAdapter.buildCatalog(tmp, config);
  assert.equal(result.catalog.screens.length, 1);
});

// --- W1: boundary — empty array -------------------------------------------------

test("W1: an empty-array input file is rejected (catalog screens require minItems: 1)", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", []);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /minItems|fewer than 1|at least 1|empty/i);
    return true;
  });
});

// --- W2: boundary — duplicate slugs ---------------------------------------------

test("W2: two entries with the identical slug are rejected with a clear duplicate-slug error", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: "/a", livePath: "/" },
    { slug: "home", designPath: "/b", livePath: "/b" },
  ]);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /duplicate/i);
    assert.match(err.message, /home/);
    return true;
  });
});

// --- W3: state & timing — repeated invocation -----------------------------------

test("W3: calling buildUrlPairsCatalog twice against the same unchanged file is byte-identical (determinism)", () => {
  const tmp = tmpWorkspace();
  const entry = path.join(REPO_ROOT, "test/fixtures/url-pairs/valid-entries.json");
  const config = configFor(entry);

  const a = buildUrlPairsCatalog(tmp, config).catalog;
  const b = buildUrlPairsCatalog(tmp, config).catalog;

  assert.deepEqual(a, b);
  assert.equal(hashCatalogDocument(a), hashCatalogDocument(b));
  assert.equal(validateCatalog(a).length, 0);
});

// --- E1/E2/E3: malformed/adversarial — missing required field (+ error paths: partial data) --

test("E1: an entry missing slug at index 1 throws naming 'slug' and index 1, atomically (no partial catalog)", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: "/a", livePath: "/" },
    { designPath: "/b", livePath: "/b" },
  ]);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /\/1 must have required property 'slug'/);
    return true;
  });
});

test("E2: an entry missing designPath at index 1 throws naming 'designPath' and index 1", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: "/a", livePath: "/" },
    { slug: "pricing", livePath: "/pricing" },
  ]);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /\/1 must have required property 'designPath'/);
    return true;
  });
});

test("E3: an entry missing livePath at index 1 throws naming 'livePath' and index 1", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: "/a", livePath: "/" },
    { slug: "pricing", designPath: "/pricing" },
  ]);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /\/1 must have required property 'livePath'/);
    return true;
  });
});

// --- E4: malformed/adversarial — wrong type -------------------------------------

test("E4: entry.buildable as the string \"true\" is rejected by schema validation, not coerced", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: "/a", livePath: "/", buildable: "true" },
  ]);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /buildable/);
    assert.match(err.message, /boolean/i);
    return true;
  });
});

// --- E5: error paths — missing file ---------------------------------------------

test("E5: config.source.entry pointing at a nonexistent file throws a clear, actionable error", () => {
  const tmp = tmpWorkspace();
  const missing = path.join(tmp, "does-not-exist.json");
  const config = configFor(missing);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.doesNotMatch(err.message, /^ENOENT/, "must not be a raw unhandled ENOENT stack");
    assert.match(err.message, /not found|does not exist/i);
    assert.ok(err.message.includes(missing), "error should name the resolved path");
    return true;
  });
});

// --- E6: error paths — malformed JSON -------------------------------------------

test("E6: an entry file containing invalid JSON throws a clear error naming the file, not a raw SyntaxError", () => {
  const tmp = tmpWorkspace();
  fs.writeFileSync(path.join(tmp, "entries.json"), "{ not valid json ]", "utf8");
  const config = configFor("entries.json");

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /not valid JSON|invalid JSON/i);
    assert.ok(err.message.includes("entries.json") || err.message.includes(tmp));
    return true;
  });
});

// --- E7: error paths — valid JSON that is not an array --------------------------

test("E7: an entry file that is valid JSON but a bare object throws a clear 'expected an array' error", () => {
  const tmp = tmpWorkspace();
  fs.writeFileSync(path.join(tmp, "entries.json"), JSON.stringify({ slug: "home" }), "utf8");
  const config = configFor("entries.json");

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /array/i);
    return true;
  });
});

// --- E8: malformed/adversarial — path-traversal-shaped slug ---------------------

test("E8: a path-traversal-shaped slug (\"../../etc\") is rejected via the slug pattern constraint", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "../../etc", designPath: "/a", livePath: "/" },
  ]);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /slug/);
    assert.match(err.message, /pattern/i);
    return true;
  });
});

// --- E9: malformed/adversarial — injection-shaped designPath accepted as opaque -

test("E9: an injection-shaped designPath (<script>...) is accepted as an opaque string, unchanged", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: "<script>alert(1)</script>", livePath: "/" },
  ]);

  const { catalog } = buildUrlPairsCatalog(tmp, config);
  assert.equal(catalog.screens[0].designPath, "<script>alert(1)</script>");
  assert.equal(validateCatalog(catalog).length, 0);
});

// --- B1: malformed/adversarial — unexpected extra field --------------------------

test("B1: an entry with an unexpected extra field is rejected, naming the field", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: "/a", livePath: "/", foo: "bar" },
  ]);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /additional propert/i);
    assert.match(err.message, /foo/);
    return true;
  });
});

// --- B2: boundary — null ----------------------------------------------------------

test("B2: entry.slug: null is rejected (type mismatch), not coerced to a string", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: null, designPath: "/a", livePath: "/" },
  ]);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /slug/);
    assert.match(err.message, /string/i);
    return true;
  });
});

// --- B3: boundary — whitespace-only ------------------------------------------------

test("B3: entry.slug: \" \" (whitespace-only) is rejected via the slug pattern", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: " ", designPath: "/a", livePath: "/" },
  ]);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /\/0\/slug must match pattern/);
    return true;
  });
});

// --- B4: boundary — very long values ------------------------------------------------

test("B4: a 5000-character designPath is accepted unchanged (no length cap)", () => {
  const tmp = tmpWorkspace();
  const longPath = "/" + "a".repeat(4999);
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: longPath, livePath: "/" },
  ]);

  const { catalog } = buildUrlPairsCatalog(tmp, config);
  assert.equal(catalog.screens[0].designPath, longPath);
  assert.equal(catalog.screens[0].designPath.length, 5000);
});

// --- B5: boundary — unicode --------------------------------------------------------

test("B5: unicode in livePath is accepted unchanged; unicode in slug is rejected by the ascii-only pattern", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: "/a", livePath: "/สินค้า/😀" },
  ]);
  const { catalog } = buildUrlPairsCatalog(tmp, config);
  assert.equal(catalog.screens[0].livePath, "/สินค้า/😀");

  const tmp2 = tmpWorkspace();
  const badSlugConfig = writeEntries(tmp2, "entries.json", [
    { slug: "café", designPath: "/a", livePath: "/" },
  ]);
  assert.throws(() => buildUrlPairsCatalog(tmp2, badSlugConfig), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /\/0\/slug must match pattern/);
    return true;
  });
});

// --- B6: source.entry is stored verbatim (relative), not resolved --------------------

test("B6: config.source.entry is stored verbatim (relative), not resolved to an absolute path", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: "/a", livePath: "/" },
  ]);

  const { catalog } = buildUrlPairsCatalog(tmp, config);
  assert.equal(catalog.source.entry, "entries.json");
  assert.equal(path.isAbsolute(catalog.source.entry), false);
});

// --- B7: sha256 is a real hash of the raw file bytes, not the re-serialized JSON ------

test("B7: source.sha256 is a real hash of the input file's raw bytes; reformatting the same content changes the hash", () => {
  const tmp = tmpWorkspace();
  const entries = [{ slug: "home", designPath: "/a", livePath: "/" }];
  const entryFile = path.join(tmp, "entries.json");
  fs.writeFileSync(entryFile, JSON.stringify(entries), "utf8");
  const config = configFor("entries.json");

  const { catalog } = buildUrlPairsCatalog(tmp, config);
  const expected = createHash("sha256").update(fs.readFileSync(entryFile)).digest("hex");
  assert.equal(catalog.source.sha256, expected);

  // Same parsed content, different bytes on disk (pretty-printed) -> different hash.
  const tmp2 = tmpWorkspace();
  const entryFile2 = path.join(tmp2, "entries.json");
  fs.writeFileSync(entryFile2, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  const { catalog: catalog2 } = buildUrlPairsCatalog(tmp2, configFor("entries.json"));

  assert.notEqual(catalog.source.sha256, catalog2.source.sha256);
});

// --- B8: omitted optional fields are absent keys, not present-as-undefined -----------

test("B8: omitted optional fields (label, rootSelector) are absent keys on the screen, not present-as-undefined", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: "/a", livePath: "/" },
  ]);

  const { catalog } = buildUrlPairsCatalog(tmp, config);
  const screen = catalog.screens[0] as unknown as Record<string, unknown>;
  assert.equal("label" in screen, false, "label key must be absent, not undefined-valued");
  assert.equal("rootSelector" in screen, false, "rootSelector key must be absent, not undefined-valued");
});

// --- B9: duplicate-slug dedupe — slug named exactly once for 3 duplicates ------------

test("B9: three entries sharing the same slug are rejected with the slug named exactly once in the error", () => {
  const tmp = tmpWorkspace();
  const config = writeEntries(tmp, "entries.json", [
    { slug: "home", designPath: "/a", livePath: "/" },
    { slug: "home", designPath: "/b", livePath: "/b" },
    { slug: "home", designPath: "/c", livePath: "/c" },
  ]);

  assert.throws(() => buildUrlPairsCatalog(tmp, config), (err: unknown) => {
    assert.ok(err instanceof Error);
    const occurrences = (err.message.match(/home/g) ?? []).length;
    assert.equal(occurrences, 1, `expected "home" named exactly once, got: ${err.message}`);
    return true;
  });
});

// --- B10: schema-drift guard ----------------------------------------------------------

test("B10: url-pairs slug pattern stays byte-identical to catalog.schema.json's screen.slug pattern", () => {
  const catalogSchema = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "schemas/catalog.schema.json"), "utf8"),
  ) as { $defs: { screen: { properties: { slug: { pattern: string } } } } };
  const urlPairsSchema = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "schemas/url-pairs-input.schema.json"), "utf8"),
  ) as { $defs: { entry: { properties: { slug: { pattern: string } } } } };

  assert.equal(
    urlPairsSchema.$defs.entry.properties.slug.pattern,
    catalogSchema.$defs.screen.properties.slug.pattern,
  );
});
