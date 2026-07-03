/**
 * KG-based commit/PR correlation service for ErrorIssue regression detection.
 *
 * Given an ErrorIssue with a `kgRefId` and an onset timestamp, this service:
 *   1. Walks `REFERENCES` edges from the issue node to its linked `File` nodes.
 *   2. For each File node, walks `MODIFIES` edges (reversed — PR → File) to
 *      collect candidate `PullRequest` nodes.
 *   3. Ranks candidates by merge date at-or-before the onset timestamp.
 *   4. Persists the result on the ErrorIssue with a confidence label:
 *      - "high"   — exactly one clear best match (most recent, no close runner-up)
 *      - "likely" — multiple close candidates (top 2-3 stored in correlationCandidates)
 *      - nothing  — zero candidates; existing fields left untouched
 *
 * This function NEVER throws — all errors are caught and logged.
 *
 * KG edge topology:
 *   ErrorIssue --REFERENCES--> File --MODIFIES(reversed)--> PullRequest
 *
 * There is no direct commit→File edge; commits carry a `files` array only.
 * PR nodes carry `date`, `number`, and `url` properties.
 */

import { db } from "@/lib/db";
import { kgGetNeighbors } from "@/lib/ai/kg-adapter";

// ── Types ──────────────────────────────────────────────────────────────────────

/** Minimal shape expected from a PullRequest KG node's properties. */
interface PrCandidate {
  prNumber: number | null;
  prUrl: string | null;
  mergeDate: Date | null;
  refId: string;
  name: string;
}

/** Stored shape for multi-candidate "likely" entries in correlationCandidates. */
export interface CorrelationCandidate {
  prNumber: number | null;
  prUrl: string | null;
  mergeDate: string | null; // ISO string for JSON serialisation
  refId: string;
}

/**
 * Jarvis config passed in from the ingest route — already resolved, trusted.
 * Matches JarvisConnectionConfig from @/types/jarvis (uses `apiKey` field).
 */
