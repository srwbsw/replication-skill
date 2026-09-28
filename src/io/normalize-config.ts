import { normalizeAdapterId, type AdapterId } from "../core/adapter-id.js";
import type { ReplicationConfig } from "../adapters/types.js";

export function normalizeReplicationConfig(config: ReplicationConfig): ReplicationConfig {
  const adapter = normalizeAdapterId(config.adapter);
  if (!adapter) {
    throw new Error(`Unknown adapter: ${config.adapter}`);
  }
  if (adapter === config.adapter) {
    return config;
  }
  return { ...config, adapter };
}

export function assertAdapterId(adapter: string): AdapterId {
  const normalized = normalizeAdapterId(adapter);
  if (!normalized) {
    throw new Error(`Unknown adapter: ${adapter}`);
  }
  return normalized;
}
