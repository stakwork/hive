/**
 * Fidelity / regression tests for the generated offline report CSS bundle.
 *
 * These tests are the guardrails called for by the feature's testing plan:
 *
 *   1. "Fidelity" — every class actually emitted by a real offline render
 *      (via renderRunOffline against the FULL_BUNDLE fixture, the same path
 *      used in render-offline.test.ts) must exist in the generated
 *      offline-report.css. This catches "component uses a class that's
 *      silently unstyled offline" across the whole render path, not just a
 *      single component.
 *   2. "Dark-mode regression" — a known `dark:`-prefixed utility actually
 *      used in the offline render path (dark:text-amber-400) must compile to
 *      a class-based selector (`.dark ...`), not a
 *      `@media (prefers-color-scheme: dark)` block. This guards the blocking
 *      dark-mode fix described in the architecture doc: the offline document
 *      forces `class="dark"` and never toggles it, so a media-query-compiled
 *      `dark:` utility would silently vanish for light-OS readers.
 *   3. "@source structural coverage" — every file with JSX/className usage
 *      that is actually reachable from render-offline.tsx / offline-adapters.tsx
 *      (the offline render entrypoints) must be declared in
 *      offline.entry.css's `@source` list, so a future addition to the
 *      offline render path fails CI instead of silently shipping unstyled
 *      markup.
 *   4. "build:offline-css runs standalone" — the generator script itself
 *      exits 0 and produces valid, non-empty CSS with no PostCSS/Tailwind
 *      errors, independent of `npm run build`.
 *
 * All of these tests build the CSS bundle for real in `beforeAll` rather than
 * depending on CI job ordering or a possibly-stale checked-in artifact — the
 * unit-test CI job does not run `npm run build`.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, resolve } from "path";

const ROOT = process.cwd();
const CSS_PATH = join(ROOT, "src/lib/run-report/export/offline-report.css");
const ENTRY_CSS_PATH = join(ROOT, "src/lib/run-report/export/offline.entry.css");
const BUILD_SCRIPT = join(ROOT, "scripts/build-offline-css.mjs");

function runBuildOfflineCss(): string {
  return execFileSync("node", [BUILD_SCRIPT], { encoding: "utf8", stdio: "pipe" });
}

beforeAll(() => {
  runBuildOfflineCss();
}, 60_000);

// ── 4. Standalone script invariant ──────────────────────────────────────────

describe("scripts/build-offline-css.mjs", () => {
  it("runs standalone and exits 0, producing non-empty CSS", () => {
    expect(() => runBuildOfflineCss()).not.toThrow();
    expect(existsSync(CSS_PATH)).toBe(true);
    const css = readFileSync(CSS_PATH, "utf8");
    expect(css.length).toBeGreaterThan(0);
  });

  it("produces CSS with no obvious PostCSS/Tailwind error markers", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    // Real Tailwind v4 output starts with its license banner comment.
    expect(css).toMatch(/tailwindcss/i);
    expect(css).not.toMatch(/\[postcss\]|SyntaxError|Unexpected token/i);
  });
});

// ── 2. Dark-mode compilation regression ─────────────────────────────────────

describe("dark-mode compilation (offline bundle)", () => {
  it("compiles dark:text-amber-400 to a class-based .dark selector, not a media query", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    const idx = css.indexOf(".dark\\:text-amber-400");
    expect(idx).toBeGreaterThan(-1);

    // Grab a window around the rule and confirm it's wrapped in a
    // class-based `&:where(.dark, .dark *)` selector (Tailwind v4's compiled
    // form for `@custom-variant dark (&:where(.dark, .dark *));`), not a
    // `@media (prefers-color-scheme: dark)` block.
    const windowText = css.slice(idx, idx + 200);
    expect(windowText).toMatch(/\.dark/);
    expect(windowText).not.toMatch(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/);
  });

  it("offline.entry.css declares the class-based dark custom-variant, scoped to itself", () => {
    const entry = readFileSync(ENTRY_CSS_PATH, "utf8");
    expect(entry).toMatch(/@custom-variant\s+dark\s*\(&:where\(\.dark,\s*\.dark \*\)\)/);

    // Must NOT be present in the live globals.css — this override is scoped
    // to the offline bundle only.
    const globals = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
    expect(globals).not.toMatch(/@custom-variant\s+dark/);
  });
});

// ── 1. Rendered-markup fidelity ──────────────────────────────────────────────

describe("offline render markup fidelity", () => {
  it("every class emitted by a real FULL_BUNDLE offline render exists in offline-report.css", async () => {
    vi.resetModules();
    const { renderRunOffline } = await import("@/lib/run-report/export/render-offline");
    const { projectBundle } = await import("@/lib/run-report/project");
    const { FULL_BUNDLE } = await import("@/app/api/mock/run-report/fixtures/full");

    const outcome = projectBundle(JSON.stringify(FULL_BUNDLE));
    if (outcome.status !== "ok") throw new Error("FULL_BUNDLE fixture failed to project");

    const result = await renderRunOffline({
      payload: { runId: "fidelity-test", hasReport: true, projection: outcome.projection },
      taskTitle: "Fidelity Test Run",
      context: { peeks: new Map(), packedDocsByUrl: new Map(), workspaceSlug: null },
    });
    expect(result.ok).toBe(true);

    const css = readFileSync(CSS_PATH, "utf8");

    // Collect every class token from every class="..." attribute in the markup.
    const classAttrRe = /class="([^"]*)"/g;
    const allClasses = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = classAttrRe.exec(result.markup))) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls.trim()) allClasses.add(cls.trim());
      }
    }
    expect(allClasses.size).toBeGreaterThan(0);

    // Tailwind's generated selectors escape special characters (e.g. `.` in
    // `py-0.5` becomes `.py-0\.5`, `/` in `gap-x-3` variants like `w-1/2`
    // becomes `.w-1\/2`, `[` / `]` in arbitrary values are escaped too).
    // Build the escaped selector form for each raw class the same way
    // Tailwind does, then check its presence as a CSS selector fragment.
    function toEscapedSelector(cls: string): string {
      return "." + cls.replace(/([.:/#[\]()%,])/g, "\\$1");
    }

    const missing: string[] = [];
    for (const cls of allClasses) {
      const selector = toEscapedSelector(cls);
      if (!css.includes(selector)) {
        missing.push(cls);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Offline render emits classes not present in generated offline-report.css: ${missing.join(", ")}.\n` +
          "Either add the emitting file to @source in offline.entry.css, or the class is a " +
          "typo/dynamic value Tailwind's scanner cannot see statically.",
      );
    }
  });
});

// ── 3. @source structural coverage ──────────────────────────────────────────

/**
 * Minimal static import walker: resolves `@/...` and relative import
 * specifiers to real files on disk, without following into node_modules.
 * Mirrors the traversal used to derive the @source list in the first place.
 */
