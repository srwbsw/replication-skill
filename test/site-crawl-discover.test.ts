import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { discoverSiteCrawl } from "../src/adapters/site-crawl/discover.js";
import type {
  BrowserLike,
  FetchPage,
  FetchPageResult,
  LaunchBrowser,
  PageLike,
  SiteCrawlOptions,
} from "../src/adapters/site-crawl/discover.js";

/**
 * Case list (written before any test code — see task PROCESS):
 *
 * H1 | happy: 5-page real fixture site (basic-site/), crawled from "/" with default maxDepth(2)
 *      → discovers exactly {/, /about, /blog, /team, /blog/post-1}, correct slug/depth/discoveredFrom.
 * H2 | happy: same fixture, maxDepth:0 → discovers only "/", follows no links.
 * W1 | weird (state/timing, repeated invocation): crawl run twice against same fixture
 *      → JSON.stringify-identical result (same page set, same order) — no nondeterminism.
 * W2 | weird (boundary, duplicates): a self-link, and a target shared by two different referrer
 *      pages, are each emitted exactly once.
 * W3 | weird (malformed/adversarial, same-origin boundary): an absolute link to a different host
 *      is never followed or emitted as a screen.
 * E1 | edge (boundary, empty): a seed page with zero outbound links discovers just that one page.
 * E2 | edge (malformed, deny-wins): denyPatterns wins over allowPatterns when both match.
 * E3 | edge (error path): a dead link's fetch throws → crawl doesn't crash, page is skipped, a
 *      warning is recorded, sibling pages still discovered.
 * E4 | edge (malformed/adversarial, injection-shaped path): "<script>…" path → safe slug, page
 *      still discovered (not silently dropped).
 * E5 | edge (malformed/adversarial, traversal-shaped path): "../../etc/passwd" relative link →
 *      WHATWG URL resolution collapses the dot-segments; no literal ".." survives.
 * E6 | edge (state & timing, bounded termination): a pathological unbounded link generator with a
 *      small maxPages cap terminates instead of hanging, emits <= maxPages pages, warns.
 * B1 | boundary: seeds: [] (empty array) behaves the same as the default (["/"]).
 * B2 | boundary: maxPages: 0 → zero fetches, zero pages, cap warning, no crash.
 * B3 | boundary: maxDepth: -1 (negative) clamps to 0 semantics, no crash.
 * B4 | boundary (unicode): a unicode discovered path is handled safely (valid slug, no crash).
 * B5 | boundary (whitespace-only): a whitespace-only seed path normalizes safely, no crash.
 * B6 | boundary (very long): a 600+ char discovered path still produces a valid, pattern-matching slug.
 * M1 | malformed/adversarial (wrong type): opts.seeds as a non-array falls back to default safely.
 * M2 | malformed/adversarial (wrong type): opts.maxDepth as a non-numeric string falls back to default.
 * Err1 | error path: a non-absolute seed URL throws a clear, descriptive error (fail-fast).
 * C1 | edge (collision): two distinct paths that sanitize to the same base slug are both kept,
 *      disambiguated (never silently dropped/merged).
 *
 * N/A: concurrent updates — the crawler is intentionally strictly sequential (one fetchPage call
 *   in flight at a time, by design, specifically to guarantee deterministic output — see W1); there
 *   is no concurrent-mutation code path to exercise.
 * N/A→covered: "cancel mid-flight" isn't a literal AbortSignal here (not part of the pinned config
 *   shape / not asked for) — its meaningful equivalent, bounding a runaway crawl so it terminates
 *   instead of hanging forever, is covered by E6.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASIC_SITE_DIR = path.join(REPO_ROOT, "test/fixtures/site-crawl/basic-site");
const DEAD_LINK_SITE_DIR = path.join(REPO_ROOT, "test/fixtures/site-crawl/dead-link-site");
const SEED_URL = "http://fixture.test";

/** Reads real static HTML fixture files off disk and extracts `href="…"` targets with a plain
 * regex (no browser, no network) — exercises discover.ts's own URL-resolution/dedup/filter logic
 * against a realistic mix of relative, root-relative, and absolute hrefs. */
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

/** Small in-memory link graph keyed by pathname — for tests that don't need real fixture files. */
function mapFetchPage(graph: Record<string, string[]>): FetchPage {
  return async (url: string): Promise<FetchPageResult> => {
    const { pathname } = new URL(url);
    return { links: graph[pathname] ?? [] };
  };
}

