/**
 * Composable assembly layer for offline export.
 *
 * Three entrypoints, each wrapping `loadRunReport` from the live pipeline and
 * adding per-export enrichment:
 *
 *   assembleRunExport         — run/eval/recursion reports: adds peek prefetch
 *   assembleAttemptExport     — recursion-attempt reports: same shape as run
 *   assembleConsolidatedExport — consolidated reports: document packing, no peeks
 *
 * Every enrichment step fails soft: errors are captured in `skipped` and the
 * assembly continues rather than throwing. `loadRunReport`'s own error branches
 * (`unavailable`, `url_rejected`, no-report) are passed through untouched with
 * an empty `skipped` record — there is nothing to enrich when the bundle itself
 * could not be loaded.
 *
 * Callers pass pre-computed rubric/fix-snapshot data (already fetched by the
 * route handler) in `opts` rather than this module re-fetching them — avoiding
 * duplicate swarm API calls and keeping assembly pure/composable.
 */

import { loadRunReport } from "@/lib/run-report/load";
import { prefetchNodePeeks } from "./peek-prefetch";
import { packDocuments } from "./pack-documents";
import { logger } from "@/lib/logger";
import type { RunReportPayload, RunReportProjection, ConsolidatedReportProjection } from "@/lib/run-report/types";
import type { WorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import type { NodePeek } from "@/components/run-report/NodePeek";
import type { PackedDocument } from "./pack-documents";

const LOG_SERVICE = "run-report/export/assemble";

// ── Shared types ─────────────────────────────────────────────────────────────

/** Items that were skipped during enrichment (peek or document failures). */
export interface SkippedItems {
  peeks: string[];
  documents: string[];
}

/**
 * Pre-fetched enrichment data passed in by the caller.
 * This module does NOT fetch rubric roster or fix snapshots itself —
 * those are already available at the call site (route handler).
 */
export interface RunExportOpts {
  /** Decrypted swarm credentials for peek prefetch. */
  swarmAccess: WorkspaceSwarmAccess;
  /** Pre-fetched rubric roster (passed through; not re-fetched here). */
  rubricRoster?: unknown;
  /** Pre-fetched fix snapshots (passed through; not re-fetched here). */
  fixSnapshots?: unknown;
}

export interface ConsolidatedExportOpts {
  // Consolidated projections are self-contained — no swarm access needed for
  // peek prefetch (none is performed). Document packing is anonymous.
}

// ── Result types ─────────────────────────────────────────────────────────────

export interface RunExportPayload {
  /** The base run report payload from loadRunReport (error branches preserved). */
  report: RunReportPayload;
  /** Pre-fetched node peek map — empty when report has no valid projection. */
  peeks: Map<string, NodePeek>;
  /** What was skipped during enrichment. */
  skipped: SkippedItems;
  /** Pass-through from opts (for downstream rendering). */
  rubricRoster: unknown;
  fixSnapshots: unknown;
}

export interface ConsolidatedExportPayload {
  /** The base run report payload from loadRunReport (error branches preserved). */
  report: RunReportPayload;
  /** Documents packed for offline access (empty when report has no valid projection). */
  packedDocuments: PackedDocument[];
  /** What was skipped during enrichment. */
  skipped: SkippedItems;
}

// ── assembleRunExport ────────────────────────────────────────────────────────

/**
 * Assemble an offline export for a RUNNER, EVAL, or RECURSION run report.
 *
 * Steps:
 *   1. `loadRunReport` — fetch + sanitize + project (unchanged, error branches preserved).
 *   2. Extract ref_ids from the projection (concepts, tool activity, fix snapshots).
 *   3. `prefetchNodePeeks` — bounded server-side node peek prefetch.
 *
 * @param runId     StakworkRun.id (for logging only; never emitted into artifacts).
 * @param reportUrl S3 URL (for loadRunReport; never emitted into artifacts).
 * @param opts      Pre-computed enrichment + swarm access credentials.
 */
export async function assembleRunExport(
  runId: string,
  reportUrl: string | null,
  opts: RunExportOpts,
): Promise<RunExportPayload> {
  logger.info("[assemble] assembleRunExport start", LOG_SERVICE, { runId });

  const report = await loadRunReport(runId, reportUrl);

  const empty: RunExportPayload = {
    report,
    peeks: new Map(),
    skipped: { peeks: [], documents: [] },
    rubricRoster: opts.rubricRoster ?? null,
    fixSnapshots: opts.fixSnapshots ?? null,
  };

  // Pass error branches through with empty enrichment.
  if (!report.projection || report.projection.consolidated === true) {
    logger.info("[assemble] No valid RunReportProjection — skipping enrichment", LOG_SERVICE, { runId });
    return empty;
  }

  const projection = report.projection as RunReportProjection;
  const refIds = extractRefIdsFromProjection(projection, opts.fixSnapshots);

  let peeks = new Map<string, NodePeek>();
  const skipped: SkippedItems = { peeks: [], documents: [] };

  if (refIds.length > 0) {
    try {
      const result = await prefetchNodePeeks(refIds, opts.swarmAccess);
      peeks = result.peeks;
      skipped.peeks = result.skipped;
      logger.info("[assemble] Peek prefetch complete", LOG_SERVICE, {
        runId,
        fetched: peeks.size,
        skipped: skipped.peeks.length,
      });
    } catch (err) {
      // prefetchNodePeeks never throws, but guard defensively.
      logger.error("[assemble] Peek prefetch threw unexpectedly", LOG_SERVICE, {
        runId,
        error: err instanceof Error ? err.message : "unknown",
      });
      skipped.peeks = refIds;
    }
  }

  logger.info("[assemble] assembleRunExport complete", LOG_SERVICE, { runId });

  return {
    report,
    peeks,
    skipped,
    rubricRoster: opts.rubricRoster ?? null,
    fixSnapshots: opts.fixSnapshots ?? null,
  };
}

// ── assembleAttemptExport ────────────────────────────────────────────────────

/**
 * Assemble an offline export for a recursion-attempt report (EvalTriggerOutput
 * graph node, no StakworkRun row). Same shape and pipeline as assembleRunExport.
 *
 * @param refId      EvalTriggerOutput graph ref_id (for logging; not emitted).
 * @param reportUrl  report_url from the graph node (for loadRunReport).
 * @param opts       Pre-computed enrichment + swarm access credentials.
 */
export async function assembleAttemptExport(
  refId: string,
  reportUrl: string | null,
  opts: RunExportOpts,
): Promise<RunExportPayload> {
  logger.info("[assemble] assembleAttemptExport start", LOG_SERVICE, { refId });
  // Attempts use the same RunReportProjection shape as run reports.
  return assembleRunExport(refId, reportUrl, opts);
}

// ── assembleConsolidatedExport ───────────────────────────────────────────────

/**
 * Assemble an offline export for a CONSOLIDATED run report.
 *
 * Consolidated projections are self-contained (no concept chips, no live node
 * peeks) — so peek prefetch is NOT performed. Document packing IS performed
 * for every URL in `projection.sourceFileLinks`.
 *
 * @param runId     StakworkRun.id (for logging only; never emitted into artifacts).
 * @param reportUrl S3 URL (for loadRunReport; never emitted into artifacts).
 */
export async function assembleConsolidatedExport(
  runId: string,
  reportUrl: string | null,
  _opts: ConsolidatedExportOpts = {},
): Promise<ConsolidatedExportPayload> {
  logger.info("[assemble] assembleConsolidatedExport start", LOG_SERVICE, { runId });

  const report = await loadRunReport(runId, reportUrl);

  const empty: ConsolidatedExportPayload = {
    report,
    packedDocuments: [],
    skipped: { peeks: [], documents: [] },
  };

  // Pass error branches through with empty enrichment.
  if (!report.projection || report.projection.consolidated !== true) {
    logger.info("[assemble] No valid ConsolidatedReportProjection — skipping enrichment", LOG_SERVICE, { runId });
    return empty;
  }

  const projection = report.projection as ConsolidatedReportProjection;
  const sourceUrls = projection.sourceFileLinks ?? [];

  let packedDocuments: PackedDocument[] = [];
  const skipped: SkippedItems = { peeks: [], documents: [] };

  if (sourceUrls.length > 0) {
    try {
      const result = await packDocuments(sourceUrls);
      packedDocuments = result.packed;
      skipped.documents = result.skipped;
      logger.info("[assemble] Document packing complete", LOG_SERVICE, {
        runId,
        packed: packedDocuments.length,
        skipped: skipped.documents.length,
      });
    } catch (err) {
      // packDocuments never throws, but guard defensively.
      logger.error("[assemble] Document packing threw unexpectedly", LOG_SERVICE, {
        runId,
        error: err instanceof Error ? err.message : "unknown",
      });
      skipped.documents = sourceUrls;
    }
  }

  logger.info("[assemble] assembleConsolidatedExport complete", LOG_SERVICE, { runId });

  return { report, packedDocuments, skipped };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Extract all graph ref_ids referenced in a RunReportProjection.
 *
 * Sources:
 *   1. Tool-activity node identities (identity rows with identityKind === "ref_id").
 *   2. Fix snapshot ref_ids (passed as fixSnapshots from the caller).
 *
 * The live report surfaces concept chips and fix-snapshot links as the primary
 * NodePeek call sites. We collect every unique non-empty ref_id the renderer
 * could try to peek.
 *
 * @param projection  The RunReportProjection from loadRunReport.
 * @param fixSnapshots The pre-fetched fix snapshots array (unknown shape —
 *                    extracted defensively).
 */
export function extractRefIdsFromProjection(
  projection: RunReportProjection,
  fixSnapshots: unknown,
): string[] {
  const ids = new Set<string>();

  // ── Tool-activity node identities ──────────────────────────────────────────
  // NodeIdentityRow[] in projection.toolActivity.nodeIdentities.
  // Only rows where identityKind === "ref_id" carry a graph ref_id.
  if (projection.toolActivity?.present && Array.isArray(projection.toolActivity.nodeIdentities)) {
    for (const row of projection.toolActivity.nodeIdentities) {
      if (
        isRecord(row) &&
        row.identityKind === "ref_id" &&
        typeof row.identity === "string" &&
        row.identity.trim().length > 0
      ) {
        ids.add(row.identity.trim());
      }
    }
  }

  // ── Fix snapshots ──────────────────────────────────────────────────────────
  // fetchFixSnapshots returns an array of ProposedFix-shaped objects.
  // Each has an optional `ref_id` or `refId` field.
  if (Array.isArray(fixSnapshots)) {
    for (const fix of fixSnapshots) {
      if (isRecord(fix)) {
        const refId =
          (typeof fix.ref_id === "string" ? fix.ref_id : null) ??
          (typeof fix.refId === "string" ? fix.refId : null);
        if (refId && refId.trim().length > 0) {
          ids.add(refId.trim());
        }
      }
    }
  }

  return Array.from(ids);
}

/** Minimal record guard — avoids importing from derive.ts (keeps this pure). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