export interface JarvisConfig {
  jarvisUrl: string;
  apiKey: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Two candidates are considered "close" (ambiguous) when their merge dates
 * are within this many milliseconds of each other. Using 24 h as the
 * disambiguation window: a PR merged > 1 day after the next-best candidate is
 * considered the clear winner.
 */
const CLOSE_CANDIDATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Maximum number of candidates to surface in the "likely" multi-match case. */
const MAX_LIKELY_CANDIDATES = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a PullRequest KG node's properties into a typed candidate.
 * Properties are untyped from the KG, so we extract defensively.
 */
function parsePrCandidate(refId: string, name: string, properties: unknown): PrCandidate {
  const props = (properties && typeof properties === "object" ? properties : {}) as Record<
    string,
    unknown
  >;

  // number/pr_number/prNumber — any form Jarvis may return
  const rawNumber = props.number ?? props.pr_number ?? props.prNumber ?? null;
  const prNumber =
    typeof rawNumber === "number"
      ? rawNumber
      : typeof rawNumber === "string" && rawNumber !== ""
        ? parseInt(rawNumber, 10) || null
        : null;

  // url/pr_url/html_url
  const prUrl =
    typeof props.url === "string" && props.url
      ? props.url
      : typeof props.pr_url === "string" && props.pr_url
        ? props.pr_url
        : typeof props.html_url === "string" && props.html_url
          ? props.html_url
          : null;

  // date/merged_at/mergedAt/created_at — prefer merged_at
  const rawDate =
    props.merged_at ?? props.mergedAt ?? props.date ?? props.created_at ?? props.createdAt ?? null;
  const mergeDate =
    typeof rawDate === "string" && rawDate ? new Date(rawDate) : null;

  return { prNumber, prUrl, mergeDate, refId, name };
}

// ── Main correlation function ──────────────────────────────────────────────────

/**
 * Correlate the onset of an ErrorIssue to a recent PR/commit via the KG.
 *
 * @param issueId       - DB id of the ErrorIssue to update.
 * @param kgRefId       - KG ref_id of the ErrorIssue node (may be null/undefined — skips gracefully).
 * @param onsetAt       - Timestamp of the onset event (firstSeenAt or regressionAt).
 * @param commitSha     - Optional commitSha from the triggering ErrorEvent.
 * @param jarvisConfig  - Resolved Jarvis credentials (jarvisUrl + swarmApiKey).
 * @param onsetReason   - The reason string from detectOnset(), used only for logging.
 */
export async function correlateErrorIssue(
  issueId: string,
  kgRefId: string | null | undefined,
  onsetAt: Date,
  commitSha: string | null | undefined,
  jarvisConfig: JarvisConfig,
  onsetReason: string,
): Promise<void> {
  // ── Guard: no KG ref means nothing to walk ────────────────────────────────
  if (!kgRefId) {
    console.info("[error-correlate] skipped: no kgRefId", {
      issueId,
      onsetReason,
    });
    return;
  }

  console.info("[error-correlate] onset detected, starting correlation", {
    issueId,
    kgRefId,
    onsetReason,
    onsetAt: onsetAt.toISOString(),
    commitSha: commitSha ?? null,
  });

  try {
    const { jarvisUrl, apiKey } = jarvisConfig;

    // ── Step 1: Get File nodes linked to this ErrorIssue via REFERENCES ───────
    const fileNeighbors = await kgGetNeighbors(jarvisUrl, apiKey, kgRefId, {
      edgeTypes: ["REFERENCES"],
      nodeTypes: ["File"],
    });

    if (!fileNeighbors.reachable) {
      console.info("[error-correlate] KG unreachable fetching File nodes — skipping", {
        issueId,
        kgRefId,
      });
      return;
    }

    const fileNodes = fileNeighbors.neighbors.filter((n) => n.node_type === "File");
    if (fileNodes.length === 0) {
      console.info("[error-correlate] no File nodes linked to issue — no correlation", {
        issueId,
        kgRefId,
      });
      return;
    }

    console.info("[error-correlate] File nodes found", {
      issueId,
      fileCount: fileNodes.length,
    });

    // ── Step 2: Collect PullRequest candidates from each File node ────────────
    const candidateMap = new Map<string, PrCandidate>(); // keyed by refId (dedup)

    for (const fileNode of fileNodes) {
      const prNeighbors = await kgGetNeighbors(jarvisUrl, apiKey, fileNode.ref_id, {
        edgeTypes: ["MODIFIES"],
        nodeTypes: ["PullRequest"],
      });

      if (!prNeighbors.reachable) {
        console.info("[error-correlate] KG unreachable fetching PRs for File node (skipping node)", {
          issueId,
          fileRefId: fileNode.ref_id,
        });
        continue;
      }

      for (const neighbor of prNeighbors.neighbors) {
        if (neighbor.node_type !== "PullRequest") continue;
        if (candidateMap.has(neighbor.ref_id)) continue; // already collected

        const candidate = parsePrCandidate(
          neighbor.ref_id,
          neighbor.name,
          (neighbor as { properties?: unknown }).properties ?? null,
        );
        candidateMap.set(neighbor.ref_id, candidate);
      }
    }

    const allCandidates = [...candidateMap.values()];

    console.info("[error-correlate] PR candidates collected", {
      issueId,
      total: allCandidates.length,
    });

    if (allCandidates.length === 0) {
      console.info("[error-correlate] no PR candidates found — no correlation written", {
        issueId,
      });
      return;
    }

    // ── Step 3: Filter to PRs at-or-before onset, rank by most recent ─────────
    const eligible = allCandidates
      .filter((c) => c.mergeDate !== null && c.mergeDate <= onsetAt)
      .sort((a, b) => b.mergeDate!.getTime() - a.mergeDate!.getTime()); // newest first

    if (eligible.length === 0) {
      console.info(
        "[error-correlate] no PR candidates at-or-before onset timestamp — no correlation written",
        { issueId, onsetAt: onsetAt.toISOString(), totalCandidates: allCandidates.length },
      );
      return;
    }

    // ── Step 4: Determine confidence ──────────────────────────────────────────
    const best = eligible[0];
    const runnerUp = eligible[1];

    const isClose =
      runnerUp !== undefined &&
      best.mergeDate !== null &&
      runnerUp.mergeDate !== null &&
      best.mergeDate.getTime() - runnerUp.mergeDate.getTime() < CLOSE_CANDIDATE_WINDOW_MS;

    let confidence: "high" | "likely";
    let candidates: CorrelationCandidate[] | null = null;

    if (isClose) {
      // Multiple close candidates — surface top N as "likely"
      confidence = "likely";
      candidates = eligible.slice(0, MAX_LIKELY_CANDIDATES).map((c) => ({
        prNumber: c.prNumber,
        prUrl: c.prUrl,
        mergeDate: c.mergeDate ? c.mergeDate.toISOString() : null,
        refId: c.refId,
      }));
    } else {
      // One clear winner
      confidence = "high";
    }

    // ── Step 5: Persist correlation fields ────────────────────────────────────
    const now = new Date();

    await db.errorIssue.update({
      where: { id: issueId },
      data: {
        correlatedPrNumber: best.prNumber ?? undefined,
        correlatedPrUrl: best.prUrl ?? undefined,
        correlatedCommitSha: commitSha ?? undefined,
        correlationConfidence: confidence,
        correlationComputedAt: now,
        correlationCandidates: candidates
          ? (candidates as unknown as import("@prisma/client").Prisma.InputJsonValue)
          : undefined,
      },
    });

    console.info("[error-correlate] correlation stored", {
      issueId,
      confidence,
      prNumber: best.prNumber,
      prUrl: best.prUrl,
      candidateCount: candidates?.length ?? 1,
      computedAt: now.toISOString(),
    });
  } catch (err) {
    // Must never propagate — correlation is best-effort
    console.error("[error-correlate] unexpected error (non-fatal)", {
      issueId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
