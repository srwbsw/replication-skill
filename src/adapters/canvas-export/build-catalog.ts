import fs from "node:fs";
import path from "node:path";
import type {
  CatalogDocument,
  CatalogScreen,
  ReplicationConfig,
  ScreenDefinitionFile,
} from "../types.js";
import { assertDiscoveryCoversDefinitions, discoverCanvasExport } from "./discover.js";

/** Resolve the legacy rootLocator.kind into a flat rootSelector string, once, at build time. */
function resolveRootSelector(rootLocator: {
  kind: "body" | "auth-root" | "selector";
  selector?: string;
}): string {
  switch (rootLocator.kind) {
    case "auth-root":
      return "[data-design-parity-auth-root]";
    case "selector":
      return rootLocator.selector ?? "body";
    default:
      return "body";
  }
}

export function buildCanvasExportCatalog(
  cwd: string,
  config: ReplicationConfig,
): { catalog: CatalogDocument; warnings: string[] } {
  const entryPath = path.resolve(cwd, config.source.entry);
  const discovery = discoverCanvasExport(entryPath);

  if (!config.source.screenDefinitions) {
    throw new Error(
      "canvas-export catalog requires source.screenDefinitions (curated slug/state manifest). Automatic state expansion is planned later.",
    );
  }
  const defsPath = path.resolve(cwd, config.source.screenDefinitions);
  if (!fs.existsSync(defsPath)) {
    throw new Error(`screenDefinitions not found: ${defsPath}`);
  }
  const defs = JSON.parse(fs.readFileSync(defsPath, "utf8")) as ScreenDefinitionFile;
  if (defs.schemaVersion !== 1 || !Array.isArray(defs.screens)) {
    throw new Error("screenDefinitions must be { schemaVersion: 1, screens: [...] }");
  }

  const coverageIssues = assertDiscoveryCoversDefinitions(discovery, defs.screens);
  const warnings: string[] = [];
  if (coverageIssues.length > 0) {
    warnings.push(...coverageIssues);
  }

  const slugs = defs.screens.map((s) => s.slug);
  const dup = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dup.length > 0) {
    throw new Error(`duplicate slugs in screenDefinitions: ${[...new Set(dup)].join(", ")}`);
  }

  const screens: CatalogScreen[] = defs.screens.map((s) => {
    const adapterMeta: Record<string, unknown> = {
      sourceScreen: s.sourceScreen,
      sourceState: s.sourceState,
    };
    if (s.textMustacheFallbacks !== undefined) {
      adapterMeta.textMustacheFallbacks = s.textMustacheFallbacks;
    }

    const screen: CatalogScreen = {
      slug: s.slug,
      label: s.label,
      designPath: s.referenceSubdir,
      livePath: s.livePath,
      rootSelector: resolveRootSelector(s.rootLocator),
      buildable: s.buildable,
      status: s.status,
      adapterMeta,
    };
    if (s.thresholds !== undefined) screen.thresholds = s.thresholds;
    if (s.neutralizers !== undefined) screen.neutralizers = s.neutralizers;
    if (s.provenance !== undefined) screen.provenance = s.provenance;
    return screen;
  });

  const catalog: CatalogDocument = {
    schemaVersion: 2,
    closedWorld: true,
    adapter: "canvas-export",
    source: {
      entry: config.source.entry,
      sha256: discovery.entrySha256,
    },
    discovery: {
      defaultScreenEnum: discovery.defaultScreenEnum,
      scIfConditionNames: discovery.scIfConditionNames,
      navigationHandlers: discovery.navigationHandlers,
    },
    screens,
    excluded: defs.excluded,
  };

  return { catalog, warnings };
}