function resolveImportSpecifier(fromFile: string, spec: string): string | null {
  const SRC = join(ROOT, "src");
  let base: string;
  if (spec.startsWith("@/")) {
    base = join(SRC, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = resolve(dirname(fromFile), spec);
  } else {
    return null; // external package — not part of our source graph
  }
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function extractImportSpecifiers(fileContent: string): string[] {
  const specs = new Set<string>();
  const namedOrDefaultRe = /import\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = namedOrDefaultRe.exec(fileContent))) specs.add(m[1]);
  const bareRe = /^import\s+["']([^"']+)["']/gm;
  while ((m = bareRe.exec(fileContent))) specs.add(m[1]);
  return [...specs];
}

function walkImportGraph(seeds: string[]): Set<string> {
  const visited = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const spec of extractImportSpecifiers(content)) {
      const resolved = resolveImportSpecifier(file, spec);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return visited;
}

/** Extract the quoted path from each `@source "...";` declaration. */
function parseSourceDeclarations(entryCssContent: string): string[] {
  const re = /@source\s+"([^"]+)";/g;
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(entryCssContent))) paths.push(m[1]);
  return paths;
}

describe("offline.entry.css @source structural coverage", () => {
  it("declares @source for every component-ish (.tsx) file reachable from the offline render entrypoints", () => {
    const seeds = [
      join(ROOT, "src/lib/run-report/export/render-offline.tsx"),
      join(ROOT, "src/lib/run-report/export/offline-adapters.tsx"),
      join(ROOT, "src/lib/run-report/export/offline-html.ts"),
    ];
    const reachable = walkImportGraph(seeds);

    // Only .tsx files (or offline-html.ts, which emits literal class="..."
    // strings directly) can plausibly emit className/class markup that
    // Tailwind's scanner needs to see. Plain .ts utility/type modules never
    // contain JSX and are irrelevant to @source coverage.
    const componentFiles = [...reachable].filter(
      (f) => f.endsWith(".tsx") || f === join(ROOT, "src/lib/run-report/export/offline-html.ts"),
    );
    expect(componentFiles.length).toBeGreaterThan(0);

    const entryCssContent = readFileSync(ENTRY_CSS_PATH, "utf8");
    const declaredSources = parseSourceDeclarations(entryCssContent).map((p) =>
      resolve(dirname(ENTRY_CSS_PATH), p),
    );
    const declaredSet = new Set(declaredSources);

    const undeclared = componentFiles.filter((f) => !declaredSet.has(f));

    if (undeclared.length > 0) {
      throw new Error(
        "The following files are reachable from the offline render entrypoints " +
          "(render-offline.tsx / offline-adapters.tsx) but are NOT declared in " +
          `offline.entry.css's @source list:\n  ${undeclared.map((f) => f.replace(ROOT + "/", "")).join("\n  ")}\n\n` +
          "Add an @source entry for each, or the classes they emit will be " +
          "silently purged from the offline export bundle.",
      );
    }
  });
});
