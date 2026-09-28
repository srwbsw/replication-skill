import { createHash } from "node:crypto";
import fs from "node:fs";
import { canonicalStringify } from "./canonical-json.js";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return sha256Hex(buf);
}

/** Strip volatile fields before hashing catalog documents. */
export function catalogForHash(catalog: unknown): unknown {
  const clone = structuredClone(catalog) as {
    source?: { discoveredAt?: string };
  };
  if (clone.source?.discoveredAt) {
    delete clone.source.discoveredAt;
  }
  return clone;
}

export function hashCatalogDocument(catalog: unknown): string {
  return sha256Hex(canonicalStringify(catalogForHash(catalog)));
}
