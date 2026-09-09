/**
 * Guardrails for the trace export's generated CSS bundle (cascade-offline.css),
 * mirroring the run report's offline-css-fidelity test:
 *
 *   1. @source structural coverage — every .tsx file reachable from the
 *      browser entry (offline.entry.tsx) must be declared in
 *      offline.entry.css, or its classes are silently purged.
 *   2. Rendered-markup fidelity — every class a real render of the offline
 *      page emits exists in the generated CSS.
 *   3. Dark-mode compilation — `dark:` utilities compile to the class-based
 *      selector the exported page toggles, not a media query.
 */

import { describe, it, expect, beforeAll } from "vitest";
import React from "react";
import { execFileSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";

const ROOT = process.cwd();
const EXPORT_DIR = join(ROOT, "src/lib/legal-cascade/export");
const CSS_PATH = join(EXPORT_DIR, "cascade-offline.css");
const ENTRY_CSS_PATH = join(EXPORT_DIR, "offline.entry.css");
const ENTRY_TSX_PATH = join(EXPORT_DIR, "offline.entry.tsx");

beforeAll(() => {
  execFileSync("node", [join(ROOT, "scripts/build-offline-css.mjs")], { stdio: "pipe" });
}, 60_000);

// ── Import walker (same approach as the run report's test) ──────────────────

function resolveImportSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Value imports only — `import type` is erased by esbuild and never bundles. */
function extractImportSpecifiers(content: string): string[] {
  const specs = new Set<string>();
  const re = /import\s+(?!type\s)(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) specs.add(m[1]);
  const bare = /^import\s+["']([^"']+)["']/gm;
  while ((m = bare.exec(content))) specs.add(m[1]);
  return [...specs];
}

function walkImportGraph(seed: string): Set<string> {
  const visited = new Set<string>();
  const queue = [seed];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file) || !existsSync(file)) continue;
    visited.add(file);
    for (const spec of extractImportSpecifiers(readFileSync(file, "utf8"))) {
      const resolved = resolveImportSpecifier(file, spec);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return visited;
}

function declaredSources(): Set<string> {
  const entry = readFileSync(ENTRY_CSS_PATH, "utf8");
  const out = new Set<string>();
  const re = /@source\s+"([^"]+)";/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(entry))) out.add(resolve(dirname(ENTRY_CSS_PATH), m[1]));
  return out;
}

describe("offline.entry.css @source coverage", () => {
  it("declares every .tsx file reachable from the browser entry", () => {
    const reachable = [...walkImportGraph(ENTRY_TSX_PATH)].filter((f) => f.endsWith(".tsx"));
    expect(reachable.length).toBeGreaterThan(3);
    const declared = declaredSources();
    const undeclared = reachable.filter((f) => !declared.has(f));
    if (undeclared.length > 0) {
      throw new Error(
        "Reachable from offline.entry.tsx but missing from offline.entry.css @source:\n  " +
          undeclared.map((f) => f.replace(ROOT + "/", "")).join("\n  "),
      );
    }
  });

  it("never pulls app-only modules into the browser bundle", () => {
    const reachable = [...walkImportGraph(ENTRY_TSX_PATH)];
    const banned = reachable.filter((f) =>
      /src\/(hooks|lib\/db|lib\/pusher|lib\/legal-cascade\/server)/.test(f),
    );
    expect(banned).toEqual([]);
    for (const f of reachable) {
      expect(readFileSync(f, "utf8")).not.toMatch(/from\s+["']@prisma\/client["']/);
    }
  });
});

describe("cascade-offline.css", () => {
  it("compiles dark: utilities to the class-based selector", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    const idx = css.indexOf(".dark\\:text-cyan-400");
    expect(idx).toBeGreaterThan(-1);
    const window = css.slice(idx, idx + 200);
    expect(window).toMatch(/\.dark/);
    expect(window).not.toMatch(/@media\s*\(\s*prefers-color-scheme/);
  });

  it("contains every class a real offline render emits", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { OfflineCascadePage } = await import("@/lib/legal-cascade/export/offline.entry");
    const { assembleRunCascade } = await import("@/lib/legal-cascade/derive");
    const { buildMockSessionMap, buildMockTurnsBySession } = await import(
      "@/lib/legal-cascade/fixtures"
    );

    const markup = renderToStaticMarkup(
      React.createElement(OfflineCascadePage, {
        payload: {
          model: assembleRunCascade(
            [...buildMockSessionMap("147813394").values()],
            buildMockTurnsBySession(),
          ),
          peeks: {},
          meta: {
            runId: "run-1",
            identifier: null,
            exportedAt: "2026-09-02T12:00:00.000Z",
            skippedPeeks: ["x"],
          },
        },
      }),
    );
    expect(markup).toContain("cascade-summary-strip");

    const css = readFileSync(CSS_PATH, "utf8");
    const classes = new Set<string>();
    const re = /class="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markup))) for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
    expect(classes.size).toBeGreaterThan(20);

    const escaped = (cls: string) => "." + cls.replace(/([.:/#[\]()%,])/g, "\\$1");
    const missing = [...classes].filter((c) => !css.includes(escaped(c)));
    if (missing.length > 0) {
      throw new Error(
        `Offline trace render emits classes missing from cascade-offline.css: ${missing.join(", ")}`,
      );
    }
  });
});
