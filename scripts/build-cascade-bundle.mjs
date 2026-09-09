#!/usr/bin/env node
/**
 * Builds the offline trace-export browser bundle.
 *
 * Bundles `src/lib/legal-cascade/export/offline.entry.tsx` — the real
 * CascadeTrace component plus React, ReactDOM and the Radix tooltip/dialog
 * primitives it uses — into ONE minified IIFE at
 * `src/lib/legal-cascade/export/cascade-offline.js`, which offline-html.ts
 * inlines into the exported document. No CDN: the file must open from
 * file:// with zero network calls, and the bundled versions are exactly the
 * ones in package.json.
 *
 * esbuild resolves the `@/` alias from tsconfig.json's `paths` on its own.
 *
 * Wired as `build:offline-bundle` (part of `build:offline`, which prebuild
 * and predev run). The output is gitignored.
 *
 * Usage: node scripts/build-cascade-bundle.mjs
 * Exits non-zero (printing esbuild's diagnostics) on failure.
 */

import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { statSync } from "fs";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const ENTRY = join(ROOT, "src/lib/legal-cascade/export/offline.entry.tsx");
const OUTPUT = join(ROOT, "src/lib/legal-cascade/export/cascade-offline.js");

async function main() {
  const result = await build({
    entryPoints: [ENTRY],
    outfile: OUTPUT,
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    legalComments: "none",
    logLevel: "warning",
    // Client components carry a "use client" directive that means nothing in
    // a plain browser bundle; esbuild would otherwise warn once per file.
    logOverride: { "ignored-directive": "silent" },
  });

  if (result.errors.length > 0) {
    throw new Error(`esbuild reported ${result.errors.length} error(s)`);
  }

  const bytes = statSync(OUTPUT).size;
  if (bytes === 0) {
    throw new Error("esbuild produced an empty bundle — refusing to keep it.");
  }
  console.log(`[build-cascade-bundle] Wrote ${OUTPUT} (${(bytes / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error("[build-cascade-bundle] Failed to build the offline trace bundle:");
  console.error(err);
  process.exit(1);
});
