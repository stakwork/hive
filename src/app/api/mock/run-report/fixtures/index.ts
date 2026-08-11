/**
 * Run report bundle fixtures — schema v1.
 *
 * `full` is hand-authored (see ./full). The rest are derived from it by
 * deletion/substitution so they cannot drift out of sync with the base shape.
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

/**
 * `concepts: {}` — an EMPTY OBJECT, which is the generator's default (the
 * concepts pass is opt-in behind `--concepts`) and therefore the COMMON shape.
 * Deliberately not a deleted key: "present and empty" must render as "not run",
 * while "absent" is what feeds the drift diagnostic.
 */
const NO_CONCEPTS: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.concepts = {};
  return b;
})();

/** Every rubric passes — exercises the all-green summary and empty failures. */
const ALL_PASS: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  const analysis = b.analysis as { summaries: Array<Record<string, unknown>> };
  analysis.summaries = analysis.summaries.map((s) => ({
    id: s.id,
    title: s.title,
    verdict: "pass",
    reasoning: "Satisfied.",
  }));
  b.rubric_links = {};
  return b;
})();

/**
 * Deterministic-only run: no summaries and, critically, `traces: []`.
 * An empty traces array is a LEGITIMATE empty state and must never route to
 * the error state.
 */
const NO_ANALYSIS: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.analysis = { summaries: [], traces: [] };
  b.rubric_links = {};
  return b;
})();

/** Exercises the schema version gate. */
const UNKNOWN_SCHEMA: Bundle = (() => {
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

/** Hardcoded literal record — the only way a variant name resolves. */
export const RUN_REPORT_FIXTURES = {
  full: FULL_BUNDLE as Bundle,
  "no-concepts": NO_CONCEPTS,
  "all-pass": ALL_PASS,
  "no-analysis": NO_ANALYSIS,
  "unknown-schema": UNKNOWN_SCHEMA,
  "split-token": SPLIT_TOKEN,
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
