import type { AdapterId } from "../core/adapter-id.js";

export type { AdapterId };

export interface ReplicationConfig {
  schemaVersion: 1;
  adapter: AdapterId;
  source: {
    entry: string;
    screenDefinitions?: string;
    /** site-crawl: seed URLs, depth, allowlist (planned) */
    crawl?: Record<string, unknown>;
  };
  /** Served design reference (frozen HTML static server or live design URL). */
  design?: {
    baseUrl: string;
    kind?: "url" | "reference";
  };
  target: {
    /** Free-form, optional description of the target stack (e.g. "next-app-router", "rails", "django"). Not read by any command logic; purely descriptive. */
    stack?: string;
    baseUrl: string;
    /** e.g. `/th` prepended to each catalog `livePath` when comparing. */
    localePrefix?: string;
    /** JSON file listing all public routes for surplus audit. */
    routesFile?: string;
  };
  outputDir: string;
  viewports?: Array<{ name: string; width: number; height: number }>;
  catalog?: { maxStates?: number };
}

export interface CanvasExportDiscovery {
  entryPath: string;
  entrySha256: string;
  defaultScreenEnum: string[];
  scIfConditionNames: string[];
  navigationHandlers: Record<string, string>;
}

export interface ScreenDefinitionFile {
  schemaVersion: 1;
  screens: Array<{
    slug: string;
    label: string;
    sourceScreen: string;
    sourceState: Record<string, boolean>;
    livePath: string;
    referenceSubdir: string;
    rootLocator: { kind: "body" | "auth-root" | "selector"; selector?: string };
    textMustacheFallbacks?: Record<string, string>;
    neutralizers?: string[];
    thresholds?: { ssim?: number; viewports?: string[] };
    buildable: boolean;
    status: "in-scope" | "excluded" | "unbuildable-todo";
    provenance?: string;
  }>;
  excluded?: Array<{ pattern: string; reason: string }>;
}

export interface CatalogScreen {
  slug: string;
  label?: string;
  designPath: string;
  livePath: string;
  rootSelector?: string;
  buildable: boolean;
  status: "in-scope" | "excluded" | "unbuildable-todo";
  thresholds?: { ssim?: number; viewports?: string[] };
  neutralizers?: string[];
  provenance?: string;
  adapterMeta?: Record<string, unknown>;
}

export interface CatalogDocument {
  schemaVersion: 2;
  closedWorld: true;
  adapter: AdapterId;
  source: {
    entry: string;
    sha256: string;
    discoveredAt?: string;
  };
  discovery?: {
    defaultScreenEnum: string[];
    scIfConditionNames: string[];
    navigationHandlers: Record<string, string>;
  };
  screens: CatalogScreen[];
  excluded?: ScreenDefinitionFile["excluded"];
}