// --- H1 / H2 -----------------------------------------------------------------

test("H1 | 5-page fixture site crawled from '/' with default maxDepth discovers exactly the expected set", async () => {
  const result = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: fixtureFetchPage(BASIC_SITE_DIR) });
  const byPath = new Map(result.pages.map((p) => [p.path, p]));

  assert.deepEqual(
    [...byPath.keys()].sort(),
    ["/", "/about", "/blog", "/blog/post-1", "/team"].sort(),
  );
  assert.equal(byPath.get("/")!.slug, "home");
  assert.equal(byPath.get("/about")!.slug, "about");
  assert.equal(byPath.get("/blog")!.slug, "blog");
  assert.equal(byPath.get("/blog/post-1")!.slug, "blog-post-1");
  assert.equal(byPath.get("/team")!.slug, "team");
  assert.equal(byPath.get("/")!.depth, 0);
  assert.equal(byPath.get("/about")!.depth, 1);
  assert.equal(byPath.get("/blog")!.depth, 1);
  assert.equal(byPath.get("/team")!.depth, 2);
  assert.equal(byPath.get("/blog/post-1")!.depth, 2);
  for (const p of result.pages) {
    assert.equal(p.discoveredFrom, "/", `discoveredFrom must trace back to the seed for ${p.path}`);
  }
  assert.deepEqual(result.warnings, []);
});

test("H2 | maxDepth: 0 discovers only the seed page(s) themselves, follows no links", async () => {
  const result = await discoverSiteCrawl(
    SEED_URL,
    { maxDepth: 0 },
    { fetchPage: fixtureFetchPage(BASIC_SITE_DIR) },
  );
  assert.deepEqual(result.pages.map((p) => p.path), ["/"]);
  assert.equal(result.pages[0]!.depth, 0);
});

// --- W1 (state & timing: repeated invocation / determinism) ------------------

test("W1 | running the crawl twice against the same fixture produces byte-identical output", async () => {
  const a = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: fixtureFetchPage(BASIC_SITE_DIR) });
  const b = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: fixtureFetchPage(BASIC_SITE_DIR) });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// --- W2 (boundary: duplicates) ------------------------------------------------

test("W2 | a self-link and a link shared by two different pages are each emitted only once", async () => {
  const stub = mapFetchPage({
    "/": ["/", "/a", "/b"],
    "/a": ["/shared"],
    "/b": ["/shared"],
    "/shared": [],
  });
  const result = await discoverSiteCrawl(SEED_URL, { maxDepth: 3 }, { fetchPage: stub });

  assert.equal(result.pages.filter((p) => p.path === "/").length, 1, "self-link must not duplicate the root");
  assert.equal(result.pages.filter((p) => p.path === "/shared").length, 1, "/shared must be emitted exactly once");
  assert.equal(result.pages.length, 4);
});

// --- W3 (malformed/adversarial: same-origin boundary) -------------------------

test("W3 | an absolute link to a different origin is never followed or emitted as a screen", async () => {
  const result = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: fixtureFetchPage(BASIC_SITE_DIR) });
  const paths = result.pages.map((p) => p.path);
  assert.ok(!paths.some((p) => p.includes("evil")), "cross-origin link must never appear as a discovered path");
  assert.equal(result.pages.length, 5, "cross-origin link must not silently inflate the discovered set either");
});

// --- E1 (boundary: empty) -----------------------------------------------------

test("E1 | a seed page with zero outbound links discovers just that one page, no crash", async () => {
  const stub = mapFetchPage({ "/": [] });
  const result = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: stub });
  assert.deepEqual(result.pages.map((p) => p.path), ["/"]);
  assert.deepEqual(result.warnings, []);
});

// --- E2 (malformed: deny wins over allow) -------------------------------------

test("E2 | denyPatterns wins over allowPatterns when both match the same discovered path", async () => {
  const stub = mapFetchPage({
    "/": ["/blog/public", "/blog/private-notes"],
    "/blog/public": [],
    "/blog/private-notes": [],
  });
  const result = await discoverSiteCrawl(
    SEED_URL,
    { allowPatterns: ["/blog/*"], denyPatterns: ["/blog/private*"] },
    { fetchPage: stub },
  );
  assert.deepEqual(result.pages.map((p) => p.path).sort(), ["/", "/blog/public"]);
});

// --- E3 (error path) -----------------------------------------------------------

