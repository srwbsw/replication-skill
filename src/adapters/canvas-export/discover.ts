import fs from "node:fs";
import { sha256File } from "../../core/hash.js";
import type { CanvasExportDiscovery } from "../types.js";

const SC_IF_ATTR_RE = /sc-if="([^"]+)"/g;
const SC_IF_TAG_RE = /<sc-if\s+value="\{\{\s*([^}\s]+)\s*\}\}"/g;
const GO_HANDLER_RE = /(\bgo[A-Z][a-zA-Z0-9]*)\s*:\s*\(\)\s*=>\s*this\.go\(\s*['"]([^'"]+)['"]\s*\)/g;
const GO_HANDLER_SETSTATE_RE =
  /(\bgo[A-Z][a-zA-Z0-9]*)\s*:\s*\(\)\s*=>\s*\{[^}]*this\.go\(\s*['"]([^'"]+)['"]\s*\)/g;

export function discoverCanvasExport(entryPath: string): CanvasExportDiscovery {
  if (!fs.existsSync(entryPath)) {
    throw new Error(`canvas-export entry not found: ${entryPath}`);
  }
  const source = fs.readFileSync(entryPath, "utf8");
  const defaultScreenEnum = extractDefaultScreenEnum(source);
  const scIfConditionNames = extractScIfNames(source);
  const navigationHandlers = extractNavigationHandlers(source);

  return {
    entryPath,
    entrySha256: sha256File(entryPath),
    defaultScreenEnum,
    scIfConditionNames,
    navigationHandlers,
  };
}

function extractDefaultScreenEnum(source: string): string[] {
  const propsMatch = source.match(/data-props="([^"]+)"/);
  if (!propsMatch) {
    return [];
  }
  const decoded = propsMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  try {
    const props = JSON.parse(decoded) as {
      defaultScreen?: { options?: string[] };
    };
    const options = props.defaultScreen?.options;
    if (Array.isArray(options) && options.length > 0) {
      return [...options].sort();
    }
  } catch {
    // fall through
  }
  const enumMatch = source.match(/"defaultScreen"[^[]*\[([^\]]+)\]/);
  if (enumMatch) {
    const raw = enumMatch[1];
    const values = [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return [...new Set(values)].sort();
  }
  return [];
}

function extractScIfNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(SC_IF_ATTR_RE)) {
    const expr = match[1].trim();
    if (!expr || expr === "true" || expr === "false") continue;
    const token = expr.split(/\s+/)[0]?.replace(/^!/, "");
    if (token && /^[a-zA-Z][\w.]*$/.test(token)) {
      names.add(token);
    }
  }
  for (const match of source.matchAll(SC_IF_TAG_RE)) {
    const token = match[1].trim();
    if (token && /^[a-zA-Z][\w.]*$/.test(token)) {
      names.add(token);
    }
  }
  return [...names].sort();
}

function extractNavigationHandlers(source: string): Record<string, string> {
  const handlers: Record<string, string> = {};
  for (const re of [GO_HANDLER_RE, GO_HANDLER_SETSTATE_RE]) {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) {
      handlers[match[1]] = match[2];
    }
  }
  return Object.fromEntries(Object.entries(handlers).sort(([a], [b]) => a.localeCompare(b)));
}

export function assertDiscoveryCoversDefinitions(
  discovery: CanvasExportDiscovery,
  definitions: { sourceScreen: string }[],
): string[] {
  const issues: string[] = [];
  const enumSet = new Set(discovery.defaultScreenEnum);
  for (const def of definitions) {
    if (!enumSet.has(def.sourceScreen)) {
      issues.push(
        `screen definition sourceScreen "${def.sourceScreen}" is not in defaultScreen enum [${discovery.defaultScreenEnum.join(", ")}]`,
      );
    }
  }
  return issues;
}
