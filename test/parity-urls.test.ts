import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  catalogTargetPathKeys,
  designUrlForScreen,
  normalizePathKey,
  targetUrlForScreen,
} from "../src/parity/urls.js";

describe("parity urls", () => {
  it("maps design paths to design URLs", () => {
    const home = {
      slug: "home",
      designPath: ".",
      livePath: "/",
    } as const;
    assert.equal(designUrlForScreen("http://127.0.0.1:4320", home), "http://127.0.0.1:4320/");
    const auth = { ...home, slug: "auth-login", designPath: "screens/auth-login" };
    assert.equal(
      designUrlForScreen("http://127.0.0.1:4320/", auth),
      "http://127.0.0.1:4320/screens/auth-login/",
    );
  });

  it("applies locale prefix on target", () => {
    assert.equal(
      targetUrlForScreen("http://localhost:3000", "/signup?design-parity=1", "/th"),
      "http://localhost:3000/th/signup?design-parity=1",
    );
  });

  it("computes surplus against catalog paths", () => {
    const keys = catalogTargetPathKeys({
      schemaVersion: 2,
      closedWorld: true,
      adapter: "canvas-export",
      source: { entry: "x", sha256: "a".repeat(64) },
      screens: [
        {
          slug: "home",
          label: "h",
          livePath: "/",
          designPath: ".",
          buildable: true,
          status: "in-scope",
        },
        {
          slug: "demo",
          label: "d",
          livePath: "/demo",
          designPath: "screens/demo",
          buildable: true,
          status: "in-scope",
        },
      ],
    });
    assert.deepEqual([...keys].sort(), ["/", "/demo"]);
    assert.equal(normalizePathKey("/foo/"), "/foo");
  });

  // ===========================================================================
  // Bug 2 fix: designUrlForScreen/joinUrl must not force a trailing slash onto a
  // file-like designPath (adapter-agnostic now: url-pairs/site-crawl can hand in
  // paths like "screens/login.html", not just canvas-export's always-directory-
  // shaped "screens/auth-login").
  //
  // Case list (written before any test code — see task PROCESS):
  //
  // Bug2-H1 (regression) | every EXISTING designUrlForScreen assertion above (the "." root case
  //   and the extension-less "screens/auth-login" case) is left completely untouched in this file
  //   and must keep passing byte-identical — verified by NOT editing those two assertions at all,
  //   only by running the full suite green.
  // Bug2-H2 (happy, the fix) | a file-like designPath ("screens/login.html") gets NO trailing
  //   slash appended: output is "<base>/screens/login.html", not ".../login.html/".
  // Bug2-E1 (edge/boundary) | a "." in an EARLIER segment only ("v1.2/screens/login") must not
  //   false-positive the file-like check — only the LAST segment's shape matters, so this still
  //   gets directory-style trailing-slash treatment.
  // Bug2-E2 (edge/boundary, judgment call) | a dot-PREFIXED last segment with no real extension
  //   ("screens/.hidden") is treated as directory-style (trailing slash kept), NOT file-like.
  //   Justification: the heuristic requires text before the dot (a real "name.ext" filename stem).
  //   A segment that is *only* a dot prefix (hidden-file/config-style, e.g. ".hidden",
  //   ".well-known") has no stem before its dot, so it doesn't read as a file extension — it keeps
  //   the pre-fix directory/trailing-slash behavior, matching canvas-export's own extension-less
  //   shape most closely of the two options.
  // Bug2-M1 (malformed/adversarial, unicode) | unicode in an EARLIER segment ("café/menu", last
  //   segment "menu" has no dot) does not crash and is not a false positive — still directory-style.
  // Bug2-M2 (malformed/adversarial, unicode) | unicode WITH a real extension in the last segment
  //   ("docs/café.pdf") does not crash and correctly detects file-like (no trailing slash) — the
  //   heuristic must not false-NEGATIVE on non-ASCII filename stems either.

  it("Bug2-H2 | a file-like designPath (has a '.' in its last segment) gets no trailing slash appended", () => {
    const screen = {
      slug: "login-html",
      designPath: "screens/login.html",
      livePath: "/login",
    } as const;
    assert.equal(
      designUrlForScreen("http://127.0.0.1:4320", screen),
      "http://127.0.0.1:4320/screens/login.html",
    );
  });

  it("Bug2-E1 | a '.' in an earlier segment only (not the last) still gets directory-style trailing slash", () => {
    const screen = {
      slug: "versioned-login",
      designPath: "v1.2/screens/login",
      livePath: "/login",
    } as const;
    assert.equal(
      designUrlForScreen("http://127.0.0.1:4320", screen),
      "http://127.0.0.1:4320/v1.2/screens/login/",
    );
  });

  it("Bug2-E2 | a dot-prefixed last segment with no real extension ('.hidden') stays directory-style", () => {
    const screen = {
      slug: "hidden",
      designPath: "screens/.hidden",
      livePath: "/hidden",
    } as const;
    assert.equal(
      designUrlForScreen("http://127.0.0.1:4320", screen),
      "http://127.0.0.1:4320/screens/.hidden/",
    );
  });

  it("Bug2-M1 | unicode in an earlier (non-last) segment does not crash and is not a false-positive file match", () => {
    const screen = {
      slug: "cafe-menu",
      designPath: "café/menu",
      livePath: "/menu",
    } as const;
    assert.equal(
      designUrlForScreen("http://127.0.0.1:4320", screen),
      "http://127.0.0.1:4320/café/menu/",
    );
  });

  it("Bug2-M2 | unicode WITH a real extension in the last segment is still correctly detected as file-like", () => {
    const screen = {
      slug: "cafe-pdf",
      designPath: "docs/café.pdf",
      livePath: "/cafe.pdf",
    } as const;
    assert.equal(
      designUrlForScreen("http://127.0.0.1:4320", screen),
      "http://127.0.0.1:4320/docs/café.pdf",
    );
  });
});
