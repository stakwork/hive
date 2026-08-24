/**
 * Bounded server-side prefetch of graph node peek payloads for offline export.
 *
 * Reuses the exact Jarvis read pattern used by the live
 * `GET /api/workspaces/[slug]/nodes/[nodeId]` route:
 *   getWorkspaceSwarmAccess → getJarvisUrl → /v2/nodes/{ref_id}
 *
 * Hard caps enforced here (not in the caller):
 *   - MAX_PEEK_IDS  (50)  — deduplicated ref_ids per export
 *   - MAX_CONCURRENCY (4) — parallel in-flight fetches
 *   - PER_FETCH_TIMEOUT_MS (5_000) — per-node AbortController timeout
 *   - PHASE_BUDGET_MS (10_000) — wall-clock budget for the whole phase
 *
 * Returns a Map<refId, NodePeek> with only "done" or "error" states (no
 * "loading" — everything is prefetched before the HTML is rendered). RefIds
 * that exceeded any cap, timed out, or errored are returned in `skipped`.
 *
 * Never throws: every failure is a skipped entry, never a thrown exception.
 */

import { getJarvisUrl } from "@/lib/utils/swarm";
import type { WorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import type { NodePeek } from "@/components/run-report/NodePeek";

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_PEEK_IDS = 50;
export const MAX_CONCURRENCY = 4;
export const PER_FETCH_TIMEOUT_MS = 5_000;
export const PHASE_BUDGET_MS = 10_000;

// ── Result type ──────────────────────────────────────────────────────────────

export interface PeekPrefetchResult {
  peeks: Map<string, NodePeek>;
  skipped: string[];
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Prefetch graph node peeks for a set of ref_ids.
 *
 * @param refIds       All ref_ids referenced in the projection (may contain
 *                     duplicates — they are deduped before any fetch).
 * @param swarmAccess  Decrypted swarm credentials from getWorkspaceSwarmAccess.
 *                     The swarm API key is used only for Jarvis reads; it is
 *                     never logged or emitted into any export artifact.
 */
export async function prefetchNodePeeks(
  refIds: string[],
  swarmAccess: WorkspaceSwarmAccess,
): Promise<PeekPrefetchResult> {
  // ── Deduplicate ────────────────────────────────────────────────────────────
  const unique = Array.from(new Set(refIds.filter((id) => id && id.trim().length > 0)));

  // ── Hard cap: at most MAX_PEEK_IDS fetches per export ─────────────────────
  const admitted = unique.slice(0, MAX_PEEK_IDS);
  const capped = unique.slice(MAX_PEEK_IDS); // everything beyond the cap is skipped

  const peeks = new Map<string, NodePeek>();
  const skipped: string[] = [...capped];

  if (admitted.length === 0) {
    return { peeks, skipped };
  }

  const { swarmName, swarmApiKey } = swarmAccess;
  const jarvisUrl = getJarvisUrl(swarmName);

  // ── Phase budget: absolute wall-clock deadline for the whole phase ─────────
  const phaseDeadline = Date.now() + PHASE_BUDGET_MS;

  // ── Bounded concurrency: simple semaphore (no new dependency) ─────────────
  // Work through the admitted list, launching at most MAX_CONCURRENCY fetches
  // at a time. Remaining ids abandoned when the phase budget is exceeded.
  let cursor = 0;
  let inFlight = 0;
  const results: Array<{ id: string; peek: NodePeek | null; error: boolean }> = [];
  const pending: Promise<void>[] = [];

  async function fetchOne(refId: string): Promise<void> {
    // Check the phase budget before starting each fetch.
    if (Date.now() >= phaseDeadline) {
      results.push({ id: refId, peek: null, error: true });
      return;
    }

    const remaining = phaseDeadline - Date.now();
    const timeoutMs = Math.min(PER_FETCH_TIMEOUT_MS, remaining > 0 ? remaining : 0);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${jarvisUrl}/v2/nodes/${encodeURIComponent(refId)}`,
        {
          method: "GET",
          headers: {
            "x-api-token": swarmApiKey,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        results.push({
          id: refId,
          peek: { state: "error", note: `Jarvis returned ${response.status}` },
          error: false,
        });
        return;
      }

      const data = await response.json().catch(() => null);
      if (!data) {
        results.push({
          id: refId,
          peek: { state: "error", note: "Jarvis response was not valid JSON" },
          error: false,
        });
        return;
      }

      // Mirror the node-extraction logic from the live nodes route:
      // Jarvis answers {nodes: [node]}, {node}, or the node itself.
      const node = Array.isArray(data?.nodes) ? (data.nodes[0] ?? null) : (data?.node ?? data);
      if (!node) {
        results.push({
          id: refId,
          peek: { state: "error", note: "Node not found in Jarvis response" },
          error: false,
        });
        return;
      }

      results.push({ id: refId, peek: { state: "done", payload: node }, error: false });
    } catch (err) {
      // AbortError = timeout or budget exceeded
      const isAbort = err instanceof Error && err.name === "AbortError";
      results.push({
        id: refId,
        peek: {
          state: "error",
          note: isAbort ? "Fetch timed out" : "Network error during prefetch",
        },
        error: isAbort, // timed-out → skipped; other error → still include as error peek
      });
    } finally {
      clearTimeout(timer);
      inFlight--;
    }
  }

  // Process admitted list in bounded concurrency waves.
  // Use a simple queue: launch up to MAX_CONCURRENCY tasks, and as each
  // settles, launch the next one.
  const launchNext = (): Promise<void> | null => {
    if (cursor >= admitted.length) return null;
    if (Date.now() >= phaseDeadline) {
      // Budget exhausted — skip all remaining
      while (cursor < admitted.length) {
        skipped.push(admitted[cursor++]);
      }
      return null;
    }
    const refId = admitted[cursor++];
    inFlight++;
    const p = fetchOne(refId).then(() => {
      const next = launchNext();
      if (next) pending.push(next);
    });
    return p;
  };

  // Seed the initial batch (up to MAX_CONCURRENCY)
  for (let i = 0; i < MAX_CONCURRENCY && cursor < admitted.length; i++) {
    const p = launchNext();
    if (p) pending.push(p);
  }

  // Drain
  while (pending.length > 0) {
    await Promise.all(pending.splice(0));
  }

  // Collect results
  for (const { id, peek, error } of results) {
    if (error) {
      // Timed-out/budget-exhausted → skip (no peek entry)
      skipped.push(id);
    } else if (peek) {
      peeks.set(id, peek);
    }
  }

  return { peeks, skipped };
}
