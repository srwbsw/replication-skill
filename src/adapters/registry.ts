import type { ReplicationAdapter } from "./adapter.js";
import { buildCanvasExportCatalog } from "./canvas-export/build-catalog.js";
import { siteCrawlAdapter } from "./site-crawl/index.js";
import { urlPairsAdapter } from "./url-pairs/index.js";
import type { AdapterId } from "./types.js";

const canvasExportAdapter: ReplicationAdapter = {
  id: "canvas-export",
  buildCatalog: (cwd, config) => buildCanvasExportCatalog(cwd, config),
};

const registry: Partial<Record<AdapterId, ReplicationAdapter>> = {
  "canvas-export": canvasExportAdapter,
  "site-crawl": siteCrawlAdapter,
  "url-pairs": urlPairsAdapter,
};

export function getAdapter(id: AdapterId): ReplicationAdapter {
  const adapter = registry[id];
  if (!adapter) {
    throw new Error(`Adapter "${id}" is not implemented yet.`);
  }
  return adapter;
}
