#!/usr/bin/env node
/**
 * Builds the offline CSS bundles — one per self-contained HTML export:
 *
 *   - run report:   src/lib/run-report/export/offline.entry.css
 *                 → src/lib/run-report/export/offline-report.css
 *   - trace export: src/lib/legal-cascade/export/offline.entry.css
 *                 → src/lib/legal-cascade/export/cascade-offline.css
 *
 * Each entry runs through the project's OWN postcss.config.mjs plugin chain
 * (@tailwindcss/postcss + autoprefixer — the exact same plugins/versions
 * `next build` uses to compile globals.css), minified.
 *
 * Deliberately does NOT introduce a `@tailwindcss/cli` devDependency: running
 * postcss programmatically with the app's real config means the offline
 * bundles can never drift from the live stylesheet's toolchain/version/plugin
 * config — the exact class of bug this script exists to eliminate.
 *
 * Wired into `build:offline` (prebuild/predev) so the artifacts are
 * regenerated automatically at both entry points. The output files are
 * gitignored (derived build artifacts, not checked-in source).
 *
 * Usage: node scripts/build-offline-css.mjs
 * Exits non-zero (and prints the PostCSS/Tailwind error) on failure.
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import postcss from "postcss";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const POSTCSS_CONFIG = join(ROOT, "postcss.config.mjs");

const BUNDLES = [
  {
    entry: join(ROOT, "src/lib/run-report/export/offline.entry.css"),
    output: join(ROOT, "src/lib/run-report/export/offline-report.css"),
  },
  {
    entry: join(ROOT, "src/lib/legal-cascade/export/offline.entry.css"),
    output: join(ROOT, "src/lib/legal-cascade/export/cascade-offline.css"),
  },
];

async function loadPlugins() {
  const { default: postcssConfig } = await import(pathToFileURL(POSTCSS_CONFIG).href);
  const pluginEntries = Object.entries(postcssConfig.plugins ?? {});

  if (pluginEntries.length === 0) {
    throw new Error(`No plugins found in ${POSTCSS_CONFIG} — refusing to build an empty CSS pipeline.`);
  }

  return Promise.all(
    pluginEntries.map(async ([name, options]) => {
      const mod = await import(name);
      const factory = mod.default ?? mod;
      // Reuse the exact same plugin identities/versions as next build's
      // postcss.config.mjs. The one deliberate addition: enable
      // @tailwindcss/postcss's built-in `optimize.minify` for these
      // standalone bundles (the live app's Next.js build minifies its CSS
      // through its own separate pipeline stage, so postcss.config.mjs
      // itself doesn't need this option — but our script writes its output
      // directly to disk with no further minification step).
      const resolvedOptions =
        name === "@tailwindcss/postcss"
          ? { ...options, optimize: { minify: true } }
          : options;
      return resolvedOptions && Object.keys(resolvedOptions).length > 0
        ? factory(resolvedOptions)
        : factory();
    }),
  );
}

async function buildOne(plugins, { entry, output }) {
  // @tailwindcss/postcss scans for class candidates itself (via @source),
  // resolving relative @source paths against the file that declares them —
  // which is why `from` is passed to postcss.process().
  const css = readFileSync(entry, "utf8");

  const result = await postcss(plugins).process(css, { from: entry, to: output });

  for (const warning of result.warnings()) {
    console.warn(`[build-offline-css] ${warning.toString()}`);
  }

  if (!result.css || result.css.trim().length === 0) {
    throw new Error(`PostCSS produced empty output for ${entry} — refusing to write an empty bundle.`);
  }

  writeFileSync(output, result.css, "utf8");
  console.log(`[build-offline-css] Wrote ${output} (${(result.css.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  const plugins = await loadPlugins();
  for (const bundle of BUNDLES) {
    await buildOne(plugins, bundle);
  }
}

main().catch((err) => {
  console.error("[build-offline-css] Failed to build offline CSS:");
  console.error(err);
  process.exit(1);
});
