/**
 * Run report bundle fixtures — real contract shape.
 *
 * `full` is hand-authored against the reference contract (see
 * `./reference/CONTRACT.md`). The rest are derived from it by deletion /
 * substitution so they cannot drift out of sync with the base shape.
 *
 * Resolution is through a HARDCODED literal record of statically-imported
 * values — never a filesystem path built from the request, which would be a
 * traversal primitive.
 */

import { FULL_BUNDLE } from "./full";

type Bundle = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Derived fixtures ─────────────────────────────────────────────────────────

/**
 * `concepts: {}` — an EMPTY OBJECT, which is the generator's default (the
 * concepts pass is opt-in behind `--concepts`) and therefore the COMMON shape.
 * Deliberately not a deleted key: "present and empty" must render as "not run",
 * while "absent" feeds the drift diagnostic.
 */
const NO_CONCEPTS: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.concepts = {};
  return b;
})();

/**
 * Every rubric passes — exercises the all-green summary and the empty failures
 * section. Sources verdicts from `page_data.rubrics` (not `analysis.summaries`,
 * which are agent activity records in the real contract).
 */
const ALL_PASS: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;

  const pageData = b.page_data as Record<string, unknown>;
  const rubrics = pageData.rubrics as Array<Record<string, unknown>>;
  const n = rubrics.length;

  pageData.rubrics = rubrics.map((r) => ({
    ...r,
    verdict: "pass",
    reasoning: "Satisfied.",
  }));

  pageData.score = {
    ...(pageData.score as Record<string, unknown>),
    score: n,
    max_score: n,
    all_pass: true,
    n_criteria: n,
    n_passed: n,
  };

  // No failures → no rubric links needed.
  b.rubric_links = {};
  return b;
})();

/**
 * Deterministic-only run: no rubrics, no timeline, no agents, no analysis.
 *
 * An empty analysis is a LEGITIMATE empty state and must never route to the
 * error state. This fixture exercises every "no data" branch in the renderer.
 */
const NO_ANALYSIS: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;

  const pageData = b.page_data as Record<string, unknown>;
  pageData.rubrics = [];
  pageData.timeline = [];
  pageData.agents = [];

  pageData.score = {
    score: 0,
    max_score: 0,
    all_pass: false,
    n_criteria: 0,
    n_passed: 0,
    judge_model: null,
    scored_at: null,
  };

  b.analysis = { summaries: [], traces: [] };
  b.rubric_links = {};
  return b;
})();

/**
 * Bumped schema version on an otherwise-full, valid bundle.
 *
 * Replaces the old `unknown-schema` fixture which asserted an error gate.
 * This fixture now asserts the OPPOSITE: a bundle with any `schema_version`
 * (including an unknown future version) RENDERS NORMALLY — the gate is gone.
 */
const BUMPED_SCHEMA: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.schema_version = 99;
  return b;
})();

/**
 * A rubric token split across inline tags in the document HTML.
 *
 * The generator matches link tokens against a plain-text rendition (`d['plain']`)
 * and then strips `plain` before shipping, so tokens routinely straddle text
 * nodes. Here "terminate for convenience" is broken by an `<em>`, which a
 * per-node substring search cannot find — only the flattened text index can.
 *
 * Basis is unchanged: still mutates `source_docs` + `rubric_links`.
 */
const SPLIT_TOKEN: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.source_docs = [
    {
      id: "doc-split",
      title: "Split token document.docx",
      html: `<!doctype html><html><head><title>Split</title></head><body>
  <h1>Termination</h1>
  <p>12.4 Either party may <em>terminate</em> for <strong>convenience</strong> on thirty (30) days notice.</p>
  <p>No match for this one should be found.</p>
</body></html>`,
    },
  ];
  b.rubric_links = {
    R2: [{ doc: "doc-split", tokens: ["terminate for convenience"] }],
    R3: [{ doc: "doc-split", tokens: ["a passage that does not exist anywhere"] }],
  };
  return b;
})();

/**
 * Fully-degraded empty-array path.
 *
 * `branches` and `health_notes` are bare strings (the default), `concepts`
 * is `{}` (not run), and `security` is `[]` (no findings). Proves the renderer
 * handles every "empty" branch without errors.
 */
const STRINGS_ONLY: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;

  const pageData = b.page_data as Record<string, unknown>;
  // branches and health_notes are already plain strings in the full fixture;
  // keep them as-is to confirm the default path renders cleanly.
  pageData.security = [];

  b.concepts = {};
  return b;
})();

/**
 * Clone of `full` with two invented top-level keys not in the known contract.
 *
 * Used by the T2 drift-diagnostic test to assert:
 *   - the invented keys land on `contractNotes.unexpected` (key names only)
 *   - their values never appear anywhere in `JSON.stringify(projection)`
 */
const UNKNOWN_KEYS: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.rogue_field = "<script>alert('rogue')</script>";
  b.experimental_stage = { nested: "data", secret: "AKIAIOSFODNN7ROGUE" };
  return b;
})();

/**
 * Deterministic run: real page_data (agents included) with the analysis
 * phases deliberately skipped (run_llm=false). The agents section must render
 * the roster from page_data.agents[] — not an empty state. The first agent's
 * `tools` uses the producer's current record form ({toolName: count}); the
 * remaining agents keep the legacy array form, which renders without a tools
 * fold (tolerated, never an error).
 */
const DETERMINISTIC: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  const pageData = b.page_data as Record<string, unknown>;
  const agents = pageData.agents as Array<Record<string, unknown>>;
  agents[0].tools = { graph_search: 5, bash: 3 };
  b.analysis = { summaries: [], traces: [] };
  b.concepts = {};
  return b;
})();

// ── Export map ───────────────────────────────────────────────────────────────

/** Hardcoded literal record — the only way a variant name resolves. */
export const RUN_REPORT_FIXTURES = {
  full: FULL_BUNDLE as Bundle,
  "no-concepts": NO_CONCEPTS,
  "all-pass": ALL_PASS,
  "no-analysis": NO_ANALYSIS,
  deterministic: DETERMINISTIC,
  "bumped-schema": BUMPED_SCHEMA,
  "split-token": SPLIT_TOKEN,
  "strings-only": STRINGS_ONLY,
  "unknown-keys": UNKNOWN_KEYS,
} as const;

export type RunReportFixtureName = keyof typeof RUN_REPORT_FIXTURES;

export const RUN_REPORT_FIXTURE_NAMES = Object.keys(
  RUN_REPORT_FIXTURES,
) as RunReportFixtureName[];

export function getRunReportFixture(name: string): Bundle | null {
  return Object.prototype.hasOwnProperty.call(RUN_REPORT_FIXTURES, name)
    ? RUN_REPORT_FIXTURES[name as RunReportFixtureName]
    : null;
}
