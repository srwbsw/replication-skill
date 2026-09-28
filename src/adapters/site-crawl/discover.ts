/**
 * site-crawl discovery: BFS over same-origin links starting from one or more seed paths,
 * driven by an injectable `fetchPage` so production code can use a real browser (Playwright)
 * while tests stay fast/offline with a canned stub.
 *
 * Design notes (documented per task instructions):
 * - Dedup key: query strings and hash fragments are stripped before comparing/emitting paths —
 *   "/x?a=1" and "/x#y" and "/x" are all treated as the single page "/x". We deliberately do NOT
 *   percent-decode path text (avoids double-decode traversal tricks); dot-segments ("..") are
 *   collapsed only when a link is resolved via the WHATWG URL algorithm (real link-following),
 *   not when a raw seed path string is normalized (seeds are trusted, operator-provided config,
 *   not attacker-controlled `<a href>` content).
 * - allowPatterns/denyPatterns are simple globs (`*` = any run of characters), matched against the
 *   path-only form of a *discovered link*. They do not filter the seed paths themselves (seeds are
 *   explicit, intentional configuration). Deny always wins when both match.
 * - Crawling is strictly sequential (one fetchPage call in flight at a time). This is intentional:
 *   it removes any possibility of async race conditions affecting discovery order, so two runs of
 *   the same crawl always produce byte-identical output.
 * - A page whose fetch throws/rejects is skipped (a warning is recorded, the page is not emitted,
 *   the crawl continues) rather than aborting the whole crawl — one dead link should not take down
 *   an otherwise-successful catalog build.
 * - `maxPages` bounds total fetch attempts so a pathological site (a cycle-free, ever-growing link
 *   generator) cannot make the crawl hang; the crawl terminates and reports a warning.
 * - When the caller does not inject its own `fetchPage` (production use, not tests), exactly one
 *   browser (and one page within it, reused across navigations) is launched before the BFS loop
 *   starts and closed once after the crawl finishes — including on an early-throw path — so a
 *   `maxPages: 500` crawl launches/closes Chromium once, not up to 500 times. See `LaunchBrowser`,
 *   `createBrowserFetchPage`, and `defaultLaunchBrowser` below.
 */

export interface FetchPageResult {
  /** Raw hrefs found on the page, exactly as authored (may be relative or absolute). */
  links: string[];
}

export type FetchPage = (url: string) => Promise<FetchPageResult>;

/** Minimal shape of a Playwright `Page` actually used here — kept narrow (not the real Playwright
 * type) so tests can inject a fully in-memory fake with no real browser/network involved. */
export interface PageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(pageFunction: () => T): Promise<T>;
}

/** Minimal shape of a Playwright `Browser` actually used here — see `PageLike`. */
export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

/** Launches (and returns) one browser instance. Defaults to a real Playwright Chromium launch
 * (see `defaultLaunchBrowser`); tests inject their own fake so no real browser is required. */
export type LaunchBrowser = () => Promise<BrowserLike>;

export interface SiteCrawlOptions {
  /** Extra seed paths relative to the entry origin. Default: ["/"]. */
  seeds?: string[];
  /** BFS depth limit; seed pages are depth 0. Default: 2. */
  maxDepth?: number;
  /** If non-empty, only discovered links whose path matches at least one glob are followed/kept. */
  allowPatterns?: string[];
  /** Discovered links whose path matches any glob here are never followed/kept. Deny wins over allow. */
  denyPatterns?: string[];
  /**
   * Safety cap on total fetch attempts for one crawl (not part of the pinned config shape — an
   * adapter-internal safety net). Default: 500.
   */
  maxPages?: number;
}

export interface DiscoveredPage {
  /** Path-only, query/hash stripped, always starts with "/". */
  path: string;
  slug: string;
  /** The seed path whose BFS tree this page was discovered under. */
  discoveredFrom: string;
  depth: number;
}

export interface SiteCrawlResult {
  pages: DiscoveredPage[];
  warnings: string[];
}

export const DEFAULT_MAX_DEPTH = 2;
export const DEFAULT_MAX_PAGES = 500;

