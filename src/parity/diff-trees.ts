import type { ExtractedNode } from "./dom-extract.js";

export interface TreeDiff {
  path: string;
  kind: "tag-mismatch" | "missing-node" | "extra-node" | "text-mismatch" | "style-mismatch";
  expected?: string;
  actual?: string;
  property?: string;
}

const STYLE_TOLERANCE = new Set(["width", "height"]);

function pathSeg(parent: string, index: number, tag: string): string {
  const seg = `${tag}:nth-of-type(${index + 1})`;
  return parent ? `${parent} > ${seg}` : seg;
}

export function diffTrees(
  expected: ExtractedNode,
  actual: ExtractedNode,
  maxDiffs = 40,
): TreeDiff[] {
  const diffs: TreeDiff[] = [];

  function walk(e: ExtractedNode, a: ExtractedNode, p: string): void {
    if (diffs.length >= maxDiffs) return;
    if (e.tag !== a.tag) {
      diffs.push({ path: p, kind: "tag-mismatch", expected: e.tag, actual: a.tag });
      return;
    }
    if (e.textContent !== a.textContent) {
      diffs.push({
        path: p,
        kind: "text-mismatch",
        expected: e.textContent,
        actual: a.textContent,
      });
    }
    for (const key of Object.keys(e.styles)) {
      if (diffs.length >= maxDiffs) break;
      const ev = e.styles[key];
      const av = a.styles[key];
      if (ev === av) continue;
      if (STYLE_TOLERANCE.has(key)) continue;
      diffs.push({
        path: p,
        kind: "style-mismatch",
        property: key,
        expected: ev,
        actual: av,
      });
    }
    const eKids = e.children;
    const aKids = a.children;
    const max = Math.max(eKids.length, aKids.length);
    for (let i = 0; i < max; i++) {
      if (diffs.length >= maxDiffs) break;
      const ec = eKids[i];
      const ac = aKids[i];
      const childPath = pathSeg(p, i, ec?.tag ?? ac?.tag ?? "?");
      if (!ec) {
        diffs.push({ path: childPath, kind: "extra-node", actual: ac.tag });
      } else if (!ac) {
        diffs.push({ path: childPath, kind: "missing-node", expected: ec.tag });
      } else {
        walk(ec, ac, childPath);
      }
    }
  }

  walk(expected, actual, "root");
  return diffs;
}
