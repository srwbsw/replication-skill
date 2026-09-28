import type { ReplicationAdapter } from "../adapter.js";
import { buildSiteCrawlCatalog } from "./build-catalog.js";

export const siteCrawlAdapter: ReplicationAdapter = {
  id: "site-crawl",
  buildCatalog: (cwd, config) => buildSiteCrawlCatalog(cwd, config),
};

export { buildSiteCrawlCatalog } from "./build-catalog.js";
export type { SiteCrawlBuildDeps } from "./build-catalog.js";
export {
  discoverSiteCrawl,
  pathToSlug,
  normalizePath,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_PAGES,
} from "./discover.js";
export type {
  FetchPage,
  FetchPageResult,
  SiteCrawlOptions,
  DiscoveredPage,
  SiteCrawlResult,
} from "./discover.js";
