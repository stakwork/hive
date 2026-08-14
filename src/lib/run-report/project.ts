/**
 * Bundle → persisted projection.
 *
 * Pipeline order: loose parse → sanitize → redact → strict projection →
 * size/truncation check.
 *
 * Parsing is loose (unknown upstream keys do not fail the bundle) but the
 * PERSISTED object is built from an explicit known-field projection that drops
 * them. An undocumented field could carry HTML or credential-shaped text that
 * would otherwise bypass the sanitizer entirely.
 *
 * Unknown keys are collected on `contractNotes.unexpected` and emitted as a
 * single structured warning per projection (key names only, never values — an
 * unknown key is exactly the kind of field that could carry credential-shaped
 * text).
 */

import { z } from "zod";
import { sanitizeDocumentHtml } from "./sanitize";
import { redactSensitiveKeys } from "./redact";
import {
  toEpochMs,
  groupRubrics,
  computeStats,
  isRecord,
  asString,
  readArray,
  readRosterNames,
} from "./derive";
import {
  readToolActivity,
  buildNodeIdentities,
  countWithheldInputFields,
  readRawToolActivityRecords,
  TOOL_ACTIVITY_CONTAINER_KEYS,
  TOOL_ACTIVITY_CALLS_PER_AGENT_CAP,
  TOOL_ACTIVITY_NODES_PER_CALL_CAP,
} from "./tool-activity";
import {
  deriveAllSurfacedHint,
  NODE_IDENTITIES_CONTAINER_KEYS,
  TOP_CONCEPTS_CONTAINER_KEYS,
  ACTIVITY_DIAGNOSTICS_CONTAINER_KEYS,
} from "./concept-facts";
import type {
  RunReportProjection,
  ProjectedSourceDoc,
  ProjectedRubricLink,
  TimelineStep,
  ProjectedDocument,
  ScoreBlock,
  SecurityFinding,
  ToolActivityProjection,
} from "./types";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of entries projected for array sections.
 *
 * The bundle is fetched at view time with no cache, so uncapped arrays
 * (timeline, agents, traces, documents) raise per-render cost linearly.
 * Entries beyond this ceiling are dropped and noted on `contractNotes`.
 */
export const PROJECTION_ARRAY_CAP = 500;

/** Maximum calls per agent group in the tool-activity projection. */
export const TOOL_ACTIVITY_CALL_CAP = TOOL_ACTIVITY_CALLS_PER_AGENT_CAP;
/** Maximum nodes per call in the tool-activity projection. */
export const TOOL_ACTIVITY_NODE_CAP = TOOL_ACTIVITY_NODES_PER_CALL_CAP;

// ── Known key sets (for drift diagnostic) ────────────────────────────────────

const KNOWN_BUNDLE_ROOT_KEYS = new Set([
  "schema_version",
  "generated_at",
  "page_data",
  "analysis",
  "concepts",
  "source_docs",
  "workfiles",
  "rubric_links",
]);

const KNOWN_PAGE_DATA_KEYS = new Set([
  "config",
  "score",
  "rubrics",
  "timeline",
  "agents",
  "documents",
  "branches",
  "health_notes",
  "wall_clock_min",
  "log_stats",
  "security",
  "outputs",
  // Allow generated_at at page_data level too (some bundle variants include it)
  "generated_at",
]);

// ── ProjectOutcome ───────────────────────────────────────────────────────────

export type ProjectOutcome =
  | { status: "ok"; projection: RunReportProjection; droppedElements: number }
  | { status: "unparseable" };

// ── Loose top-level schema ───────────────────────────────────────────────────

/** Loose top-level shape — everything optional, unknown keys preserved. */
const BundleSchema = z.looseObject({
  schema_version: z.number().optional(),
});

// ── Main projector ───────────────────────────────────────────────────────────

