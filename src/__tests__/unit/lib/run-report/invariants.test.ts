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

  it("never references the bundle URL or any storage URL variant in rendered output", () => {
    // Guards the documents surface — a new url-key spelling must never reach the DOM.
    const pattern =
      /reportUrl|report_url|s3_url|s3url|signed_url|signedurl|presigned_url|presignedurl|download_url|downloadurl/;
    const offenders = files.filter((f) => pattern.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("uses formatInUserTz, never the UTC-hardcoded formatFeatureDate", () => {
    const offenders = files.filter((f) => /formatFeatureDate/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("has a SectionErrorBoundary exported from chrome.tsx", () => {
    const chrome = read(join(RENDERER_DIR, "chrome.tsx"));
    expect(chrome).toMatch(/export class SectionErrorBoundary/);
    expect(chrome).toMatch(/getDerivedStateFromError/);
  });

  it("RunReportView wraps every section with SectionErrorBoundary", () => {
    const view = read(join(RENDERER_DIR, "RunReportView.tsx"));
    expect(view).toMatch(/SectionErrorBoundary/);
    // Each of the 8 section components must be wrapped — confirm at least 8
    // closing tags appear (one per boundary around each section).
    const closeMatches = (view.match(/<\/SectionErrorBoundary>/g) ?? []).length;
    expect(closeMatches).toBeGreaterThanOrEqual(9);
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

  it("never imports hast utilities — pipeline modules are client-reachable", () => {
    // chain.ts is imported by RunReportView.tsx ("use client"), so the whole
    // pipeline directory must stay free of hast. This guard covers both the
    // components/ directory (checked above) and the lib/run-report pipeline.
    // Scope: direct import strings only (text-based grep, NOT transitive).
    //
    // Permitted exceptions (explicitly server-only, NOT reachable from chain.ts):
    //   - sanitize.ts       — HTML sanitizer; imported only by project.ts
    //   - sanitize-schema.ts — pinned hast schema; imported only by sanitize.ts
    // These two files legitimately use hast-util. Every other pipeline module
    // must remain client-bundle safe.
    const SERVER_ONLY_HAST_USERS = new Set([
      join(PIPELINE_DIR, "sanitize.ts"),
      join(PIPELINE_DIR, "sanitize-schema.ts"),
    ]);
    const offenders = files.filter(
      (f) => !SERVER_ONLY_HAST_USERS.has(f) && /from "hast-util|from 'hast-util/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("concept-facts.ts does not import @/lib/logger", () => {
    // concept-facts.ts is imported by chain.ts → RunReportView.tsx ("use client").
    // @/lib/logger uses pino (server-only); importing it would break the client build.
    // Scope: direct import strings only — text-based grep, not transitive traversal.
    const cfPath = join(PIPELINE_DIR, "concept-facts.ts");
    const content = read(cfPath);
    expect(content).not.toMatch(/from ["']@\/lib\/logger["']/);
  });

  it("concept-facts.ts does not import ./project", () => {
    // project.ts pulls in zod + sanitizeDocumentHtml → hast-util-from-html /
    // hast-util-sanitize. Importing it from concept-facts.ts would bypass the
    // hast guard above (the hast guard globs only this pipeline dir; concept-facts
    // importing project would drag hast in transitively, which a text-only grep
    // cannot see — so we check the direct import as an explicit invariant).
    // Scope: direct import strings only.
    const cfPath = join(PIPELINE_DIR, "concept-facts.ts");
    const content = read(cfPath);
    expect(content).not.toMatch(/from ["']\.\/project["']/);
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
  it("the runs list select does not include webhookUrl, and reportUrl is stripped by the mapper", () => {
    const service = read(join(process.cwd(), "src/services/stakwork-run.ts"));
    // Re-anchored on `getStakworkRuns` — the first `findMany` in the file is
    // `getFeatureRunHistory`, not the list query. Anchoring on the wrong call
    // site produced a vacuously-passing test that gave false assurance on
    // exactly this bug class.
    const fnStart = service.indexOf("export async function getStakworkRuns");
    expect(fnStart).toBeGreaterThan(-1);
    const start = service.indexOf("const runs = await db.stakworkRun.findMany", fnStart);
    expect(start).toBeGreaterThan(-1);
    const select = service.slice(start, start + 1400);

    // webhookUrl must never appear in the select — it embeds a raw run_token HMAC.
    expect(select).not.toMatch(/^\s*webhookUrl:\s*true/m);

    // reportUrl IS selected (to derive the hasReport boolean) but must be
    // destructured out by the mapper so the raw URL never reaches the caller.
    // Assert the select includes it AND the mapper strips it.
    expect(select).toMatch(/^\s*reportUrl:\s*true/m);
    // The mapper must destructure reportUrl out of the run object before returning.
    expect(select).toMatch(/\(\s*\{\s*reportUrl\s*,/);
  });

  it("the re-anchored invariant fails when webhookUrl leaks into the list select — negative case", () => {
    const service = read(join(process.cwd(), "src/services/stakwork-run.ts"));
    const fnStart = service.indexOf("export async function getStakworkRuns");
    expect(fnStart).toBeGreaterThan(-1);
    const start = service.indexOf("const runs = await db.stakworkRun.findMany", fnStart);
    expect(start).toBeGreaterThan(-1);
    const select = service.slice(start, start + 1400);
    // Proves the invariant is non-vacuous: if we inject the forbidden key into
    // the scanned window, the pattern DOES match.
    const poisoned = select + "\n      webhookUrl: true,";
    expect(poisoned).toMatch(/^\s*webhookUrl:\s*true/m);
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
