/**
 * Run report bundle — wire shape and the persisted projection.
 *
 * The wire shape mirrors the generator's `build_report.py` output:
 *   { schema_version, page_data, analysis, concepts, source_docs, workfiles,
 *     rubric_links }
 * where `page_data` carries `config, score, rubrics, timeline, agents,
 * documents, branches, health_notes, wall_clock_min, log_stats, security,
 * outputs`; `source_docs[]` are `{id, title, html}` with the plain-text twin
 * deliberately stripped before shipping; `workfiles[]` carry `text`; and
 * `rubric_links` is the rubric→document map.
 *
 * `schema_version` is accepted at any value — the gate was removed because
 * blanking the whole report on a minor version bump is worse than rendering
 * with graceful degradation on unknown keys.
 */

/**
 * Roles allowed to read a run report bundle.
 *
 * Deliberately NOT `getWorkspaceSwarmAccess`, which the sibling legal-benchmark
 * routes use. Those routes call the swarm API and genuinely need its config;
 * this one reads only from the database. Gating on swarm config would couple a
 * read-only view to unrelated infrastructure state (a workspace with an ACTIVE
 * swarm but no `swarmUrl` would 404), and would decrypt a swarm API key on
 * every page load only to discard it.
 *
 * The real requirement is authorization STRENGTH: bundles carry converted legal
 * source documents and agent transcripts, which are not a VIEWER- or
 * STAKEHOLDER-tier artifact. That is a role check, so this states it directly.
 */
export const RUN_REPORT_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "PM",
  "DEVELOPER",
] as const;

export function canReadRunReport(role: string): boolean {
  return (RUN_REPORT_ALLOWED_ROLES as readonly string[]).includes(role);
}

// ── Sanitized node shape ─────────────────────────────────────────────────────

/**
 * The closed node shape the renderer consumes. Deliberately narrow: raw hast is
 * never serialized over the wire, so hast utilities stay out of the client
 * bundle and the "no dangerouslySetInnerHTML" guarantee becomes structural
 * rather than conventional.
 *
 * `t` tag, `a` allowlisted attributes, `c` children. A bare string is a text node.
 */
export type SanitizedNode = string | SanitizedElement;

export interface SanitizedElement {
  t: string;
  a?: Record<string, string>;
  c?: SanitizedNode[];
}

// ── page_data typed sub-shapes ───────────────────────────────────────────────

/**
 * Judge scoring block from `page_data.score`.
 */
export interface ScoreBlock {
  score: number | null;
  max_score: number | null;
  all_pass: boolean | null;
  n_criteria: number | null;
  n_passed: number | null;
  judge_model: string | null;
  scored_at: string | null;
}

/**
 * A single security finding from `page_data.security[]`.
 * `severity` is the most-used display field; other keys pass through as unknown.
 */
export interface SecurityFinding {
  kind?: string;
  where?: string;
  count?: number;
  severity?: string;
  detail?: string;
  [k: string]: unknown;
}

/**
 * One entry from `page_data.timeline[]`.
 * `start`/`end` are UTC strings in space-separated form or ISO8601.
 */
export interface TimelineStep {
  step: string;
  start: string | null;
  end: string | null;
  duration_s: number | null;
}

/**
 * Projected document metadata from `page_data.documents[]`.
 * URL/href fields are deliberately omitted — they are redacted at projection time.
 */
export interface ProjectedDocument {
  name: string;
  type?: string;
  sizeBytes?: number;
}

// ── analysis typed sub-shapes (bundle-root, not page_data) ──────────────────

/**
 * Per-rubric failure trace from `analysis.traces[]` — `TRACE_SCHEMA` in analyze.py.
 */
export interface TraceRow {
  rubric_id: string;
  pathway: Array<{ station: string; status: string; evidence: unknown }>;
  q_ingested_to_graph: { answer: string; evidence: string } | null;
  q_knowable_or_derived: { answer: string; evidence: string } | null;
  q_draft_got_it: { answer: string; evidence: string } | null;
  q_verify_got_it: { answer: string; evidence: string } | null;
  root_cause: string;
  classification: string;
  fix_suggestions: string[];
}

/**
 * Per-agent activity summary from `analysis.summaries[]` — `SUMMARY_SCHEMA` in analyze.py.
 * These are agent activity records, NOT rubric verdict records.
 */
