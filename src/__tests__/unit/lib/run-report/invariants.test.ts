import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Structural invariants enforced by grep.
 *
 * These are deliberately mechanical: the "no HTML sink" guarantee is only worth
 * something if it cannot be quietly reintroduced by a later edit.
 */

const RENDERER_DIR = join(process.cwd(), "src/components/run-report");
const PIPELINE_DIR = join(process.cwd(), "src/lib/run-report");

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesIn(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Read a file with comments stripped.
 *
 * These files deliberately DISCUSS the things the invariants forbid — "must
 * never import rehype-raw", "MermaidDiagram sets dangerouslySetInnerHTML" —
 * so a naive grep matches its own rationale. Strip comments so the invariants
 * check code, not prose.
 */
function read(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("renderer invariants — src/components/run-report", () => {
  const files = filesIn(RENDERER_DIR);

  it("has files to check (guards against a silently-passing glob)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("contains zero dangerouslySetInnerHTML", () => {
    const offenders = files.filter((f) => read(f).includes("dangerouslySetInnerHTML"));
    expect(offenders).toEqual([]);
  });

  it("never imports MarkdownRenderer", () => {
    // MarkdownRenderer routes ```mermaid fences into MermaidDiagram, which sets
    // dangerouslySetInnerHTML with no mermaid securityLevel configured — an
    // HTML sink outside this directory that the check above cannot see.
    const offenders = files.filter((f) => /MarkdownRenderer/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("never imports MermaidDiagram", () => {
    const offenders = files.filter((f) => /MermaidDiagram/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("never imports hast utilities into the client bundle", () => {
    // Sanitization is server-only; shipping hast to the client would mean the
    // projection shape is not actually load-bearing.
    const offenders = files.filter((f) => /from "hast-util|from 'hast-util/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("never references the bundle URL field", () => {
    const offenders = files.filter((f) => /reportUrl|report_url/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("uses formatInUserTz, never the UTC-hardcoded formatFeatureDate", () => {
    const offenders = files.filter((f) => /formatFeatureDate/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("pipeline invariants — src/lib/run-report", () => {
  const files = filesIn(PIPELINE_DIR);

  it("never imports rehype-raw", () => {
    // rehype-raw re-parses raw HTML AFTER sanitization and would undo it.
    const offenders = files.filter((f) => /rehype-raw/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("does not hand-roll tag stripping with regexes", () => {
    // Bypassable via malformed tags and foreign content; hast-util-sanitize is
    // the only permitted mechanism.
    const offenders = files.filter((f) => /replace\(\s*\/<[^)]*script/i.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("global omit invariant — src/lib/db.ts", () => {
  const db = read(join(process.cwd(), "src/lib/db.ts"));

  it("omits reportUrl and webhookUrl by default", () => {
    expect(db).toMatch(/omit:\s*\{/);
    expect(db).toMatch(/stakworkRun:\s*\{[\s\S]*reportUrl:\s*true/);
    expect(db).toMatch(/stakworkRun:\s*\{[\s\S]*webhookUrl:\s*true/);
  });
});

describe("response-shape invariants", () => {
  it("the runs list select does not include webhookUrl", () => {
    const service = read(join(process.cwd(), "src/services/stakwork-run.ts"));
    const start = service.indexOf("const runs = await db.stakworkRun.findMany");
    expect(start).toBeGreaterThan(-1);
    const select = service.slice(start, start + 1400);
    expect(select).not.toMatch(/^\s*webhookUrl:\s*true/m);
    expect(select).not.toMatch(/^\s*reportUrl:\s*true/m);
  });

  it("StakworkRunResponse does not declare webhookUrl", () => {
    const types = read(join(process.cwd(), "src/types/stakwork.ts"));
    const start = types.indexOf("export interface StakworkRunResponse");
    const body = types.slice(start, types.indexOf("}", start));
    expect(body).not.toMatch(/^\s*webhookUrl:/m);
    expect(body).toMatch(/hasReport\?/);
  });

  it("the report route never selects reportUrl", () => {
    const route = read(
      join(process.cwd(), "src/app/api/workspaces/[slug]/runs/[runId]/report/route.ts"),
    );
    expect(route).not.toMatch(/^\s*reportUrl:\s*true/m);
    expect(route).toContain("private, no-store");
  });

  it("the report page never selects reportUrl", () => {
    const page = read(
      join(
        process.cwd(),
        "src/app/w/[slug]/legal/benchmarks/runs/[runId]/report/page.tsx",
      ),
    );
    expect(page).not.toMatch(/^\s*reportUrl:\s*true/m);
  });
});
