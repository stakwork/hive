/**
 * assembleCascadeOfflineHtml — the single-file trace document.
 *
 * - Self-contained: no external <script src>, <link href>, no network APIs
 *   reachable (a strict CSP meta is present).
 * - The payload is embedded with `<`, U+2028 and U+2029 escaped so hostile
 *   graph content can never break out of the inline <script>.
 * - Both generated artifacts (CSS + JS bundle) are inlined.
 * - The title is sanitized.
 *
 * The artifacts are gitignored build outputs; the unit-test job never runs
 * prebuild, so they are built here first.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { join } from "path";
import { renameSync, existsSync } from "fs";
import {
  assembleCascadeOfflineHtml,
  CascadeBundleMissingError,
  resetCascadeOfflineCache,
  sanitizeTitle,
} from "@/lib/legal-cascade/export/offline-html";
import type { CascadeExportPayload } from "@/lib/legal-cascade/export/payload";
import { assembleRunCascade } from "@/lib/legal-cascade/derive";
import { buildMockSessionMap, buildMockTurnsBySession } from "@/lib/legal-cascade/fixtures";

beforeAll(() => {
  execFileSync("node", [join(process.cwd(), "scripts/build-offline-css.mjs")], { stdio: "pipe" });
  execFileSync("node", [join(process.cwd(), "scripts/build-cascade-bundle.mjs")], { stdio: "pipe" });
  resetCascadeOfflineCache();
}, 120_000);

function payload(overrides: Partial<CascadeExportPayload> = {}): CascadeExportPayload {
  return {
    model: assembleRunCascade(
      [...buildMockSessionMap("147813394").values()],
      buildMockTurnsBySession(),
    ),
    peeks: {
      "onto-1": {
        state: "done",
        payload: { ref_id: "onto-1", name: "wfa-ontology", properties: { docs: "Doctrine." } },
      },
    },
    meta: {
      runId: "run-1",
      identifier: "147813394",
      exportedAt: "2026-09-02T12:00:00.000Z",
      skippedPeeks: [],
    },
    ...overrides,
  };
}

function inlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script(\s[^>]*)?>([^]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  // Judge the opening tag only — the bundle body itself contains "src=".
  while ((m = re.exec(html)) !== null) if (!/\bsrc\s*=/.test(m[1] ?? "")) out.push(m[2]);
  return out;
}

describe("assembleCascadeOfflineHtml", () => {
  it("is self-contained: no external scripts, stylesheets, or fonts", () => {
    const html = assembleCascadeOfflineHtml(payload(), "Run trace");
    expect(html).not.toMatch(/<script\s[^>]*src\s*=/i);
    expect(html).not.toMatch(/<link\s[^>]*href\s*=/i);
    expect(html).not.toMatch(/@import\s+url\(/i);
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
    expect(html).not.toMatch(/connect-src/);
  });

  it("inlines the generated CSS bundle and the React bundle", () => {
    const html = assembleCascadeOfflineHtml(payload(), "Run trace");
    // Tailwind's banner marks the compiled stylesheet.
    expect(html).toMatch(/<style>[^]*tailwindcss[^]*<\/style>/i);
    const scripts = inlineScripts(html);
    expect(scripts.length).toBe(2);
    // The bundle mounts into the root the document provides.
    expect(html).toContain('<div id="cascade-root"></div>');
    expect(scripts[1]).toContain("cascade-root");
    expect(scripts[1].length).toBeGreaterThan(100_000);
    // Nothing inside either inline script can close the tag early.
    for (const s of scripts) expect(s).not.toMatch(/<\/script/i);
  });

  it("embeds the payload as window.__CASCADE_EXPORT__, escaped for the inline tag", () => {
    const hostile = payload({
      peeks: {
        "onto-1": {
          state: "done",
          payload: { docs: "</script><script>alert(1)</script>\u2028\u2029" },
        },
      },
    });
    const html = assembleCascadeOfflineHtml(hostile, "Run trace");
    const [data] = inlineScripts(html);
    expect(data).toMatch(/window\.__CASCADE_EXPORT__ = \{/);
    expect(data).not.toContain("</script>");
    expect(data).toContain("\\u003c/script>");
    expect(data).not.toContain("\u2028");
    expect(data).not.toContain("\u2029");
    expect(data).toContain("\\u2028");

    // Round-trips to the same object.
    const json = data.replace(/^\s*window\.__CASCADE_EXPORT__ = /, "").replace(/;\s*$/, "");
    const parsed = JSON.parse(json) as CascadeExportPayload;
    expect(parsed.meta.runId).toBe("run-1");
    expect(parsed.model.summary.agents).toBe(2);
    expect(parsed.peeks["onto-1"]).toEqual(hostile.peeks["onto-1"]);
  });

  it("refuses to build a document when the bundle is missing, and recovers once it exists", () => {
    const bundlePath = join(process.cwd(), "src/lib/legal-cascade/export/cascade-offline.js");
    const parked = `${bundlePath}.parked`;
    renameSync(bundlePath, parked);
    resetCascadeOfflineCache();
    try {
      expect(() => assembleCascadeOfflineHtml(payload(), "Run trace")).toThrow(
        CascadeBundleMissingError,
      );
    } finally {
      renameSync(parked, bundlePath);
    }
    expect(existsSync(bundlePath)).toBe(true);
    // Not cached as empty — the rebuilt artifact is picked up without a restart.
    expect(assembleCascadeOfflineHtml(payload(), "Run trace")).toContain("cascade-root");
  });

  it("sanitizes the title", () => {
    const html = assembleCascadeOfflineHtml(payload(), 'Run <b>trace</b>\r\n"x" & y');
    expect(html).toContain("<title>Run &lt;b&gt;trace&lt;/b&gt;x &amp; y</title>");
    expect(sanitizeTitle("   ")).toBe("Run trace");
  });
});