export interface AgentSummary {
  agent_name: string;
  mission: string;
  tools: Array<{ name: string; count: number; purpose: string }>;
  files_touched: Array<{ path: string; action: string; note: string }>;
  context_gathered: string;
  key_findings: string[];
  anomalies: string[];
  failed_rubric_relevance: Array<{ rubric_id: string; note: string }>;
}

/**
 * Concepts synthesis object from `concepts.synthesis` (when concepts pass ran).
 */
export interface ConceptSynthesis {
  overall_narrative: string;
  concept_matrix: Array<{
    concept: string;
    agents: string[];
    verdict: string;
    note: string;
  }>;
  relation_to_failures: Array<{ rubric_id: string; finding: string }>;
  recommendations: string[];
}

// ── Persisted projection ─────────────────────────────────────────────────────

export interface ProjectedSourceDoc {
  id: string;
  title: string;
  /** Sanitized body children. */
  body: SanitizedNode[];
}

export interface ProjectedRubricLink {
  doc: string;
  tokens: string[];
}

export interface RunReportProjection {
  /** Epoch-ms normalized at ingest. Never re-derived by string slicing. */
  generatedAtMs: number | null;
  pageData: {
    /** Run configuration (`config` block). Key-redacted + token-shape pass. */
    config: Record<string, unknown>;
    /** Judge scoring summary. Key-redacted only (no token shapes expected). */
    score: ScoreBlock;
    /** Per-criterion rubric results, pre-group. Verdicts live here, not in analysis. */
    rubrics: unknown[];
    /** Step timing entries. */
    timeline: TimelineStep[];
    /**
     * Per-agent metadata (no raw messages). Token-shape pass on metadata fields
     * only — `final_answer` is prose and must NOT be regex-swept.
     */
    agents: unknown[];
    /**
     * Document metadata only — name/type/sizeBytes. No url/href field reaches
     * the client; redaction is applied at projection time.
     */
    documents: ProjectedDocument[];
    /** Branch condition strings — plain strings, never objects. */
    branches: string[];
    /** Health observation strings — plain strings, never objects. */
    healthNotes: string[];
    /** Total wall-clock duration in minutes. */
    wallClockMin: number | null;
    /** Log processing stats. Key-redacted + token-shape pass. */
    logStats: Record<string, unknown>;
    /** Security findings array. Routed through redactArray (not redactRecord). */
    security: SecurityFinding[];
    /** Arbitrary output key-value record. Key-redacted + token-shape pass. */
    outputs: Record<string, unknown>;
  };
  analysis: {
    summaries: unknown[];
    traces: unknown[];
  };
  concepts: Record<string, unknown>;
  sourceDocs: ProjectedSourceDoc[];
  workfiles: Array<{ name?: string; text: string }>;
  rubricLinks: Record<string, ProjectedRubricLink[]>;
  /** Rubric rows derived server-side — the single source of rubric derivation. */
  rubricRows: RubricRow[];
  stats: RunReportStats;
  /**
   * Drift diagnostic. Unknown bundle keys land here (key names only, never
   * values). A non-empty array signals producer drift without crashing the page.
   */
  contractNotes: {
    unexpected: string[];
  };
}

export interface RunReportStats {
  sourceDocCount: number;
  workfileCount: number;
  traceCount: number;
  /** Count of plain-string notes in `branches` (formerly `branchCount`). */
  noteCount: number;
  /** Count of `timeline[]` steps. */
  stepCount: number;
  /** Count of `agents[]` entries. */
  agentCount: number;
  rubricCount: number;
  /** Null when the bundle carries no rubric verdicts at all. */
  passCount: number | null;
  failCount: number | null;
}

// ── RubricRow (lives here so both project.ts and derive.ts share it) ─────────

export interface RubricRow {
  id: string;
  title: string;
  passed: boolean;
  /** Empty-string when the bundle carries no verdict (graceful degradation). */
  verdict: string;
  reasoning: string;
}

/**
 * What the API route and the RSC page hand to the renderer.
 *
 * `projection` is built at view time from the S3 JSON — it is never persisted.
 * `error` distinguishes "this run has no report" from "the report exists but
 * could not be loaded", which the UI renders differently.
 */
export interface RunReportPayload {
  runId: string;
  hasReport: boolean;
  /** Set when a report exists but could not be fetched, parsed or projected. */
  error?: "unavailable" | "unsupported_schema" | "url_rejected";
  projection: RunReportProjection | null;
}