test("E3 | a dead link's fetch failure is skipped with a warning, crawl continues", async () => {
  const result = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: fixtureFetchPage(DEAD_LINK_SITE_DIR) });
  assert.deepEqual(result.pages.map((p) => p.path).sort(), ["/", "/works"]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /\/broken/);
  assert.match(result.warnings[0]!, /fetch failed/i);
});

// --- E4 (malformed/adversarial: injection-shaped path) -------------------------

test("E4 | an injection-shaped discovered path (<script>…) never produces an unsafe slug", async () => {
  const injected = "/<script>alert(1)</script>";
  const stub = mapFetchPage({ "/": [injected] });
  const result = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: stub });
  const page = result.pages.find((p) => p.depth === 1);
  assert.ok(page, "the injected-path page should still be discovered, not silently dropped");
  assert.match(page!.slug, /^[a-z0-9][a-z0-9-]*$/);
  assert.ok(!page!.slug.includes("<") && !page!.slug.includes(">"));
});

// --- E5 (malformed/adversarial: traversal-shaped path) -------------------------

test("E5 | a traversal-shaped relative link (../../etc/passwd) is neutralized by URL resolution", async () => {
  const stub = mapFetchPage({
    "/": ["/blog/post-1"],
    "/blog/post-1": ["../../etc/passwd"],
  });
  const result = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: stub });
  const traversalPage = result.pages.find((p) => p.depth === 2);
  assert.ok(traversalPage, "the traversal link should resolve to a real same-origin page");
  assert.ok(!traversalPage!.path.includes(".."), "URL resolution must collapse dot-segments");
  assert.match(traversalPage!.slug, /^[a-z0-9][a-z0-9-]*$/);
});

// --- E6 (state & timing: bounded termination of a pathological crawl) ----------

test("E6 | a pathological unbounded link generator is bounded by maxPages and terminates", async () => {
  let counter = 0;
  const stub: FetchPage = async () => {
    counter++;
    return { links: [`/gen/${counter}`] };
  };
  const result = await discoverSiteCrawl(SEED_URL, { maxDepth: 1000, maxPages: 5 }, { fetchPage: stub });

  assert.equal(result.pages.length, 5, "must be bounded by maxPages, not run away");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /max-pages cap \(5\)/);
});

// --- B1-B6 (boundary probes) ----------------------------------------------------

test("B1 | seeds: [] (empty array) behaves the same as omitting seeds (default ['/'])", async () => {
  const stub = mapFetchPage({ "/": [] });
  const withEmpty = await discoverSiteCrawl(SEED_URL, { seeds: [] }, { fetchPage: stub });
  const withDefault = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: stub });
  assert.deepEqual(withEmpty.pages.map((p) => p.path), ["/"]);
  assert.deepEqual(withEmpty.pages.map((p) => p.path), withDefault.pages.map((p) => p.path));
});

test("B2 | maxPages: 0 performs zero fetches, discovers zero pages, warns, no crash", async () => {
  let calls = 0;
  const stub: FetchPage = async () => {
    calls++;
    return { links: [] };
  };
  const result = await discoverSiteCrawl(SEED_URL, { maxPages: 0 }, { fetchPage: stub });
  assert.equal(calls, 0);
  assert.deepEqual(result.pages, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /max-pages cap \(0\)/);
});

test("B3 | maxDepth: -1 (negative) clamps to 0 semantics — only seed(s), no children, no crash", async () => {
  const stub = mapFetchPage({ "/": ["/a"] });
  const result = await discoverSiteCrawl(SEED_URL, { maxDepth: -1 }, { fetchPage: stub });
  assert.deepEqual(result.pages.map((p) => p.path), ["/"]);
});

test("B4 | a unicode discovered path is handled safely — valid slug, no crash", async () => {
  const stub = mapFetchPage({ "/": ["/blog/café-résumé"], "/blog/café-résumé": [] });
  const result = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: stub });
  const page = result.pages.find((p) => p.depth === 1);
  assert.ok(page, "unicode-path page should be discovered exactly once");
  assert.match(page!.slug, /^[a-z0-9][a-z0-9-]*$/);
  assert.equal(result.pages.length, 2);
});

