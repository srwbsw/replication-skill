import type { Page } from "playwright";
import { CURATED_STYLE_PROPERTIES } from "./style-properties.js";

export { CURATED_STYLE_PROPERTIES } from "./style-properties.js";

export interface ExtractedNode {
  tag: string;
  textContent: string;
  styles: Record<string, string>;
  children: ExtractedNode[];
}

export async function extractDomTree(page: Page, rootSelector: string): Promise<ExtractedNode> {
  const props = [...CURATED_STYLE_PROPERTIES];
  return page.evaluate(
    ({ selector, curated }) => {
      function directText(el: Element): string {
        let s = "";
        for (const n of el.childNodes) {
          if (n.nodeType === Node.TEXT_NODE) s += n.textContent ?? "";
        }
        return s.replace(/\s+/g, " ").trim();
      }

      function readStyles(el: Element): Record<string, string> {
        const cs = getComputedStyle(el);
        const out: Record<string, string> = {};
        for (const p of curated) {
          out[p] = String((cs as unknown as Record<string, string>)[p] ?? "");
        }
        return out;
      }

      function walk(el: Element): ExtractedNode {
        const tag = el.tagName.toLowerCase();
        const node: ExtractedNode = {
          tag,
          textContent: directText(el),
          styles: readStyles(el),
          children: [],
        };
        for (const child of el.children) {
          const childTag = child.tagName.toLowerCase();
          if (childTag === "script" || childTag === "style" || childTag === "template") continue;
          if (childTag === "svg") {
            node.children.push({ tag: "svg", textContent: "", styles: readStyles(child), children: [] });
            continue;
          }
          node.children.push(walk(child));
        }
        return node;
      }

      async function run(): Promise<ExtractedNode> {
        if (document.fonts?.ready) await document.fonts.ready;
        const root = document.querySelector(selector);
        if (!root) throw new Error(`Root not found: ${selector}`);
        return walk(root);
      }
      return run();
    },
    { selector: rootSelector, curated: props },
  );
}

export function rootSelectorForScreen(screen: { rootSelector?: string }): string {
  return screen.rootSelector ?? "body";
}