export function projectBundle(rawText: string): ProjectOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { status: "unparseable" };
  }

  const loose = BundleSchema.safeParse(parsed);
  if (!loose.success || !isRecord(parsed)) return { status: "unparseable" };

  // ── Drift diagnostic ──────────────────────────────────────────────────────
  // Collect unknown key names from both the bundle root and page_data.
  // Values are never logged — an unknown key is exactly the kind of field
  // that could carry credential-shaped text.
  const contractNotes: { unexpected: string[] } = { unexpected: [] };

  const unexpectedRoot = Object.keys(parsed).filter((k) => !KNOWN_BUNDLE_ROOT_KEYS.has(k));
  const pageDataRaw = isRecord(parsed.page_data) ? parsed.page_data : {};
  const unexpectedPageData = Object.keys(pageDataRaw).filter(
    (k) => !KNOWN_PAGE_DATA_KEYS.has(k),
  );

  if (unexpectedRoot.length > 0 || unexpectedPageData.length > 0) {
    const allUnexpected = [
      ...unexpectedRoot.map((k) => `root.${k}`),
      ...unexpectedPageData.map((k) => `page_data.${k}`),
    ];
    contractNotes.unexpected = allUnexpected;
    console.warn("[run-report] Unexpected bundle keys detected", {
      keys: allUnexpected,
    });
  }

  // ── page_data ─────────────────────────────────────────────────────────────
  // config / log_stats / outputs: key-redact + token-shape pass.
  // score:                        key-redact only (no token shapes expected).
  // rubrics:                      pass through for groupRubrics (typed below).
  // timeline / agents:            typed arrays, token-shape on metadata only.
  // documents:                    projected to {name, type, sizeBytes} only.
  // branches / health_notes:      narrowed to string[] at the boundary.
  // security:                     redactArray (not redactRecord — arrays are excluded
  //                               by isRecord and would silently return {}).
  // wall_clock_min:               number | null pass-through.

  const config = redactRecord(pageDataRaw.config, true);
  const score = projectScore(pageDataRaw.score);
  const rubrics = readArray(pageDataRaw, "rubrics");

  const rawTimeline = readArray(pageDataRaw, "timeline");
  const [timeline, timelineTruncated] = capArray(rawTimeline, PROJECTION_ARRAY_CAP);
  if (timelineTruncated > 0) {
    contractNotes.unexpected.push(
      `timeline: truncated from ${rawTimeline.length} to ${PROJECTION_ARRAY_CAP}`,
    );
  }
  const projectedTimeline = projectTimeline(timeline);

  const rawAgents = readArray(pageDataRaw, "agents");
  const [agentsArr, agentsTruncated] = capArray(rawAgents, PROJECTION_ARRAY_CAP);
  if (agentsTruncated > 0) {
    contractNotes.unexpected.push(
      `agents: truncated from ${rawAgents.length} to ${PROJECTION_ARRAY_CAP}`,
    );
  }
  const projectedAgents = projectAgents(agentsArr);

  const rawDocuments = readArray(pageDataRaw, "documents");
  const [documentsArr, documentsTruncated] = capArray(rawDocuments, PROJECTION_ARRAY_CAP);
  if (documentsTruncated > 0) {
    contractNotes.unexpected.push(
      `documents: truncated from ${rawDocuments.length} to ${PROJECTION_ARRAY_CAP}`,
    );
  }
  const projectedDocuments = projectDocuments(documentsArr);

  const branches = readArray(pageDataRaw, "branches").filter(
    (v): v is string => typeof v === "string",
  );
  const healthNotes = readArray(pageDataRaw, "health_notes").filter(
    (v): v is string => typeof v === "string",
  );

  const rawSecurity = readArray(pageDataRaw, "security");
  const projectedSecurity = projectSecurity(rawSecurity);

  const wallClockMin =
    typeof pageDataRaw.wall_clock_min === "number" ? pageDataRaw.wall_clock_min : null;
  const logStats = redactRecord(pageDataRaw.log_stats, true);
  const outputs = redactRecord(pageDataRaw.outputs, true);

  const pageData: RunReportProjection["pageData"] = {
    config,
    score,
    rubrics,
    timeline: projectedTimeline,
    agents: projectedAgents,
    documents: projectedDocuments,
    branches,
    healthNotes,
    wallClockMin,
    logStats,
    security: projectedSecurity,
    outputs,
  };

  // ── analysis ───────────────────────────────────────────────────────────────
  // traces: per-agent transcripts — deepest, most secret-dense → token-shape pass.
  // summaries: agent activity records (not verdicts) → key-redact only.
  const analysisRaw = isRecord(parsed.analysis) ? parsed.analysis : {};

  const rawTraces = readArray(analysisRaw, "traces");
  const [tracesArr, tracesTruncated] = capArray(rawTraces, PROJECTION_ARRAY_CAP);
  if (tracesTruncated > 0) {
    contractNotes.unexpected.push(
      `analysis.traces: truncated from ${rawTraces.length} to ${PROJECTION_ARRAY_CAP}`,
    );
  }

  const analysis = {
    summaries: redactArray(readArray(analysisRaw, "summaries"), false),
    traces: redactArray(tracesArr, true),
  };

  // ── tool_activity ──────────────────────────────────────────────────────────
  // Derive from the raw concepts subtree BEFORE any redaction runs, so
  // classification can see the pre-redaction inputs and withheld fields are
  // counted correctly.
  //
  // Detection is presence-based: derive when `concepts.tool_activity` (or an
  // aliased key) is present — do NOT branch on schema_version.
  //
  // Redaction is two-scoped:
  //   - tool inputs  → tokenShapes: true  (trace-class, new model-authored surface)
  //   - node names/identities → tokenShapes: false (identifier-class, must survive verbatim)
  const rawConceptsForActivity = isRecord(parsed.concepts) ? parsed.concepts : {};
  const hasToolActivity = TOOL_ACTIVITY_CONTAINER_KEYS.some(
    (k) => Array.isArray(rawConceptsForActivity[k]),
  );

  let toolActivity: ToolActivityProjection;
  if (hasToolActivity) {
    // Build the roster map from the already-projected analysis + agents.
    const rosterMap = readRosterNames(parsed.analysis, readArray(pageDataRaw, "agents"));

    // Derive raw tool records (pre-redaction).
    const rawActivity = readToolActivity(rawConceptsForActivity, rosterMap, TOOL_ACTIVITY_CALL_CAP, TOOL_ACTIVITY_NODE_CAP);

    // Apply withheld input field counts using pre-redaction inputs.
    // We walk each group's calls and update withheldInputFieldCount from
    // the raw (pre-redaction) input.
    // Since readToolActivity stores raw inputs in call.input at this point,
    // we count before redaction by reading from rawConceptsForActivity.
    let totalWithheld = 0;
    const rawRecords: unknown[] = readRawToolActivityRecords(rawConceptsForActivity);

    // Build a map from call position to withheld count.
    const withheldByPos = new Map<number, number>();
    for (let i = 0; i < rawRecords.length; i++) {
      const rec = rawRecords[i];
      if (typeof rec === "object" && rec !== null && !Array.isArray(rec)) {
        const recObj = rec as Record<string, unknown>;
        // Resolve raw input using candidate keys
        const rawInput = (() => {
          for (const k of ["input", "inputs", "args", "arguments", "params"]) {
            if (k in recObj && recObj[k] !== undefined && recObj[k] !== null) {
              const v = recObj[k];
              if (typeof v === "string") return { value: v };
              if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
              return { value: String(v) };
            }
          }
          return {};
        })();
        const wc = countWithheldInputFields(rawInput);
        if (wc > 0) {
          withheldByPos.set(i, wc);
          totalWithheld += wc;
        }
      }
    }

    // Apply withheld counts to call objects and redact inputs.
    for (const group of rawActivity.groups) {
      for (const call of group.calls) {
        const wc = withheldByPos.get(call.position) ?? 0;
        call.withheldInputFieldCount = wc;
        // Redact tool inputs: tokenShapes: true (trace-class).
        call.input = redactSensitiveKeys(call.input, { tokenShapes: true }) as Record<string, unknown>;
        // Redact node name/identity fields: tokenShapes: false (identifier-class).
        for (const node of call.nodes) {
          if (node.name) {
            const redacted = redactSensitiveKeys({ name: node.name }, { tokenShapes: false }) as { name?: string };
            node.name = redacted.name ?? node.name;
          }
          // identity and canonicalKey: key-based redaction only, no token shapes.
          if (node.identity) {
            const redacted = redactSensitiveKeys({ identity: node.identity }, { tokenShapes: false }) as { identity?: string };
            node.identity = redacted.identity ?? node.identity;
          }
        }
      }
    }

    // Cap agent groups at PROJECTION_ARRAY_CAP.
    const groupsTruncated = Math.max(0, rawActivity.groups.length - PROJECTION_ARRAY_CAP);
    const cappedGroups = groupsTruncated > 0
      ? rawActivity.groups.slice(0, PROJECTION_ARRAY_CAP)
      : rawActivity.groups;

    // Build run-wide identity list (from already-classified, now-capped groups).
    const nodeIdentities = buildNodeIdentities(cappedGroups);

    toolActivity = {
      present: true,
      schemaVersion: typeof parsed.schema_version === "number" ? parsed.schema_version : null,
      groups: cappedGroups,
      nodeIdentities,
      orderingBasis: rawActivity.orderingBasis,
      unidentifiedNodeCount: rawActivity.unidentifiedNodeCount,
      unattributedRecordCount: rawActivity.unattributedRecordCount,
      unknownToolNames: rawActivity.unknownToolNames,
      ambiguousIdentityCount: rawActivity.ambiguousIdentityCount,
      withheldInputFieldCount: totalWithheld,
      allSurfacedHint: deriveAllSurfacedHint(nodeIdentities, cappedGroups),
      truncated: {
        groups: groupsTruncated,
        callsPerAgent: rawActivity.truncated.callsPerAgent,
        nodesPerCall: rawActivity.truncated.nodesPerCall,
      },
    };
  } else {
    toolActivity = {
      present: false,
      schemaVersion: typeof parsed.schema_version === "number" ? parsed.schema_version : null,
      groups: [],
      nodeIdentities: [],
      orderingBasis: "position",
      unidentifiedNodeCount: 0,
      unattributedRecordCount: 0,
      unknownToolNames: [],
      ambiguousIdentityCount: 0,
      withheldInputFieldCount: 0,
      allSurfacedHint: false,
      truncated: { groups: 0, callsPerAgent: [], nodesPerCall: 0 },
    };
  }

  // ── concepts ───────────────────────────────────────────────────────────────
  // Strip confirmed producer keys from the concepts passthrough using the SAME
  // candidate-key lists the normalizer resolves with (not single literal key
  // names) — prevents raw, unswept records from crossing the RSC boundary.
  //
  // Keys stripped:
  //   TOOL_ACTIVITY_CONTAINER_KEYS — raw per-call records (normalised above)
  //   NODE_IDENTITIES_CONTAINER_KEYS — pre-derived identity array (consumed above)
  //   TOP_CONCEPTS_CONTAINER_KEYS — pre-derived concept list (consumed above)
  //   ACTIVITY_DIAGNOSTICS_CONTAINER_KEYS — producer diagnostics block;
  //     stripped but NOT consumed — Hive derives its own counters locally.
  //     The producer's `unattributed_record_count` is hardcoded 0 upstream by
  //     design, so adopting it would mislead.
  const conceptsForPassthrough = isRecord(parsed.concepts)
    ? { ...parsed.concepts }
    : {};
  const _cp = conceptsForPassthrough as Record<string, unknown>;
  for (const k of TOOL_ACTIVITY_CONTAINER_KEYS) delete _cp[k];
  for (const k of NODE_IDENTITIES_CONTAINER_KEYS) delete _cp[k];
  for (const k of TOP_CONCEPTS_CONTAINER_KEYS) delete _cp[k];
  for (const k of ACTIVITY_DIAGNOSTICS_CONTAINER_KEYS) delete _cp[k];
  const concepts = redactRecord(conceptsForPassthrough, false);

  // ── source_docs ────────────────────────────────────────────────────────────
  // The only HTML-bearing field. Sanitized here, once, server-side.
  // Deliberately NOT passed through the token-shape pass: a blanket
  // high-entropy match over converted legal documents would corrupt docket
  // numbers, registration ids and base64 exhibits.
  let droppedElements = 0;
  const sourceDocs: ProjectedSourceDoc[] = [];
  for (const entry of readArray(parsed, "source_docs")) {
    if (!isRecord(entry)) continue;
    const id = asString(entry.id) ?? "";
    if (!id) continue;
    const { nodes, droppedCount } = sanitizeDocumentHtml(asString(entry.html) ?? "");
    droppedElements += droppedCount;
    sourceDocs.push({ id, title: asString(entry.title) ?? id, body: nodes });
  }

  // ── workfiles ──────────────────────────────────────────────────────────────
  // Plain text, rendered as escaped React text. Also excluded from the
  // token-shape pass for the same reason as source documents.
  const workfiles = readArray(parsed, "workfiles")
    .filter(isRecord)
    .map((entry) => ({
      name: asString(entry.name) ?? asString(entry.path),
      text: asString(entry.text) ?? "",
    }));

  // ── rubric_links ───────────────────────────────────────────────────────────
  // Sole data source for the failure → source-document deep link.
  const rubricLinks: Record<string, ProjectedRubricLink[]> = {};
  if (isRecord(parsed.rubric_links)) {
    for (const [rubricId, value] of Object.entries(parsed.rubric_links)) {
      if (!Array.isArray(value)) continue;
      const links: ProjectedRubricLink[] = [];
      for (const link of value) {
        if (!isRecord(link)) continue;
        const doc = asString(link.doc);
        if (!doc) continue;
        const tokens = Array.isArray(link.tokens)
          ? link.tokens.filter((t): t is string => typeof t === "string")
          : [];
        links.push({ doc, tokens });
      }
      if (links.length > 0) rubricLinks[rubricId] = links;
    }
  }

  // ── Rubric derivation ─────────────────────────────────────────────────────
  // Called once here — the single source of rubric derivation.
  // Renderers read `projection.rubricRows` rather than re-deriving client-side.
  const rubricRows = groupRubrics(rubrics, score);

  // ── generatedAtMs — chained fallback ─────────────────────────────────────
  // A run that failed before scoring has no `score.scored_at`; we fall back
  // through `parsed.generated_at` then `pageDataRaw.generated_at` so that
  // degraded runs still show the best available timestamp.
  const generatedAtMs = toEpochMs(
    pageDataRaw.score && isRecord(pageDataRaw.score)
      ? (pageDataRaw.score as Record<string, unknown>).scored_at
      : undefined,
  ) ?? toEpochMs((parsed as Record<string, unknown>).generated_at)
    ?? toEpochMs(pageDataRaw.generated_at);

  const projection: RunReportProjection = {
    generatedAtMs,
    pageData,
    analysis,
    concepts,
    sourceDocs,
    workfiles,
    rubricLinks,
    rubricRows,
    toolActivity,
    stats: computeStats({
      sourceDocs,
      workfiles,
      traces: analysis.traces,
      branches,
      timeline: projectedTimeline,
      agents: projectedAgents,
      rubricRows,
    }),
    contractNotes,
  };

  return { status: "ok", projection, droppedElements };
}

