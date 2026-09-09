// @vitest-environment jsdom
/**
 * Unit tests for the CSP that `HtmlArtifactFrame` injects into every
 * stored HTML page before framing it.
 *
 * The sandbox is the primary boundary; this policy is the second layer
 * that decides where a sandboxed page may load code from and what it may
 * talk to. These tests pin the policy's shape and prove the meta tag
 * always lands first in the real <head>, whatever the input markup does.
 */
import { describe, test, expect } from "vitest";
import {
  HTML_ARTIFACT_CDN_HOSTS,
  HTML_ARTIFACT_CSP,
  injectHtmlArtifactCsp,
} from "@/lib/utils/html-artifact-csp";

function directives(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name] = values;
  }
  return out;
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function cspMetas(doc: Document): HTMLMetaElement[] {
  return Array.from(
    doc.querySelectorAll<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy" i]'),
  );
}

describe("HTML_ARTIFACT_CSP", () => {
  const d = directives(HTML_ARTIFACT_CSP);

  test("denies everything by default", () => {
    expect(d["default-src"]).toEqual(["'none'"]);
  });

  test("scripts: inline plus the CDN allowlist only", () => {
    expect(d["script-src"]).toEqual(
      expect.arrayContaining(["'unsafe-inline'", ...HTML_ARTIFACT_CDN_HOSTS]),
    );
    for (const v of d["script-src"]) {
      expect(v === "'unsafe-inline'" || v === "'unsafe-eval'" || v.startsWith("https://")).toBe(true);
    }
    expect(d["script-src"]).not.toContain("https:");
    expect(d["script-src"]).not.toContain("*");
  });

  test("runtime fetches are capped to the same CDNs so code can't be pulled around script-src", () => {
    expect(d["connect-src"]).toEqual([...HTML_ARTIFACT_CDN_HOSTS]);
  });

  test("no forms, nested frames, plugins, or <base> rewriting", () => {
    expect(d["form-action"]).toEqual(["'none'"]);
    expect(d["frame-src"]).toEqual(["'none'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'none'"]);
  });

  test("images may load from any https host (accepted one-way channel)", () => {
    expect(d["img-src"]).toContain("https:");
  });

  test("every allowlisted CDN is an https origin with no path or wildcard", () => {
    for (const host of HTML_ARTIFACT_CDN_HOSTS) {
      expect(host).toMatch(/^https:\/\/[a-z0-9.-]+$/);
    }
  });
});

describe("injectHtmlArtifactCsp", () => {
  const EXPECT_META = (doc: Document) => {
    const metas = cspMetas(doc);
    expect(metas.length).toBeGreaterThanOrEqual(1);
    // Ours is the very first child of <head>, so nothing precedes it.
    const first = doc.head.firstElementChild as HTMLMetaElement | null;
    expect(first?.tagName).toBe("META");
    expect(first?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(first?.getAttribute("content")).toBe(HTML_ARTIFACT_CSP);
  };

  test("inserts the meta as the first child of head in a full document", () => {
    const out = injectHtmlArtifactCsp(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>T</title></head><body><h1>hi</h1></body></html>',
    );
    const doc = parse(out);
    EXPECT_META(doc);
    expect(doc.title).toBe("T");
    expect(doc.body.querySelector("h1")?.textContent).toBe("hi");
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  test("creates a head when the page has none", () => {
    const doc = parse(injectHtmlArtifactCsp("<p>just a fragment</p>"));
    EXPECT_META(doc);
    expect(doc.body.textContent).toContain("just a fragment");
  });

  test("lands in the real head even when <head> only appears inside a comment or attribute", () => {
    const html =
      '<!-- <head> decoy --><!DOCTYPE html><html><body data-x="<head>"><script>window.x = 1</script></body></html>';
    const doc = parse(injectHtmlArtifactCsp(html));
    EXPECT_META(doc);
    // The decoy strings are still present, untouched, and not where the meta went.
    expect(doc.body.getAttribute("data-x")).toBe("<head>");
  });

  test("preserves an existing doctype and adds none when absent", () => {
    expect(injectHtmlArtifactCsp("<!DOCTYPE html><html></html>")).toMatch(/^<!DOCTYPE html>/);
    expect(injectHtmlArtifactCsp("<html><body>q</body></html>")).not.toMatch(/^<!DOCTYPE/i);
    const legacy =
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><html></html>';
    expect(injectHtmlArtifactCsp(legacy)).toMatch(
      /^<!DOCTYPE html PUBLIC "-\/\/W3C\/\/DTD XHTML 1\.0 Strict\/\/EN" "http:\/\/www\.w3\.org\/TR\/xhtml1\/DTD\/xhtml1-strict\.dtd">/,
    );
  });

  test("keeps a page's own CSP meta (policies only combine restrictively)", () => {
    const html =
      "<!DOCTYPE html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"img-src 'none'\"></head></html>";
    const doc = parse(injectHtmlArtifactCsp(html));
    const metas = cspMetas(doc);
    expect(metas).toHaveLength(2);
    expect(metas[0].getAttribute("content")).toBe(HTML_ARTIFACT_CSP);
    expect(metas[1].getAttribute("content")).toBe("img-src 'none'");
  });

  test("round-trips script bodies and CDN script tags verbatim", () => {
    const script = 'const a = 1 < 2 && "x" > "y"; document.body.textContent = a ? "yes" : "no";';
    const html = `<!DOCTYPE html><html><head><script src="https://unpkg.com/chart.js"></script></head><body><script>${script}</script></body></html>`;
    const out = injectHtmlArtifactCsp(html);
    expect(out).toContain(script);
    expect(out).toContain('<script src="https://unpkg.com/chart.js"></script>');
  });

  test("is idempotent in effect: re-injecting only prepends another identical meta", () => {
    const once = injectHtmlArtifactCsp("<!DOCTYPE html><html><body>x</body></html>");
    const twice = injectHtmlArtifactCsp(once);
    const metas = cspMetas(parse(twice));
    expect(metas).toHaveLength(2);
    expect(metas.every((m) => m.getAttribute("content") === HTML_ARTIFACT_CSP)).toBe(true);
  });
});
