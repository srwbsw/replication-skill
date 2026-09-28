import type { CatalogDocument } from "../adapters/types.js";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Bug-2 fix: `designPath` is now a generic, adapter-agnostic field (url-pairs lets a user hand-
 * write any path; site-crawl emits real discovered routes), not just canvas-export's always-
 * directory-shaped values (e.g. "screens/auth-login"). A path whose LAST segment looks like a
 * real filename ("name.ext", e.g. "screens/login.html") must not get a trailing slash forced onto
 * it. A path whose last segment has no such extension keeps the pre-fix directory-style behavior
 * (trailing slash appended), which is what every canvas-export designPath looks like.
 *
 * The heuristic requires a "." with at least one character BEFORE it in the last segment — i.e. a
 * real "name.ext" shape. A segment that is *only* dot-prefixed (e.g. ".hidden", ".well-known") has
 * no filename stem before its dot, so it does not count as file-like and keeps directory-style
 * trailing-slash treatment (see Bug2-E2 in test/parity-urls.test.ts for the explicit case + the
 * full justification). Only the LAST path segment is inspected — an unrelated "." in an earlier
 * segment (e.g. "v1.2/screens/login") must never false-positive this check.
 */
function isFileLikeLastSegment(pathPart: string): boolean {
  const segments = pathPart.split("/").filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  if (!last) return false;
  const dotIndex = last.lastIndexOf(".");
  return dotIndex > 0;
}

function joinUrl(base: string, pathPart: string): string {
  const b = trimTrailingSlash(base);
  if (!pathPart || pathPart === "." || pathPart === "/") {
    return `${b}/`;
  }
  const p = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  if (isFileLikeLastSegment(pathPart)) {
    return `${b}${p}`;
  }
  return `${b}${p.endsWith("/") ? p : `${p}/`}`;
}

/** HTTP URL for a frozen reference page (static server root = design base). */
export function designUrlForScreen(designBaseUrl: string, screen: CatalogDocument["screens"][number]): string {
  const sub = screen.designPath.replace(/^\.\/?/, "");
  if (!sub || sub === ".") {
    return joinUrl(designBaseUrl, "/");
  }
  return joinUrl(designBaseUrl, sub);
}

/** HTTP URL for the implementation under test. */
export function targetUrlForScreen(
  targetBaseUrl: string,
  livePath: string,
  localePrefix?: string,
): string {
  const base = trimTrailingSlash(targetBaseUrl);
  const path = livePath.startsWith("/") ? livePath : `/${livePath}`;
  const prefix = localePrefix?.replace(/\/$/, "") ?? "";
  if (prefix && !path.startsWith(`${prefix}/`) && path !== prefix) {
    return `${base}${prefix}${path}`;
  }
  return `${base}${path}`;
}

export function normalizePathKey(path: string): string {
  const [pathname] = path.split("?");
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Paths declared in catalog (implementation side, locale prefix stripped). */
export function catalogTargetPathKeys(
  catalog: CatalogDocument,
  localePrefix?: string,
): Set<string> {
  const prefix = localePrefix?.replace(/\/$/, "") ?? "";
  const keys = new Set<string>();
  for (const screen of catalog.screens) {
    if (screen.status !== "in-scope" || !screen.buildable) continue;
    let p = normalizePathKey(screen.livePath);
    if (prefix && p.startsWith(`${prefix}/`)) {
      p = p.slice(prefix.length) || "/";
    }
    keys.add(p);
  }
  return keys;
}
