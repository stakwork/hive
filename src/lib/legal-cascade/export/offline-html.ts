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
import { firstExistingPath } from "@/lib/run-report/export/generated-artifact";
import { escapeForInlineScript } from "@/lib/run-report/export/json-escape";
import type { CascadeExportPayload } from "./payload";

// ── Generated artifacts ───────────────────────────────────────────────────────

const cache = new Map<string, string>();

type ArtifactName = "cascade-offline.css" | "cascade-offline.js";

/**
 * Candidate locations per artifact, spelled out as literals at each call so
 * Next's file tracer resolves them to exactly these files (see
 * firstExistingPath for why a parameterised join must not be used).
 */
function artifactPath(name: ArtifactName): string {
  switch (name) {
    case "cascade-offline.css":
      return firstExistingPath(
        join(process.cwd(), "src/lib/legal-cascade/export/cascade-offline.css"),
        join(__dirname, "cascade-offline.css"),
      );
    case "cascade-offline.js":
      return firstExistingPath(
        join(process.cwd(), "src/lib/legal-cascade/export/cascade-offline.js"),
        join(__dirname, "cascade-offline.js"),
      );
  }
}

/** Thrown when the page bundle is missing: a document without it is blank. */
export class CascadeBundleMissingError extends Error {
  constructor(path: string) {
    super(
      `The trace export bundle is not built on this server (looked for ${path}). ` +
        "Run `npm run build:offline-bundle` (wired as prebuild/predev).",
    );
    this.name = "CascadeBundleMissingError";
  }
}

/**
 * Reads a generated, gitignored artifact once. Resolved from the project
 * root (where Next's output file tracing puts it in production) with the
 * source directory as a fallback — never from `__dirname` alone, which
 * points at the compiled chunk inside a server bundle, not at this file.
 */
function readGenerated(name: ArtifactName): { content: string; path: string } {
  const cached = cache.get(name);
  const path = artifactPath(name);
  if (cached !== undefined) return { content: cached, path };
  let content = "";
  try {
    content = readFileSync(path, "utf8");
    cache.set(name, content);
  } catch {
    // Not cached: a later build of the artifact should be picked up.
  }
  return { content, path };
}

/**
 * The stylesheet. A missing bundle is logged loudly but the export still
 * returns a working (unstyled) document.
 */
export function getCascadeOfflineCss(): string {
  const { content, path } = readGenerated("cascade-offline.css");
  if (!content) {
    console.warn(
      `[cascade-offline-html] Failed to read generated cascade-offline.css at "${path}". ` +
        "The export will render unstyled. Run `npm run build:offline-css` (wired as prebuild/predev).",
    );
  }
  return content;
}

/**
 * The bundle, made safe to sit inside an inline <script>: a literal
 * `</script` anywhere in the minified code (a string, a regex) would end the
 * tag early. `<\/script` is the same value in both JS strings and regexes.
 */
export function getCascadeOfflineBundle(): string {
  const { content, path } = readGenerated("cascade-offline.js");
  if (!content) throw new CascadeBundleMissingError(path);
  return content.replace(/<\/script/gi, "<\\/script");
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
