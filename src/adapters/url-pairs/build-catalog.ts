import fs from "node:fs";
import path from "node:path";
import Ajv2020Import from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { CatalogDocument, CatalogScreen, ReplicationConfig } from "../types.js";
import { sha256File } from "../../core/hash.js";
import { packageRoot } from "../../paths.js";

const Ajv2020 = Ajv2020Import as unknown as new (opts?: object) => {
  compile(schema: object): ValidateFunction;
};
const ajv = new Ajv2020({ allErrors: true, strict: false });

let cachedValidator: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!cachedValidator) {
    const schemaFile = path.join(packageRoot(), "schemas", "url-pairs-input.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaFile, "utf8")) as Record<string, unknown>;
    delete schema.$schema;
    delete schema.$id;
    cachedValidator = ajv.compile(schema);
  }
  return cachedValidator;
}

/** The raw, on-disk shape of one url-pairs entry (config.source.entry file). */
interface UrlPairsEntry {
  slug: string;
  designPath: string;
  livePath: string;
  label?: string;
  rootSelector?: string;
  status?: "in-scope" | "excluded" | "unbuildable-todo";
  buildable?: boolean;
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors?.length) return ["Unknown schema validation error"];
  return errors.map((e) => {
    const params = e.params as Record<string, unknown> | undefined;
    let extra = "";
    if (params && typeof params.missingProperty === "string") {
      extra = ` (missing: ${params.missingProperty})`;
    } else if (params && typeof params.additionalProperty === "string") {
      extra = ` (unexpected: ${params.additionalProperty})`;
    }
    return `${e.instancePath || "/"} ${e.message ?? "invalid"}${extra}`;
  });
}

export function buildUrlPairsCatalog(
  cwd: string,
  config: ReplicationConfig,
): { catalog: CatalogDocument; warnings: string[] } {
  const entryPath = path.resolve(cwd, config.source.entry);
  if (!fs.existsSync(entryPath)) {
    throw new Error(`url-pairs entry file not found: ${entryPath}`);
  }

  const raw = fs.readFileSync(entryPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`url-pairs entry file is not valid JSON: ${entryPath} (${reason})`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `url-pairs entry file must contain a JSON array of {slug, designPath, livePath} entries, got ${typeof parsed}: ${entryPath}`,
    );
  }

  const validate = getValidator();
  if (!validate(parsed)) {
    const errors = formatValidationErrors(validate.errors);
    throw new Error(`url-pairs entry file failed validation: ${entryPath}\n${errors.join("\n")}`);
  }

  const entries = parsed as UrlPairsEntry[];

  const slugs = entries.map((e) => e.slug);
  const dupSlugs = [...new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i))];
  if (dupSlugs.length > 0) {
    throw new Error(`duplicate slugs in url-pairs entry file: ${dupSlugs.join(", ")} (${entryPath})`);
  }

  const screens: CatalogScreen[] = entries.map((e) => {
    const screen: CatalogScreen = {
      slug: e.slug,
      designPath: e.designPath,
      livePath: e.livePath,
      buildable: e.buildable ?? true,
      status: e.status ?? "in-scope",
    };
    if (e.label !== undefined) screen.label = e.label;
    if (e.rootSelector !== undefined) screen.rootSelector = e.rootSelector;
    return screen;
  });

  const catalog: CatalogDocument = {
    schemaVersion: 2,
    closedWorld: true,
    adapter: "url-pairs",
    source: {
      entry: config.source.entry,
      sha256: sha256File(entryPath),
    },
    screens,
  };

  return { catalog, warnings: [] };
}
