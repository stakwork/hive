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

// ── Constants ─────────────────────────────────────────────────────────────────

/** Singleton: read viewer.js once and cache it. */
let cachedViewerScript: string | null = null;

function getViewerScript(): string {
  if (cachedViewerScript !== null) return cachedViewerScript;
  try {
    // Path relative to this file's location at build/run time.
    const scriptPath = join(__dirname, "viewer.js");
    cachedViewerScript = readFileSync(scriptPath, "utf8");
  } catch {
    // Fallback: empty enhancement (the report still renders, just no toggle).
    cachedViewerScript = "(function(){})();";
  }
  return cachedViewerScript;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

/**
 * Minimal self-contained dark-theme CSS.
 *
 * Uses only system fonts, CSS custom properties, and a small set of utility
 * classes matching the Tailwind/shadcn class names used by the offline
 * renderer. No @import, no external URLs, no webfonts.
 *
 * This is intentionally hand-authored rather than extracted from the compiled
 * production stylesheet, because:
 *   1. The production stylesheet is ~200 KB of purged utilities, most unused
 *      by the report view.
 *   2. Extracting it at runtime requires a build step that isn't available in
 *      the API route context.
 *   3. The report view uses a small, predictable set of classes.
 *
 * Classes included: the dark theme tokens, layout, typography, colors, border,
 * spacing, and the Tailwind utility classes used by the offline renderer.
 */
const OFFLINE_CSS = `
/* ─── Reset / base ──────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --background: 0 0% 3.9%;
  --foreground: 0 0% 98%;
  --card: 0 0% 3.9%;
  --card-foreground: 0 0% 98%;
  --popover: 0 0% 3.9%;
  --popover-foreground: 0 0% 98%;
  --primary: 0 0% 98%;
  --primary-foreground: 0 0% 9%;
  --secondary: 0 0% 14.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 0 0% 14.9%;
  --muted-foreground: 0 0% 63.9%;
  --accent: 0 0% 14.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 14.9%;
  --input: 0 0% 14.9%;
  --ring: 0 0% 83.1%;
  --radius: 0.5rem;
}

html, body {
  background-color: #000;
  color: #fafafa;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ─── Typography ─────────────────────────────────────────────────────────── */
h1 { font-size: 1.875rem; font-weight: 600; letter-spacing: -0.025em; }
h2 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.025em; }
h3 { font-size: 1rem; font-weight: 600; }
p { line-height: 1.6; }
pre, code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.875em; }
pre { white-space: pre-wrap; overflow-x: auto; }
b, strong { font-weight: 600; }

/* ─── Links ──────────────────────────────────────────────────────────────── */
a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
a:hover { opacity: 0.8; }

/* ─── Layout ─────────────────────────────────────────────────────────────── */
.container { max-width: 1080px; margin: 0 auto; padding: 1.25rem 1.5rem; }
.max-w-\\[1080px\\] { max-width: 1080px; }
.max-w-\\[1200px\\] { max-width: 1200px; }
.mx-auto { margin-left: auto; margin-right: auto; }
.min-w-0 { min-width: 0; }
.inline-flex { display: inline-flex; }
.flex { display: flex; }
.flex-1 { flex: 1 1 0%; }
.flex-col { flex-direction: column; }
.flex-wrap { flex-wrap: wrap; }
.items-center { align-items: center; }
.items-start { align-items: flex-start; }
.items-end { align-items: flex-end; }
.justify-center { justify-content: center; }
.justify-between { justify-content: space-between; }
.gap-1 { gap: 0.25rem; }
.gap-1\\.5 { gap: 0.375rem; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.gap-6 { gap: 1.5rem; }
.gap-8 { gap: 2rem; }
.gap-x-3 { column-gap: 0.75rem; }
.gap-x-10 { column-gap: 2.5rem; }
.gap-y-1 { row-gap: 0.25rem; }
.gap-y-3 { row-gap: 0.75rem; }
.grid { display: grid; }
.grid-cols-\\[auto_minmax\\(0\\,1fr\\)\\] { grid-template-columns: auto minmax(0, 1fr); }
.min-w-\\[100px\\] { min-width: 100px; }
.min-w-\\[220px\\] { min-width: 220px; }
.min-w-\\[260px\\] { min-width: 260px; }
.min-w-full { min-width: 100%; }
.w-full { width: 100%; }
.overflow-auto { overflow: auto; }
.overflow-hidden { overflow: hidden; }
.overflow-x-auto { overflow-x: auto; }
.pb-3 { padding-bottom: 0.75rem; }
.pb-4 { padding-bottom: 1rem; }
.pb-8 { padding-bottom: 2rem; }
.pb-24 { padding-bottom: 6rem; }
.pt-2 { padding-top: 0.5rem; }
.pt-14 { padding-top: 3.5rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-2\\.5 { padding-left: 0.625rem; padding-right: 0.625rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.py-0\\.5 { padding-top: 0.125rem; padding-bottom: 0.125rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.py-1\\.5 { padding-top: 0.375rem; padding-bottom: 0.375rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-2\\.5 { padding-top: 0.625rem; padding-bottom: 0.625rem; }
.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
.py-16 { padding-top: 4rem; padding-bottom: 4rem; }
.p-4 { padding: 1rem; }
.p-8 { padding: 2rem; }
.p-10 { padding: 2.5rem; }
.mb-1 { margin-bottom: 0.25rem; }
.mb-2 { margin-bottom: 0.5rem; }
.mb-3 { margin-bottom: 0.75rem; }
.mb-4 { margin-bottom: 1rem; }
.mb-6 { margin-bottom: 1.5rem; }
.mb-8 { margin-bottom: 2rem; }
.mt-1 { margin-top: 0.25rem; }
.mt-1\\.5 { margin-top: 0.375rem; }
.mt-2 { margin-top: 0.5rem; }
.mt-3 { margin-top: 0.75rem; }
.mt-4 { margin-top: 1rem; }
.mt-5 { margin-top: 1.25rem; }
.ml-2 { margin-left: 0.5rem; }
.mr-2 { margin-right: 0.5rem; }
.space-y-1 > * + * { margin-top: 0.25rem; }
.space-y-2 > * + * { margin-top: 0.5rem; }

/* ─── Colors / themes ────────────────────────────────────────────────────── */
.text-white { color: #fff; }
.text-foreground { color: #fafafa; }
.text-muted-foreground { color: #a1a1aa; }
.text-primary { color: #fafafa; }
.text-destructive { color: #ef4444; }
.bg-black { background-color: #000; }
.bg-card { background-color: #0a0a0a; }
.bg-muted { background-color: #18181b; }
.bg-muted\\/10 { background-color: rgba(24,24,27,0.1); }
.bg-muted\\/20 { background-color: rgba(24,24,27,0.2); }
.bg-muted\\/30 { background-color: rgba(24,24,27,0.3); }
.bg-muted\\/60 { background-color: rgba(24,24,27,0.6); }
.text-muted-foreground\\/40 { color: rgba(161,161,170,0.4); }
.text-muted-foreground\\/50 { color: rgba(161,161,170,0.5); }
.text-muted-foreground\\/60 { color: rgba(161,161,170,0.6); }
.text-muted-foreground\\/70 { color: rgba(161,161,170,0.7); }
.text-muted-foreground\\/80 { color: rgba(161,161,170,0.8); }
.text-foreground\\/80 { color: rgba(250,250,250,0.8); }
.text-amber-600 { color: #d97706; }
.text-emerald-600 { color: #059669; }
.dark .text-emerald-400 { color: #34d399; }
.text-violet-500 { color: #8b5cf6; }
.bg-emerald-500\\/5 { background-color: rgba(16,185,129,0.05); }
.bg-emerald-500\\/10 { background-color: rgba(16,185,129,0.1); }
.bg-emerald-500\\/15 { background-color: rgba(16,185,129,0.15); }
.bg-destructive\\/5 { background-color: rgba(239,68,68,0.05); }
.bg-destructive\\/\\[0\\.04\\] { background-color: rgba(239,68,68,0.04); }
.bg-destructive\\/10 { background-color: rgba(239,68,68,0.1); }
.bg-destructive\\/15 { background-color: rgba(239,68,68,0.15); }
.bg-amber-500\\/5 { background-color: rgba(245,158,11,0.05); }
.bg-amber-500\\/10 { background-color: rgba(245,158,11,0.1); }
.bg-violet-500\\/10 { background-color: rgba(139,92,246,0.1); }
.text-amber-600, .dark .text-amber-400 { color: #d97706; }

/* ─── Borders ────────────────────────────────────────────────────────────── */
.border { border-width: 1px; border-style: solid; }
.border-0 { border-width: 0; }
.border-b { border-bottom-width: 1px; border-bottom-style: solid; }
.border-r { border-right-width: 1px; border-right-style: solid; }
.border-t { border-top-width: 1px; border-top-style: solid; }
.border-border { border-color: #27272a; }
.border-border\\/40 { border-color: rgba(39,39,42,0.4); }
.border-border\\/50 { border-color: rgba(39,39,42,0.5); }
.border-border\\/60 { border-color: rgba(39,39,42,0.6); }
.border-dashed { border-style: dashed; }
.border-amber-500\\/30 { border-color: rgba(245,158,11,0.3); }
.border-emerald-500\\/20 { border-color: rgba(16,185,129,0.2); }
.border-emerald-500\\/40 { border-color: rgba(16,185,129,0.4); }
.border-destructive\\/25 { border-color: rgba(239,68,68,0.25); }
.border-destructive\\/35 { border-color: rgba(239,68,68,0.35); }
.border-destructive\\/45 { border-color: rgba(239,68,68,0.45); }
.border-violet-500\\/40 { border-color: rgba(139,92,246,0.4); }
.divide-y > * + * { border-top-width: 1px; border-top-style: solid; }
.divide-border\\/60 > * + * { border-top-color: rgba(39,39,42,0.6); }
.divide-border\\/40 > * + * { border-top-color: rgba(39,39,42,0.4); }

/* ─── Rounded corners ────────────────────────────────────────────────────── */
.rounded { border-radius: 0.25rem; }
.rounded-sm { border-radius: 0.125rem; }
.rounded-md { border-radius: 0.375rem; }
.rounded-lg { border-radius: 0.5rem; }
.rounded-full { border-radius: 9999px; }
.rounded-px { border-radius: 1px; }

/* ─── Text sizes ─────────────────────────────────────────────────────────── */
.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-base { font-size: 1rem; line-height: 1.5rem; }
.text-xl { font-size: 1.25rem; line-height: 1.75rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
.text-\\[56px\\] { font-size: 56px; }
.text-\\[9px\\] { font-size: 9px; }
.text-\\[9\\.5px\\] { font-size: 9.5px; }
.text-\\[10px\\] { font-size: 10px; }
.text-\\[10\\.5px\\] { font-size: 10.5px; }
.text-\\[11px\\] { font-size: 11px; }
.text-\\[11\\.5px\\] { font-size: 11.5px; }
.text-\\[12px\\] { font-size: 12px; }
.text-\\[12\\.5px\\] { font-size: 12.5px; }
.text-\\[13px\\] { font-size: 13px; }
.text-\\[14px\\] { font-size: 14px; }
.text-center { text-align: center; }
.text-left { text-align: left; }
.font-mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.tracking-tight { letter-spacing: -0.025em; }
.tracking-\\[0\\.07em\\] { letter-spacing: 0.07em; }
.tracking-\\[0\\.08em\\] { letter-spacing: 0.08em; }
.tracking-\\[0\\.1em\\] { letter-spacing: 0.1em; }
.tracking-\\[0\\.12em\\] { letter-spacing: 0.12em; }
.tracking-\\[0\\.14em\\] { letter-spacing: 0.14em; }
.tracking-\\[0\\.1em\\] { letter-spacing: 0.1em; }
.tracking-\\[0\\.22em\\] { letter-spacing: 0.22em; }
.uppercase { text-transform: uppercase; }
.leading-none { line-height: 1; }
.tabular-nums { font-variant-numeric: tabular-nums; }
.italic { font-style: italic; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.whitespace-nowrap { white-space: nowrap; }
.break-words { overflow-wrap: break-word; }
.select-none { user-select: none; }
.cursor-default { cursor: default; }
.normal-case { text-transform: none; }
.tracking-normal { letter-spacing: 0; }

/* ─── Tables ─────────────────────────────────────────────────────────────── */
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; vertical-align: top; }
.align-top { vertical-align: top; }
.sticky { position: sticky; }
.left-0 { left: 0; }
.z-10 { z-index: 10; }

/* ─── Peek containers ────────────────────────────────────────────────────── */
.peek-body { display: none; }
.peek-open .peek-body { display: block; }
.peek-open .peek-toggle-indicator { transform: rotate(180deg); }

/* ─── Offline link disabled ──────────────────────────────────────────────── */
.offline-link-disabled { text-decoration: none; opacity: 0.5; cursor: default; }
.offline-chip-rendered { opacity: 0.7; }

/* ─── Section / section scroll margin ───────────────────────────────────── */
.scroll-mt-6 { scroll-margin-top: 1.5rem; }
.pt-4 { padding-top: 1rem; }

/* ─── Offline notice ─────────────────────────────────────────────────────── */
.rounded-md.border.border-amber-500\\/30 { margin-top: 1rem; }

/* ─── Max width helpers ──────────────────────────────────────────────────── */
.max-w-\\[70ch\\] { max-width: 70ch; }
.max-w-\\[72ch\\] { max-width: 72ch; }
.max-w-\\[80ch\\] { max-width: 80ch; }
.max-w-md { max-width: 28rem; }
.max-w-lg { max-width: 32rem; }
.max-lg { max-width: 32rem; }

/* ─── Last border removal ────────────────────────────────────────────────── */
.last\\:border-0:last-child { border-width: 0; }
`.trim();

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
${OFFLINE_CSS}
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