test("B5 | a whitespace-only seed path normalizes safely (no crash, always a valid path)", async () => {
  const stub = mapFetchPage({ "/": [] });
  const result = await discoverSiteCrawl(SEED_URL, { seeds: ["   "] }, { fetchPage: stub });
  assert.equal(result.pages.length, 1);
  assert.match(result.pages[0]!.path, /^\//);
});

test("B6 | a pathologically long discovered path still produces a valid, pattern-matching slug", async () => {
  const longSegment = "a".repeat(600);
  const longPath = `/${longSegment}`;
  const stub = mapFetchPage({ "/": [longPath], [longPath]: [] });
  const result = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: stub });
  const page = result.pages.find((p) => p.depth === 1);
  assert.ok(page);
  assert.match(page!.slug, /^[a-z0-9][a-z0-9-]*$/);
});

// --- M1-M2 (malformed/adversarial: wrong runtime types) -------------------------

test("M1 | opts.seeds passed as a non-array (wrong type) falls back to default ['/'] safely", async () => {
  const stub = mapFetchPage({ "/": [] });
  const badOpts = { seeds: "not-an-array" } as unknown as SiteCrawlOptions;
  const result = await discoverSiteCrawl(SEED_URL, badOpts, { fetchPage: stub });
  assert.deepEqual(result.pages.map((p) => p.path), ["/"]);
});

test("M2 | opts.maxDepth passed as a non-numeric string falls back to the documented default (2)", async () => {
  const stub = mapFetchPage({ "/": ["/a"], "/a": ["/b"], "/b": ["/c"] });
  const badOpts = { maxDepth: "two" } as unknown as SiteCrawlOptions;
  const result = await discoverSiteCrawl(SEED_URL, badOpts, { fetchPage: stub });
  assert.deepEqual(result.pages.map((p) => p.path).sort(), ["/", "/a", "/b"]);
});

// --- Err1 (error path: fail-fast on a fundamentally broken seed) ----------------

test("Err1 | a non-absolute seed URL throws a clear, descriptive error (fail-fast)", async () => {
  await assert.rejects(
    () => discoverSiteCrawl("not-a-url", {}, { fetchPage: mapFetchPage({}) }),
    (err: unknown) => {
      assert.ok(err instanceof Error, "expected an Error instance, not a silent failure");
      assert.match(err.message, /absolute URL/i);
      return true;
    },
  );
});

// --- C1 (edge: slug collision disambiguation) -----------------------------------

test("C1 | two distinct paths that sanitize to the same base slug are both kept, disambiguated", async () => {
  const stub = mapFetchPage({
    "/": ["/foo/bar", "/foo-bar"],
    "/foo/bar": [],
    "/foo-bar": [],
  });
  const result = await discoverSiteCrawl(SEED_URL, {}, { fetchPage: stub });
  const first = result.pages.find((p) => p.path === "/foo/bar");
  const second = result.pages.find((p) => p.path === "/foo-bar");
  assert.ok(first && second, "both distinct paths must be present, never dropped");
  assert.notEqual(first!.slug, second!.slug, "colliding base slugs must be disambiguated, not merged");
  assert.equal(first!.slug, "foo-bar");
  assert.equal(second!.slug, "foo-bar-2");
});

// =============================================================================
// Bug 1 fix: the default browser-backed fetchPage path must reuse a single browser
// (and page) for the whole crawl, not launch+close one per page.
//
// Case list (written before any test code — see task PROCESS):
//
// Bug1-H1 | happy: a fixture crawl that discovers N (>1) pages via the DEFAULT browser-backed
//   path (no `fetchPage` injected — only a fake `launchBrowser`, so discover.ts's own
//   browser-driving code is what's under test) launches exactly ONE browser for the whole crawl,
//   never once per page. Uses an injected fake `launchBrowser` (mirrors how `fetchPage` is
//   already injectable) so no real installed browser is required.
// Bug1-E1 | error path: a per-page navigation failure mid-crawl (mirrors the existing
//   dead-link-site/E3 fixture pattern: one page's fetch/goto fails) still lets the crawl finish
//   (skip + warning, unchanged behavior) AND the single browser is still closed exactly once
//   afterward — no leaked browser process on a partial/error path.
// Bug1-W1 | state & timing (repeated/independent invocation): two independent
//   `discoverSiteCrawl` calls (separate `deps` objects, not sharing any state) each launch
//   exactly one browser of their own — 1 + 1 = 2 total launches, never 0 (a call silently
//   skipping/leaking) and never fewer than 2 (which would mean state bled across independent
//   crawls via some accidental module-level singleton).
//
// N/A: malformed/adversarial and most boundary probes for this sub-area are already exhaustively
//   covered above (E1-E6, B1-B6, M1-M2, Err1, C1) against the *crawl logic*, which is unchanged by
//   this fix — the browser reuse mechanism only touches *how* fetchPage's underlying browser is
//   sourced/lifecycled when a caller does not supply its own fetchPage, which is exactly what
//   Bug1-H1/E1/W1 exercise.

