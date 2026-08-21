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

// ── Tool activity projection types ───────────────────────────────────────────

export type { ToolCallStatus, RetrievalBasis, RetrievalStatus, OrderingBasis, IdentityKind } from "./tool-activity";
export type {
  NormalizedNode,
  NormalizedToolCall,
  ToolActivityGroup,
  NodeIdentityRow,
} from "./tool-activity";

/**
 * Projected tool-activity: the fully-normalized, classified, and capped
 * output of `readToolActivity()`, plus data-quality counters that live here
 * (not on `contractNotes`) because they have readers in the UI.
 *
 * When absent (v1 / no-concepts bundles), `present: false` and all arrays
 * are empty so the renderer can branch on a single field.
 */
export interface ToolActivityProjection {
  present: boolean;
  /** `schema_version` from the bundle, carried for display-only diagnostics. */
  schemaVersion: number | null;
  groups: import("./tool-activity").ToolActivityGroup[];
  nodeIdentities: import("./tool-activity").NodeIdentityRow[];
  orderingBasis: import("./tool-activity").OrderingBasis;
  // ── Data-quality counters ──────────────────────────────────────────────────
  unidentifiedNodeCount: number;
  unattributedRecordCount: number;
  unknownToolNames: string[];
  ambiguousIdentityCount: number;
  withheldInputFieldCount: number;
  allSurfacedHint: boolean;
  truncated: {
    groups: number;
    callsPerAgent: number[];
    nodesPerCall: number;
  };
  /**
   * Which source supplied the node-identity rows for this bundle.
   * Set by project.ts after calling selectNodeIdentities().
   * Optional so existing exhaustive test literals keep compiling unchanged.
   */
  nodeIdentitiesSource?: "bundle" | "derived";
  /**
   * When bundle-supplied node_identities were present but rejected, the
   * rejection reason string. Null when source is "bundle" (accepted).
   * Optional — defaulted to null at read sites.
   */
  nodeIdentitiesRejectedReason?: string | null;
  /**
   * Count of identity rows dropped because the projection array cap was hit.
   * Optional — defaulted to 0 at read sites.
   */
  identitiesTruncated?: number;
  /**
   * True when the bundle's top_concepts key set differs from the locally-derived
   * concept list. A set-membership mismatch (not order/total/slice differences).
   * Optional — defaulted to false at read sites.
   */
  topConceptsMismatch?: boolean;
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
  /**
   * Tool activity derived server-side from `concepts.tool_activity`.
   * Empty when the bundle lacks the section (v1 / no-concepts fixtures).
   */
  toolActivity: ToolActivityProjection;
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
  /** What the criterion asked for. Empty-string when absent, like reasoning. */
  matchCriteria: string;
  /** Judge-review keys from the run_judge_dispute stage. Genuinely absent on
   * runs without the dispute stage; interpreted ONLY by resolveJudgeDispute. */
  judgeFlagged?: boolean | number | string;
  judgeFlagReason?: string;
  /**
   * Narrowed from wire `flag_basis` — tooltip/display copy only; never a
   * suppression input for the dispute badge. Empty string on all current
   * production runs (upstream Task Runner jsonSchema fix pending).
   */
  judgeFlagBasis?: string;
  /**
   * Narrowed from wire `contested` — set by the contest agent when the
   * criterion *definition* itself is considered broken. Independent of verdict.
   * Provenance prefix keeps it distinct from the raw wire key. Primitives only;
   * an object/array can never ride the projection.
   */
  criterionContested?: boolean | number | string;
  /** Supporting excerpt from the dispute review; empty-string when absent. */
  documentExcerpt: string;
}

// ── Consolidated Report types ─────────────────────────────────────────────────

/**
 * One run's metadata as included in a consolidated report.
 * `timestamp` is epoch-ms, latest-first.
 */
export interface RunMeta {
  runId: string;
  timestamp: number;
  model: string;
  score: number;
  nPassed: number;
  nTotal: number;
}

/**
 * One rubric criterion row in the cross-run matrix.
 * `results` has one entry per run (matching `ConsolidatedReportProjection.runs`).
 */
export interface RubricMatrixRow {
  id: string;
  title: string;
  results: Array<{ runId: string; passed: boolean; verdict: string }>;
}

/**
 * Per-run detail for a single failing criterion.
 */
export interface RubricDetailPerRun {
  runId: string;
  verdict: string;
  reasoning: string;
  judgeFlagReason: string;
  criterionContested: boolean;
}

/**
 * Detail block for one failing criterion, with per-run breakdown.
 */
export interface RubricDetailBlock {
  id: string;
  title: string;
  matchCriteria: string;
  perRun: RubricDetailPerRun[];
}

/**
 * Projection for a `LEGAL_BENCHMARK_CONSOLIDATED` run report.
 *
 * Defined as a **standalone interface** (not extending `RunReportProjection`)
 * to avoid inflating RSC payload size with unrelated fields and to create
 * a clear type boundary.
 *
 * The `consolidated: true` discriminant enables exhaustive narrowing at
 * call sites without unsafe casts.
 */
export interface ConsolidatedReportProjection {
  consolidated: true;
  taskDescription: string;
  sourceFileLinks: string[];
  runs: RunMeta[];
  rubricMatrix: RubricMatrixRow[];
  /**
   * Only criteria where at least one run failed are included.
   * Sorted alphabetically by title — deterministic across multiple consolidated reports.
   */
  rubricDetails: RubricDetailBlock[];
}

/**
 * Union of all bundle projection shapes.
 * Use the `consolidated` discriminant for exhaustive narrowing:
 *   if (p.consolidated) { ... ConsolidatedReportProjection ... }
 *   else { ... RunReportProjection ... }
 */
export type BundleProjection = RunReportProjection | ConsolidatedReportProjection;

/**
 * What the API route and the RSC page hand to the renderer.
 *
 * `projection` is built at view time from the S3 JSON — it is never persisted.
 * `error` distinguishes "this run has no report" from "the report exists but
 * could not be loaded", which the UI renders differently.
 *
 * `projection` carries `BundleProjection` so callers that receive a
 * `ConsolidatedReportProjection` can access it; use the `consolidated`
 * discriminant to narrow before passing to `RunReportView`.
 */
export interface RunReportPayload {
  runId: string;
  hasReport: boolean;
  /** Set when a report exists but could not be fetched, parsed or projected. */
  error?: "unavailable" | "unsupported_schema" | "url_rejected";
  projection: BundleProjection | null;
}