// ── Sub-projectors ────────────────────────────────────────────────────────────

function redactRecord(value: unknown, tokenShapes: boolean): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return redactSensitiveKeys(value, { tokenShapes }) as Record<string, unknown>;
}

function redactArray(value: unknown[], tokenShapes: boolean): unknown[] {
  return redactSensitiveKeys(value, { tokenShapes }) as unknown[];
}

/** Narrow `page_data.score` to a typed `ScoreBlock`. */
function projectScore(raw: unknown): ScoreBlock {
  if (!isRecord(raw)) {
    return {
      score: null,
      max_score: null,
      all_pass: null,
      n_criteria: null,
      n_passed: null,
      judge_model: null,
      scored_at: null,
    };
  }
  return {
    score: typeof raw.score === "number" ? raw.score : null,
    max_score: typeof raw.max_score === "number" ? raw.max_score : null,
    all_pass: typeof raw.all_pass === "boolean" ? raw.all_pass : null,
    n_criteria: typeof raw.n_criteria === "number" ? raw.n_criteria : null,
    n_passed: typeof raw.n_passed === "number" ? raw.n_passed : null,
    judge_model: asString(raw.judge_model) ?? null,
    scored_at: asString(raw.scored_at) ?? null,
  };
}

/**
 * Project `timeline[]` into `TimelineStep[]`.
 * Non-record entries are dropped; string fields default to null.
 */
