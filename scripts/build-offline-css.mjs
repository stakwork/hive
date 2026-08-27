#!/usr/bin/env node
/**
 * Builds the offline legal-report CSS bundle.
 *
 * Runs the project's OWN postcss.config.mjs plugin chain (@tailwindcss/postcss
 * + autoprefixer — the exact same plugins/versions `next build` uses to
 * compile globals.css) against `src/lib/run-report/export/offline.entry.css`,
 * and writes minified output to
 * `src/lib/run-report/export/offline-report.css`.
 *
 * Deliberately does NOT introduce a `@tailwindcss/cli` devDependency: running
 * postcss programmatically with the app's real config means the offline
 * bundle can never drift from the live stylesheet's toolchain/version/plugin
 * config — the exact class of bug this script exists to eliminate.
 *
 * Wired as both `prebuild` and `predev` in package.json so the artifact is
 * regenerated automatically at both entry points. The output file is
 * gitignored (derived build artifact, not checked-in source).
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

const ENTRY_CSS = join(ROOT, "src/lib/run-report/export/offline.entry.css");
const OUTPUT_CSS = join(ROOT, "src/lib/run-report/export/offline-report.css");
const POSTCSS_CONFIG = join(ROOT, "postcss.config.mjs");

async function main() {
  const { default: postcssConfig } = await import(pathToFileURL(POSTCSS_CONFIG).href);
  const pluginEntries = Object.entries(postcssConfig.plugins ?? {});

  if (pluginEntries.length === 0) {
    throw new Error(`No plugins found in ${POSTCSS_CONFIG} — refusing to build an empty CSS pipeline.`);
  }

  const plugins = await Promise.all(
    pluginEntries.map(async ([name, options]) => {
      const mod = await import(name);
      const factory = mod.default ?? mod;
      // Reuse the exact same plugin identities/versions as next build's
      // postcss.config.mjs. The one deliberate addition: enable
      // @tailwindcss/postcss's built-in `optimize.minify` for this
      // standalone bundle (the live app's Next.js build minifies its CSS
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

  // @tailwindcss/postcss scans for class candidates itself (via @source),
  // but it also needs `base` set so relative @source paths in a nested CSS
  // file resolve against the project root when it isn't handed one already —
  // Tailwind resolves @source relative to the file that declares it, so no
  // extra `base` option is required here as long as `from` is passed to
  // postcss.process(), which we do below.
  const css = readFileSync(ENTRY_CSS, "utf8");

  const result = await postcss(plugins).process(css, {
    from: ENTRY_CSS,
    to: OUTPUT_CSS,
  });

  for (const warning of result.warnings()) {
    console.warn(`[build-offline-css] ${warning.toString()}`);
  }

  if (!result.css || result.css.trim().length === 0) {
    throw new Error("PostCSS produced empty output for offline.entry.css — refusing to write an empty bundle.");
  }

  writeFileSync(OUTPUT_CSS, result.css, "utf8");
  console.log(
    `[build-offline-css] Wrote ${OUTPUT_CSS} (${(result.css.length / 1024).toFixed(1)} KB)`,
  );
}

main().catch((err) => {
  console.error("[build-offline-css] Failed to build offline report CSS:");
  console.error(err);
  process.exit(1);
});
