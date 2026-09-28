import type { ReplicationAdapter } from "../adapter.js";
import { buildUrlPairsCatalog } from "./build-catalog.js";

export const urlPairsAdapter: ReplicationAdapter = {
  id: "url-pairs",
  buildCatalog: (cwd, config) => buildUrlPairsCatalog(cwd, config),
};
