import type { AdapterId, CatalogDocument, ReplicationConfig } from "./types.js";

export interface ReplicationAdapter {
  readonly id: AdapterId;
  buildCatalog(
    cwd: string,
    config: ReplicationConfig,
  ): Promise<{ catalog: CatalogDocument; warnings: string[] }> | { catalog: CatalogDocument; warnings: string[] };
  buildReference?(cwd: string, config: ReplicationConfig): Promise<void>;
}
