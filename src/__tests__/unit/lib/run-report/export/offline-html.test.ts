/**
 * Tests for assembleOfflineHtml.
 *
 * Acceptance criteria covered:
 * - index.html contains no external <script src=>, <link href=>, fetch(, XHR, WebSocket, etc.
 * - window.__OFFLINE_REPORT__ is embedded with < → \u003c escaping (never breaks out of <script>)
 * - U+2028 and U+2029 are escaped in the inline JSON
 * - bundle.json is valid JSON with the projection data (no reportUrl)
 * - viewer.js is inlined
 * - CSP meta tag is present
 * - Title is sanitized (CR/LF/quote-injection → clean header)
 *
 * getOfflineCss() reads the build-time-generated, gitignored
 * offline-report.css (see src/lib/run-report/export/offline.entry.css +
 * scripts/build-offline-css.mjs). The unit-test CI job runs `vitest run`
 * directly — it never runs `npm run build`/`prebuild` — so that file will not
 * exist unless we generate it ourselves here first.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { join } from "path";
import { assembleOfflineHtml } from "@/lib/run-report/export/offline-html";

beforeAll(() => {
  execFileSync("node", [join(process.cwd(), "scripts/build-offline-css.mjs")], {
    stdio: "pipe",
  });
}, 60_000);

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractInlineScripts(html: string): string[] {
  const scripts: string[] = [];
  const re = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    // Only collect inline scripts (no src= attribute)
    const tag = m[0];
    if (!/\bsrc\s*=/.test(tag)) {
      scripts.push(m[1]);
    }
  }
  return scripts;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("assembleOfflineHtml", () => {
  describe("Self-containment — no external resources", () => {
    it("contains no <script src=> constructs", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test Report");
      expect(indexHtml).not.toMatch(/<script\s[^>]*src\s*=/i);
    });

    it("contains no <link href=> constructs", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test Report");
      expect(indexHtml).not.toMatch(/<link\s[^>]*href\s*=/i);
    });

    it("contains no @import in style blocks", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test Report");
      expect(indexHtml).not.toMatch(/@import\s/);
    });

    it("contains no url(http in style blocks", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test Report");
      expect(indexHtml).not.toMatch(/url\s*\(\s*https?:/i);
    });

    it("inline scripts contain no fetch( calls", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test Report");
      const inlineScripts = extractInlineScripts(indexHtml);
      for (const script of inlineScripts) {
        expect(script).not.toMatch(/\bfetch\s*\(/);
      }
    });

    it("inline scripts contain no XMLHttpRequest", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test Report");
      const inlineScripts = extractInlineScripts(indexHtml);
      for (const script of inlineScripts) {
        expect(script).not.toMatch(/\bXMLHttpRequest\b/);
      }
    });

    it("inline scripts contain no WebSocket", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test Report");
      const inlineScripts = extractInlineScripts(indexHtml);
      for (const script of inlineScripts) {
        expect(script).not.toMatch(/\bWebSocket\b/);
      }
    });

    it("inline scripts contain no EventSource", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test Report");
      const inlineScripts = extractInlineScripts(indexHtml);
      for (const script of inlineScripts) {
        expect(script).not.toMatch(/\bEventSource\b/);
      }
    });

    it("inline scripts contain no sendBeacon", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test Report");
      const inlineScripts = extractInlineScripts(indexHtml);
      for (const script of inlineScripts) {
        expect(script).not.toMatch(/\bsendBeacon\b/);
      }
    });
  });

  describe("__OFFLINE_REPORT__ inline JSON escaping", () => {
    it("< in projection data is escaped to \\u003c", () => {
      const projection = { foo: "</script><script>alert(1)</script>" };
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", projection, "Test");
      // The raw < should be escaped
      expect(indexHtml).toContain("\\u003c");
      // The unescaped sequence should not appear inside any script block
      const inlineScripts = extractInlineScripts(indexHtml);
      for (const script of inlineScripts) {
        if (script.includes("__OFFLINE_REPORT__")) {
          expect(script).not.toContain("</script>");
        }
      }
    });

    it("U+2028 LINE SEPARATOR in projection data is escaped", () => {
      const projection = { text: `before\u2028after` };
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", projection, "Test");
      // Raw U+2028 should not appear inside inline scripts
      const inlineScripts = extractInlineScripts(indexHtml);
      for (const script of inlineScripts) {
        if (script.includes("__OFFLINE_REPORT__")) {
          expect(script).not.toContain("\u2028");
          expect(script).toContain("\\u2028");
        }
      }
    });

    it("U+2029 PARAGRAPH SEPARATOR in projection data is escaped", () => {
      const projection = { text: `before\u2029after` };
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", projection, "Test");
      const inlineScripts = extractInlineScripts(indexHtml);
      for (const script of inlineScripts) {
        if (script.includes("__OFFLINE_REPORT__")) {
          expect(script).not.toContain("\u2029");
          expect(script).toContain("\\u2029");
        }
      }
    });

    it("projection is embedded as window.__OFFLINE_REPORT__", () => {
      const projection = { score: 7, maxScore: 10 };
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", projection, "Test");
      expect(indexHtml).toContain("window.__OFFLINE_REPORT__");
      expect(indexHtml).toContain('"score":7');
    });
  });

  describe("bundle.json", () => {
    it("is valid JSON", () => {
      const { bundleJson } = assembleOfflineHtml("<div>test</div>", { foo: "bar" }, "Test");
      expect(() => JSON.parse(bundleJson)).not.toThrow();
    });

    it("contains the projection data", () => {
      const projection = { rubricRows: [{ id: "r1", title: "Criterion 1" }] };
      const { bundleJson } = assembleOfflineHtml("<div>test</div>", projection, "Test");
      const parsed = JSON.parse(bundleJson) as { projection: typeof projection };
      expect(parsed.projection).toEqual(projection);
    });

    it("does not contain reportUrl", () => {
      const projection = { someField: "value" };
      const { bundleJson } = assembleOfflineHtml("<div>test</div>", projection, "Test");
      expect(bundleJson).not.toContain("reportUrl");
    });

    it("includes exportedAt timestamp", () => {
      const { bundleJson } = assembleOfflineHtml("<div>test</div>", null, "Test");
      const parsed = JSON.parse(bundleJson) as { exportedAt: string };
      expect(parsed.exportedAt).toBeDefined();
      expect(() => new Date(parsed.exportedAt)).not.toThrow();
    });
  });

  describe("HTML document structure", () => {
    it("starts with <!DOCTYPE html>", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test");
      expect(indexHtml.trimStart()).toMatch(/^<!DOCTYPE html>/i);
    });

    it("includes a <style> block with the generated offline report CSS", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test");
      expect(indexHtml).toMatch(/<style>/i);
      // The CSS is now sourced from the build-time-generated
      // offline-report.css (see offline.entry.css / scripts/build-offline-css.mjs)
      // rather than a hand-written literal color string, so we assert on the
      // structural presence of Tailwind's `.bg-black` utility (used by the
      // dark document body) rather than a specific hex/HSL literal.
      const styleMatch = indexHtml.match(/<style>([\s\S]*?)<\/style>/i);
      expect(styleMatch).not.toBeNull();
      const styleContent = styleMatch?.[1] ?? "";
      expect(styleContent.length).toBeGreaterThan(0);
      expect(styleContent).toContain(".bg-black");
    });

    it("includes a CSP meta tag", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test");
      expect(indexHtml).toContain("Content-Security-Policy");
      expect(indexHtml).toContain("default-src 'none'");
    });

    it("includes the viewer.js enhancement script inline", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test");
      // viewer.js uses IIFE pattern
      expect(indexHtml).toContain("(function");
      expect(indexHtml).toContain("initPeekToggles");
    });

    it("embeds the SSR markup in the body", () => {
      const markup = '<div data-testid="run-report-view">Score: 5/7</div>';
      const { indexHtml } = assembleOfflineHtml(markup, null, "Test");
      expect(indexHtml).toContain("run-report-view");
      expect(indexHtml).toContain("Score: 5/7");
    });

    it("includes the title in the <title> tag", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "My Task Report");
      expect(indexHtml).toMatch(/<title>[^<]*My Task Report[^<]*<\/title>/);
    });

    it("lang=en attribute on html element", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Test");
      expect(indexHtml).toContain('lang="en"');
    });
  });

  describe("Title sanitization", () => {
    it("strips CR and LF from the title (no header injection)", () => {
      const maliciousTitle = "Report\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script>";
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, maliciousTitle);
      // The title should be sanitized — no raw CR/LF in the output title tag
      const titleMatch = indexHtml.match(/<title>([^<]*)<\/title>/);
      expect(titleMatch).not.toBeNull();
      if (titleMatch) {
        expect(titleMatch[1]).not.toContain("\r");
        expect(titleMatch[1]).not.toContain("\n");
      }
    });

    it("strips double quotes from the title", () => {
      const titleWithQuotes = 'Task "with quotes"';
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, titleWithQuotes);
      const titleMatch = indexHtml.match(/<title>([^<]*)<\/title>/);
      if (titleMatch) {
        expect(titleMatch[1]).not.toContain('"');
      }
    });

    it("handles non-ASCII titles in the document title", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "Rapport légal — 法律");
      // Should not throw; title should be present in sanitized form
      expect(indexHtml).toContain("<title>");
    });

    it("falls back to 'Offline Report' when title is empty after sanitization", () => {
      const { indexHtml } = assembleOfflineHtml("<div>test</div>", null, "\r\n\t");
      expect(indexHtml).toContain("Offline Report");
    });
  });
});