/**
 * BFS crawl from `seedUrl` (an absolute origin URL). `deps.fetchPage` defaults to a real
 * Playwright-backed browser fetch (see `createBrowserFetchPage`/`defaultLaunchBrowser` below);
 * tests must always inject their own stub (`fetchPage` or `launchBrowser`) so no real
 * browser/network is required to run the suite.
 */
export async function discoverSiteCrawl(
  seedUrl: string,
  opts: SiteCrawlOptions = {},
  deps: { fetchPage?: FetchPage; launchBrowser?: LaunchBrowser } = {},
): Promise<SiteCrawlResult> {
  if (typeof seedUrl !== "string" || seedUrl.trim() === "") {
    throw new Error(`site-crawl seed must be a non-empty absolute URL, got: ${JSON.stringify(seedUrl)}`);
  }
  let origin: string;
  try {
    origin = new URL(seedUrl).origin;
  } catch {
    throw new Error(`site-crawl seed must be an absolute URL, got: ${JSON.stringify(seedUrl)}`);
  }

  const safeOpts = opts && typeof opts === "object" ? opts : ({} as SiteCrawlOptions);
  const maxDepth = coerceNonNegativeInt(safeOpts.maxDepth, DEFAULT_MAX_DEPTH);
  const maxPages = coerceNonNegativeInt(safeOpts.maxPages, DEFAULT_MAX_PAGES);
  const allow = coerceStringArray(safeOpts.allowPatterns);
  const deny = coerceStringArray(safeOpts.denyPatterns);
  const seedPaths = normalizeSeedList(safeOpts.seeds);

  // Bug-1 fix: launch (at most) one browser for the WHOLE crawl, not once per page. Only needed
  // when the caller hasn't injected its own fetchPage — tests always inject one, so this path is
  // production-only. `ownedBrowser` is closed exactly once in the `finally` below, including on
  // an early-throw path, so a partial/failed crawl never leaks an open browser process.
  let ownedBrowser: BrowserLike | undefined;
  let fetchPage: FetchPage;
  if (deps.fetchPage) {
    fetchPage = deps.fetchPage;
  } else {
    const launchBrowser = deps.launchBrowser ?? defaultLaunchBrowser;
    ownedBrowser = await launchBrowser();
    fetchPage = await createBrowserFetchPage(ownedBrowser);
  }

  try {
    const warnings: string[] = [];
    /** Dedup key set — every path ever enqueued (seed or discovered link), in first-seen order. */
    const visited = new Set<string>();
    const queue: Array<{ path: string; discoveredFrom: string; depth: number }> = [];
    /** Only pages that were actually fetched successfully end up here — the final emitted set. */
    const resultsByPath = new Map<string, { discoveredFrom: string; depth: number }>();

    for (const seedPath of seedPaths) {
      if (!visited.has(seedPath)) {
        visited.add(seedPath);
        queue.push({ path: seedPath, discoveredFrom: seedPath, depth: 0 });
      }
    }

    let fetchCount = 0;
    while (queue.length > 0) {
      if (fetchCount >= maxPages) {
        warnings.push(
          `max-pages cap (${maxPages}) reached; crawl truncated before visiting all discovered links`,
        );
        break;
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const current = queue.shift()!;
      fetchCount++;
      const pageUrl = `${origin}${current.path}`;

      let fetched: FetchPageResult;
      try {
        fetched = await fetchPage(pageUrl);
      } catch (err) {
        warnings.push(`skipped ${current.path}: fetch failed (${errMessage(err)})`);
        continue;
      }

      resultsByPath.set(current.path, { discoveredFrom: current.discoveredFrom, depth: current.depth });

      if (current.depth >= maxDepth) continue;

      for (const rawLink of fetched.links ?? []) {
        let linkUrl: URL;
        try {
          linkUrl = new URL(rawLink, pageUrl);
        } catch {
          continue; // malformed href — ignore, not a crash
        }
        if (linkUrl.protocol !== "http:" && linkUrl.protocol !== "https:") continue; // mailto:, tel:, javascript:, ...
        if (linkUrl.origin !== origin) continue; // hard same-origin safety boundary

        const childPath = normalizePath(linkUrl.pathname);
        if (visited.has(childPath)) continue;
        if (deny.length > 0 && matchesAny(childPath, deny)) continue;
        if (allow.length > 0 && !matchesAny(childPath, allow)) continue;

        visited.add(childPath);
        queue.push({ path: childPath, discoveredFrom: current.discoveredFrom, depth: current.depth + 1 });
      }
    }

    const usedSlugs = new Map<string, string>(); // slug -> path that claimed it
    const pages: DiscoveredPage[] = [];
    for (const [pagePath, meta] of resultsByPath.entries()) {
      const base = pathToSlug(pagePath);
      const slug = dedupeSlug(base, usedSlugs);
      usedSlugs.set(slug, pagePath);
      pages.push({ path: pagePath, slug, discoveredFrom: meta.discoveredFrom, depth: meta.depth });
    }

    return { pages, warnings };
  } finally {
    if (ownedBrowser) {
      await ownedBrowser.close();
    }
  }
}

// --- helpers ----------------------------------------------------------------

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function coerceNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  return fallback;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function normalizeSeedList(seeds: unknown): string[] {
  const raw = coerceStringArray(seeds);
  const list = raw.length > 0 ? raw : ["/"];
  return list.map(normalizePath);
}

/** Path-only normalization: strip query/hash, ensure a single leading slash, collapse "//", trim
 * a trailing slash (except root). Does NOT percent-decode and does NOT collapse ".." — those are
 * only ever collapsed by the WHATWG URL resolver when following a real link (see discoverSiteCrawl). */
export function normalizePath(raw: string): string {
  let p = String(raw ?? "").trim();
  p = p.split("#")[0]!.split("?")[0]!;
  if (p === "") p = "/";
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/**
 * Deterministically derive a schema-safe slug (`^[a-z0-9][a-z0-9-]*$`) from a path.
 * "/" -> "home". Any character outside [a-z0-9-] is stripped (never survives into the slug),
 * so this is safe even for adversarial/injection-shaped input (`<script>…`, encoded traversal,
 * unicode, etc.) — the raw path itself (not this slug) remains the value used for navigation.
 */
export function pathToSlug(path: string): string {
  if (path === "/") return "home";
  let raw = path.replace(/^\/+|\/+$/g, "").toLowerCase();
  raw = raw.replace(/\//g, "-");
  raw = raw.replace(/[^a-z0-9-]/g, "");
  raw = raw.replace(/-{2,}/g, "-");
  raw = raw.replace(/^-+|-+$/g, "");
  if (!raw) return "page";
  if (!/^[a-z0-9]/.test(raw)) raw = `page-${raw}`;
  return raw;
}

function dedupeSlug(base: string, used: Map<string, string>): string {
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}

/**
 * Wrap one already-launched browser into a `FetchPage`. Bug-1 fix: a single page is opened once
 * and reused (sequential navigations, one at a time — the crawl is strictly sequential, see the
 * module doc) for every fetch in the crawl, instead of the previous behavior of launching AND
 * closing a fresh browser per page (impractically slow at `maxPages: 500`, and wasteful). The
 * browser itself is owned and closed by `discoverSiteCrawl`, not here.
 */
async function createBrowserFetchPage(browser: BrowserLike): Promise<FetchPage> {
  const page = await browser.newPage();
  return async (url: string): Promise<FetchPageResult> => {
    await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => Boolean(href)),
    );
    return { links };
  };
}

/**
 * Real headless-browser launch. Not exercised by the test suite: `playwright` is a declared
 * dependency of this package but is not installed in every environment this repo's tests run in,
 * so this function only touches it lazily, inside its own body, via a dynamic import — the module
 * is never resolved unless this function actually runs (i.e. only when a caller does not inject
 * its own `fetchPage`/`launchBrowser`, which none of this adapter's tests do). Cast to `BrowserLike`
 * at this one boundary: the real Playwright `Browser`/`Page` types structurally provide everything
 * `BrowserLike`/`PageLike` need, but their full option-object types are wider than our narrow
 * internal interface, so an explicit cast here is the deliberate, minimal edge where "real
 * Playwright" meets "our injectable, test-friendly shape".
 */
async function defaultLaunchBrowser(): Promise<BrowserLike> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  return browser as unknown as BrowserLike;
}