function projectTimeline(raw: unknown[]): TimelineStep[] {
  return raw.filter(isRecord).map((entry) => ({
    step: asString(entry.step) ?? "",
    start: asString(entry.start) ?? null,
    end: asString(entry.end) ?? null,
    duration_s: typeof entry.duration_s === "number" ? entry.duration_s : null,
  }));
}

/**
 * Project `agents[]` with selective redaction.
 *
 * Token-shape pass applies to agent METADATA fields (tool names, step names,
 * ids), but NOT to `final_answer` or any other prose field. A blanket sweep
 * over model-generated prose would corrupt quoted identifiers (docket numbers,
 * registration ids, base64 exhibits) — the same reason we skip the token-shape
 * pass on `source_docs[].html`.
 *
 * Prose fields (`final_answer`) still get key-based redaction via the outer
 * `redactSensitiveKeys` call with `tokenShapes: false`.
 */
function projectAgents(raw: unknown[]): unknown[] {
  return raw
    .filter(isRecord)
    .map((agent) => {
      // Extract prose field before redaction so it can be handled separately.
      const finalAnswer = agent.final_answer;

      // Build a copy without final_answer to run the token-shape pass on metadata.
      const { final_answer: _fa, ...metadata } = agent;
      void _fa;
      const redactedMetadata = redactSensitiveKeys(metadata, { tokenShapes: true }) as Record<
        string,
        unknown
      >;

      // Prose field: key-based redaction only (no regex sweep).
      const redactedProse =
        typeof finalAnswer === "string"
          ? (redactSensitiveKeys({ final_answer: finalAnswer }, { tokenShapes: false }) as Record<
              string,
              unknown
            >)
          : {};

      return { ...redactedMetadata, ...redactedProse };
    });
}

