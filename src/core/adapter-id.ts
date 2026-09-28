/** Supported replication adapters (stored in config and catalog). */
export const ADAPTER_IDS = ["canvas-export", "site-crawl", "router-migration", "url-pairs"] as const;
export type AdapterId = (typeof ADAPTER_IDS)[number];

/** Legacy adapter names from earlier skill versions — normalized at load time. */
const LEGACY_ADAPTER_IDS: Record<string, AdapterId> = {
  "dc-html": "canvas-export",
  "static-site": "site-crawl",
  "framework-migration": "router-migration",
};

export function normalizeAdapterId(raw: string): AdapterId | null {
  if ((ADAPTER_IDS as readonly string[]).includes(raw)) {
    return raw as AdapterId;
  }
  return LEGACY_ADAPTER_IDS[raw] ?? null;
}
