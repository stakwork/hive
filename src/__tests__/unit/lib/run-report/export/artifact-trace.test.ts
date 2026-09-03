/**
 * Guards how the offline exports locate their generated artifacts.
 *
 * Next's output file tracer (@vercel/nft) statically evaluates
 * `process.cwd()` and `__dirname`. A `join(process.cwd(), <non-literal>)`
 * is a partially-known path, and the tracer answers it by including the
 * whole directory under the known prefix — the entire project root, .env
 * files included — into every function that imports the module. That
 * inflated the production archive by 22 MB and broke deployment once.
 *
 * This test bundles each artifact-reading module the way the app would and
 * runs the same tracer over it: only the artifacts themselves (and
 * package.json, which the tracer always adds) may be pulled in.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { build } from "esbuild";
import { nodeFileTrace } from "next/dist/compiled/@vercel/nft";

const ROOT = process.cwd();

const MODULES = [
  {
    entry: "src/lib/legal-cascade/export/offline-html.ts",
    allowed: [
      "src/lib/legal-cascade/export/cascade-offline.css",
      "src/lib/legal-cascade/export/cascade-offline.js",
    ],
    prebuild: ["scripts/build-offline-css.mjs", "scripts/build-cascade-bundle.mjs"],
  },
  {
    entry: "src/lib/run-report/export/offline-html.ts",
    allowed: [
      "src/lib/run-report/export/offline-report.css",
      "src/lib/run-report/export/viewer.js",
    ],
    prebuild: ["scripts/build-offline-css.mjs"],
  },
];

async function traceModule(entry: string): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "artifact-trace-"));
  try {
    const outfile = join(dir, "module.js");
    await build({
      entryPoints: [join(ROOT, entry)],
      outfile,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: ["node20"],
      tsconfig: join(ROOT, "tsconfig.json"),
      logLevel: "silent",
    });
    const result = await nodeFileTrace([outfile], { base: ROOT, processCwd: ROOT });
    return [...result.fileList].filter((f) => !f.startsWith("..") && !f.startsWith("private/"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.each(MODULES)("file trace of $entry", ({ entry, allowed, prebuild }) => {
  it("pulls in only its own artifacts — never the project root", async () => {
    for (const script of prebuild) {
      execFileSync("node", [join(ROOT, script)], { stdio: "pipe" });
    }
    const traced = await traceModule(entry);
    const unexpected = traced.filter((f) => !allowed.includes(f) && f !== "package.json");
    expect(unexpected).toEqual([]);
    expect(traced).toEqual(expect.arrayContaining(allowed));
    expect(traced.some((f) => f.startsWith(".env"))).toBe(false);
  }, 120_000);
});
