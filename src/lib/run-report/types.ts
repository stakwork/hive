/**
 * Run report bundle — wire shape (schema v1) and the persisted projection.
 *
 * The wire shape mirrors the generator's `build_report.py` output:
 *   { schema_version, page_data, analysis, concepts, source_docs, workfiles,
 *     rubric_links }
 * where `page_data` carries `set_var`, `security`, `branches`, `health_notes`,
 * `log_stats`, `outputs`; `source_docs[]` are `{id, title, html}` with the
 * plain-text twin deliberately stripped before shipping; `workfiles[]` carry
 * `text`; and `rubric_links` is the rubric→document map.
 */

/** The only schema version this build's projector understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;

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

// ── Persisted projection ─────────────────────────────────────────────────────

export interface ProjectedSourceDoc {
  id: string;
  title: string;
  /** Sanitized body children. Absent when the projection was truncated. */
  body?: SanitizedNode[];
}

export interface ProjectedRubricLink {
  doc: string;
  tokens: string[];
}

/**
 * Diagnostic that distinguishes *absent* from *present-and-empty* per top-level
 * key, plus any unexpected top-level keys. Absent-alongside-an-unexpected-
 * sibling is what raises the drift banner; present-and-empty is normal.
 */
export interface ContractNotes {
  absent: string[];
  presentButEmpty: string[];
  unexpected: string[];
}

export interface RunReportProjection {
  schemaVersion: number;
  /** Epoch-ms normalized at ingest. Never re-derived by string slicing. */
  generatedAtMs: number | null;
  pageData: {
    setVar: Record<string, unknown>;
    security: Record<string, unknown>;
    branches: unknown[];
    healthNotes: unknown[];
    logStats: Record<string, unknown>;
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
  stats: RunReportStats;
  contractNotes: ContractNotes;
  /** Source document bodies were dropped to fit the size cap. */
  partial: boolean;
}

export interface RunReportStats {
  sourceDocCount: number;
  workfileCount: number;
  traceCount: number;
  branchCount: number;
  rubricCount: number;
  /** Null when the bundle carries no rubric verdicts at all. */
  passCount: number | null;
  failCount: number | null;
}

/** What the API route and the RSC page hand to the renderer. */
export interface RunReportPayload {
  runId: string;
  hasReport: boolean;
  partial: boolean;
  schemaUnsupported: boolean;
  /** Null when there is no bundle, or the schema version is unsupported. */
  projection: RunReportProjection | null;
}