/**
 * Project `documents[]` to `{name, type, sizeBytes}` only.
 *
 * URL/href fields are explicitly excluded here — the field allow-listing is
 * defense-in-depth on top of the updated `REDACTED_KEYS` set, so no storage
 * link can reach the client even if a new url-key spelling appears in the
 * bundle.
 */
function projectDocuments(raw: unknown[]): ProjectedDocument[] {
  return raw.filter(isRecord).map((entry) => {
    const doc: ProjectedDocument = {
      name: asString(entry.file) ?? asString(entry.name) ?? "",
    };
    const type = asString(entry.strategy) ?? asString(entry.type);
    if (type) doc.type = type;
    const size = entry.size_bytes ?? entry.sizeBytes;
    if (typeof size === "number") doc.sizeBytes = size;
    return doc;
  });
}

/**
 * Project `security[]` through `redactArray`.
 *
 * `security` is an ARRAY in the real contract (not a plain object), so
 * `redactRecord` cannot serve it — `isRecord` explicitly excludes arrays and
 * would return `{}`, silently emptying the section. Non-record elements are
 * dropped.
 */
function projectSecurity(raw: unknown[]): SecurityFinding[] {
  const redacted = redactSensitiveKeys(raw, { tokenShapes: false }) as unknown[];
  return redacted.filter(isRecord) as SecurityFinding[];
}

/**
 * Cap an array to a maximum length and return the truncated count.
 * Returns `[capped, droppedCount]`.
 */
function capArray<T>(arr: T[], cap: number): [T[], number] {
  if (arr.length <= cap) return [arr, 0];
  return [arr.slice(0, cap), arr.length - cap];
}
