/**
 * Final offline HTML document assembly.
 *
 * Takes the SSR'd markup from render-offline.tsx and wraps it in a complete
 * HTML document that is fully self-contained (opens from file:// with zero
 * network calls):
 *
 *   - Dark theme CSS inlined as a <style> block (system font stack only,
 *     no @import, no external <link>, no webfont declarations)
 *   - window.__OFFLINE_REPORT__ = <escaped JSON> inlined in a <script> tag
 *   - The enhancement script from viewer.js inlined
 *   - <body> contains only the SSR'd markup — no CDN, no analytics
 *
 * Also emits bundle.json: the same projection data as the inline JSON but
 * unescaped, since it is a standalone file rather than an inline JS expression.
 *
 * Security invariants:
 *   - `reportUrl` / signed S3 URLs MUST NOT appear in any emitted artifact.
 *     The caller is responsible for omitting them from the projection before
 *     passing it here.
 *   - escapeForInlineScript is applied to the JSON embedded in __OFFLINE_REPORT__
 *     so `</script>`, U+2028, and U+2029 cannot break out of the inline tag.
 *   - The HTML document uses <meta http-equiv="Content-Security-Policy"> to
 *     prevent the enhancement script from making network calls even if a future
 *     change accidentally introduces a fetch/XHR.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { escapeForInlineScript } from "./json-escape";
import { firstExistingPath } from "./generated-artifact";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Singleton: read viewer.js once and cache it. */
let cachedViewerScript: string | null = null;

function getViewerScript(): string {
  if (cachedViewerScript !== null) return cachedViewerScript;
  try {
    // Literal paths only — see firstExistingPath.
    const scriptPath = firstExistingPath(
      join(process.cwd(), "src/lib/run-report/export/viewer.js"),
      join(__dirname, "viewer.js"),
    );
    cachedViewerScript = readFileSync(scriptPath, "utf8");
  } catch {
    // Fallback: empty enhancement (the report still renders, just no toggle).
    cachedViewerScript = "(function(){})();";
  }
  return cachedViewerScript;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

/** Singleton: read the generated offline-report.css once and cache it. */
let cachedOfflineCss: string | null = null;

/**
 * Reads the build-time-generated, purged Tailwind CSS bundle for the offline
 * report (see offline.entry.css + scripts/build-offline-css.mjs).
 *
 * Mirrors getViewerScript()'s cache/read pattern, with one deliberate
 * divergence: viewer.js is a checked-in static file always present in the
 * repo, so its read failure is silently swallowed. offline-report.css is a
 * *generated, gitignored* artifact (produced by the `build:offline-css`
 * script, wired as `prebuild`/`predev`) — a silent fallback here would
 * recreate the exact "renders unstyled, nobody notices" failure mode this
 * feature exists to close. So a read failure is logged loudly via
 * console.warn (including the resolved path attempted) before falling back
 * to an empty string. The export itself must never throw even when the CSS
 * is missing.
 */
function getOfflineCss(): string {
  if (cachedOfflineCss !== null) return cachedOfflineCss;
  // Literal paths only — see firstExistingPath.
  const cssPath = firstExistingPath(
    join(process.cwd(), "src/lib/run-report/export/offline-report.css"),
    join(__dirname, "offline-report.css"),
  );
  try {
    cachedOfflineCss = readFileSync(cssPath, "utf8");
  } catch (err) {
    console.warn(
      `[offline-html] Failed to read generated offline report CSS at "${cssPath}". ` +
        "The offline export will render unstyled. Run `npm run build:offline-css` " +
        "(wired as prebuild/predev) to generate it.",
      err,
    );
    cachedOfflineCss = "";
  }
  return cachedOfflineCss;
}

// ── Exports ───────────────────────────────────────────────────────────────────

export interface OfflineHtmlResult {
  /** Full HTML document string for index.html in the ZIP. */
  indexHtml: string;
  /** JSON string for bundle.json in the ZIP (unescaped — standalone file). */
  bundleJson: string;
}

/**
 * Assemble the final self-contained HTML document for offline viewing.
 *
 * @param markup      SSR'd HTML fragment from render-offline.tsx.
 * @param projection  The bundle projection (or null) to embed as inline JSON.
 *                    MUST NOT contain reportUrl or signed S3 URLs — callers
 *                    are responsible for omitting them before passing here.
 * @param title       Document title (e.g. task slug + run type).
 */
export function assembleOfflineHtml(
  markup: string,
  projection: unknown,
  title: string,
): OfflineHtmlResult {
  // ── Inline JSON ────────────────────────────────────────────────────────────
  // escapeForInlineScript replaces < → \u003c and U+2028/U+2029 so the JSON
  // cannot break out of the inline <script> tag.
  const escapedJson = escapeForInlineScript({ projection, exportedAt: new Date().toISOString() });
  // bundleJson is a standalone file, not inside a script tag, so we use
  // JSON.stringify without the inline-script escaping.
  const bundleJson = JSON.stringify(
    { projection, exportedAt: new Date().toISOString() },
    null,
    2,
  );

  // ── Enhancement script ─────────────────────────────────────────────────────
  const viewerScript = getViewerScript();
  const offlineCss = getOfflineCss();

  // ── Sanitize title ─────────────────────────────────────────────────────────
  // Strip characters that would break the <title> tag or be used for header
  // injection if the title ever flows into an HTTP header.
  // Order: strip CR/LF/quotes/C0 control chars FIRST, then HTML-escape < > &.
  const safeTitle = title
    .replace(/[\r\n"]/g, "")                // CR/LF (header injection), double-quote
    .replace(/[\x00-\x1F\x7F\x80-\x9F]/g, "") // C0/C1 control chars
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&/g, "&amp;")
    .trim() || "Offline Report";

  // ── Full document ──────────────────────────────────────────────────────────
  // Strict CSP: default-src 'none' allows only what we explicitly whitelist.
  // script-src 'unsafe-inline' is needed for the inline enhancement script.
  // style-src 'unsafe-inline' is needed for the inline <style> block.
  // img-src data: allows inline images (for any future use).
  // No connect-src → no fetch, no XHR.
  // No font-src → no external fonts.
  const indexHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none';" />
<title>${safeTitle} — Offline Report</title>
<style>
${offlineCss}
</style>
</head>
<body class="dark bg-black text-white" style="padding: 1.25rem 1.5rem;">
<div class="container" style="max-width: 1080px; margin: 0 auto;">
${markup}
</div>
<script>
window.__OFFLINE_REPORT__ = ${escapedJson};
</script>
<script>
${viewerScript}
</script>
</body>
</html>`;

  return { indexHtml, bundleJson };
}