/** A fake `BrowserLike`/`PageLike` pair: a single fake "page" is created once (per fake browser)
 * and reused across navigations, exactly like the real fix is expected to do. `linksByPath` drives
 * what `evaluate()` returns after each `goto()`, keyed by pathname. Optionally, `failPath` makes
 * `goto()` reject for exactly that one pathname, simulating a dead/broken page (E1). */
function makeFakeBrowser(
  linksByPath: Record<string, string[]>,
  opts: { failPath?: string } = {},
): { browser: BrowserLike; closeCalls: () => number; newPageCalls: () => number } {
  let closeCount = 0;
  let newPageCount = 0;
  let currentPath = "";
  const page: PageLike = {
    goto: async (url: string) => {
      const { pathname } = new URL(url);
      if (opts.failPath && pathname === opts.failPath) {
        throw new Error(`simulated navigation failure for ${pathname}`);
      }
      currentPath = pathname;
      return null;
    },
    evaluate: async <T>(): Promise<T> => (linksByPath[currentPath] ?? []) as unknown as T,
  };
  const browser: BrowserLike = {
    newPage: async () => {
      newPageCount++;
      return page;
    },
    close: async () => {
      closeCount++;
    },
  };
  return { browser, closeCalls: () => closeCount, newPageCalls: () => newPageCount };
}

test("Bug1-H1 | the default browser-backed path launches exactly ONE browser for the whole crawl, not once per page", async () => {
  const linksByPath = {
    "/": ["/a", "/b"],
    "/a": ["/c"],
    "/b": [],
    "/c": [],
  };
  const fake = makeFakeBrowser(linksByPath);
  let launchCalls = 0;
  const launchBrowser: LaunchBrowser = async () => {
    launchCalls++;
    return fake.browser;
  };

  const result = await discoverSiteCrawl(SEED_URL, { maxDepth: 3 }, { launchBrowser });

  assert.deepEqual(
    result.pages.map((p) => p.path).sort(),
    ["/", "/a", "/b", "/c"],
    "the crawl itself must still discover all 4 pages",
  );
  assert.equal(launchCalls, 1, "launchBrowser must be called exactly once for the whole crawl (4 pages, 1 launch)");
  assert.equal(fake.closeCalls(), 1, "the single browser must be closed exactly once after the crawl completes");
});

test("Bug1-E1 | a per-page navigation failure mid-crawl still finishes (skip+warn) and still closes the browser exactly once", async () => {
  const linksByPath = {
    "/": ["/works", "/broken"],
    "/works": [],
    "/broken": [],
  };
  const fake = makeFakeBrowser(linksByPath, { failPath: "/broken" });
  const launchBrowser: LaunchBrowser = async () => fake.browser;

  const result = await discoverSiteCrawl(SEED_URL, {}, { launchBrowser });

  assert.deepEqual(result.pages.map((p) => p.path).sort(), ["/", "/works"]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /\/broken/);
  assert.equal(
    fake.closeCalls(),
    1,
    "the browser must still be closed even though one page's navigation failed mid-crawl",
  );
});

test("Bug1-W1 | two independent discoverSiteCrawl calls each launch exactly one browser of their own", async () => {
  let totalLaunches = 0;
  const runOnce = async () => {
    const fake = makeFakeBrowser({ "/": [] });
    const launchBrowser: LaunchBrowser = async () => {
      totalLaunches++;
      return fake.browser;
    };
    const result = await discoverSiteCrawl(SEED_URL, {}, { launchBrowser });
    assert.equal(fake.closeCalls(), 1, "each independent crawl's own browser must be closed once");
    return result;
  };

  const a = await runOnce();
  const b = await runOnce();

  assert.equal(
    totalLaunches,
    2,
    "each of the two independent crawls launches its own single browser (1 + 1 = 2) — never 0 (leaked/skipped) and never shared state bleeding across calls",
  );
  assert.deepEqual(a.pages.map((p) => p.path), ["/"]);
  assert.deepEqual(b.pages.map((p) => p.path), ["/"]);
});
