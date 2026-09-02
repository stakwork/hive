/**
 * The single-file HTML document for one run's trace.
 *
 * Opens from file:// with zero network calls: the purged Tailwind bundle
 * (cascade-offline.css) is inlined as <style>, the export payload as an
 * inline JSON <script>, and the esbuild-bundled React page
 * (cascade-offline.js — React + Radix + the real CascadeTrace component) as
 * an inline <script>. Both generated files are gitignored build artifacts
 * produced by `npm run build:offline` (wired as prebuild/predev).
 *
 * Security invariants mirror the run report export (offline-html.ts there):
 *   - escapeForInlineScript on the payload so `</script>`, U+2028 and U+2029
 *     cannot break out of the inline tag.
 *   - A strict CSP meta tag: no connect-src, no external scripts/styles/fonts.
 *   - Every string in the payload reaches the DOM through React text nodes —
 *     the page never uses an HTML sink.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { escapeForInlineScript } from "@/lib/run-report/export/json-escape";
import type { CascadeExportPayload } from "./payload";

// ── Generated artifacts ───────────────────────────────────────────────────────

const cache = new Map<string, string>();

/**
 * Reads a generated, gitignored artifact next to this file, once. A missing
 * artifact is logged loudly (the export still returns a document — unstyled
 * or inert — rather than throwing) so the failure is visible, not silent.
 */
function readGenerated(name: string, buildHint: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const path = join(__dirname, name);
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch (err) {
    console.warn(
      `[cascade-offline-html] Failed to read generated ${name} at "${path}". ` +
        `Run \`${buildHint}\` (wired as prebuild/predev) to generate it.`,
      err,
    );
  }
  cache.set(name, content);
  return content;
}

export function getCascadeOfflineCss(): string {
  return readGenerated("cascade-offline.css", "npm run build:offline-css");
}

/**
 * The bundle, made safe to sit inside an inline <script>: a literal
 * `</script` anywhere in the minified code (a string, a regex) would end the
 * tag early. `<\/script` is the same value in both JS strings and regexes.
 */
export function getCascadeOfflineBundle(): string {
  return readGenerated("cascade-offline.js", "npm run build:offline-bundle").replace(
    /<\/script/gi,
    "<\\/script",
  );
}

/** Test seam: forget cached artifacts so a rebuilt file is re-read. */
export function resetCascadeOfflineCache(): void {
  cache.clear();
}

// ── Document ──────────────────────────────────────────────────────────────────

export function sanitizeTitle(title: string): string {
  return (
    title
      .replace(/[\r\n"]/g, "")
      .replace(/[\x00-\x1F\x7F\x80-\x9F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .trim() || "Run trace"
  );
}

/**
 * Assemble the self-contained document. The payload is embedded verbatim
 * (escaped for the inline tag); the bundle reads it from
 * `window.__CASCADE_EXPORT__` and mounts the page.
 */
export function assembleCascadeOfflineHtml(
  payload: CascadeExportPayload,
  title: string,
): string {
  const escapedJson = escapeForInlineScript(payload);
  const css = getCascadeOfflineCss();
  const bundle = getCascadeOfflineBundle();
  const safeTitle = sanitizeTitle(title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none';" />
<title>${safeTitle}</title>
<style>
${css}
</style>
</head>
<body>
<div id="cascade-root"></div>
<script>
window.__CASCADE_EXPORT__ = ${escapedJson};
</script>
<script>
${bundle}
</script>
</body>
</html>`;
}
