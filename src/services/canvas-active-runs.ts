/**
 * Atomic helpers for tracking in-flight `repo_agent` runs against a
 * `SharedConversation` row.
 *
 * ## Shape
 * The `active_runs` JSON column holds:
 * ```
 * {
 *   runs: { [requestId]: ActiveRunEntry },
 *   abortIntents: { [turnId]: AbortIntentEntry }
 * }
 * ```
 *
 * ## Atomicity
 * All mutations use a `db.$transaction` + `SELECT … FOR UPDATE` (via
 * `$queryRaw`) to serialize concurrent writers.  Reads are lock-free.
 *
 * ## Staleness reaper
 * Any run entry older than ACTIVE_RUN_TTL_MS (~10 min) is considered
 * dead and excluded from "is a run active" derivations.  Stale entries
 * are pruned opportunistically on the next write.
 *
 * ## Pending-abort intent
 * Stored under `abortIntents[turnId]`; consumed atomically only by an
 * `execute` belonging to that `turnId`, so it cannot cancel an
 * unrelated later run.
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum age of a run entry before it is treated as a crashed-lambda phantom. */
export const ACTIVE_RUN_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** How long a pending-abort intent remains valid (start-race window). */
export const ABORT_INTENT_TTL_MS = 60 * 1000; // 60 seconds

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActiveRunEntry {
  requestId: string;
  /** Re-resolved at abort time to fetch swarm creds — never stored with secrets. */
  workspaceId: string | null;
  startedAt: string; // ISO-8601
  abortRequested?: boolean;
}

export interface AbortIntentEntry {
  turnId: string;
  requestedAt: string; // ISO-8601
  expiresAt: string; // ISO-8601
}

interface ActiveRunsColumn {
  runs: Record<string, ActiveRunEntry>;
  abortIntents: Record<string, AbortIntentEntry>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function emptyColumn(): ActiveRunsColumn {
  return { runs: {}, abortIntents: {} };
}

function parseColumn(raw: unknown): ActiveRunsColumn {
  if (!raw || typeof raw !== "object") return emptyColumn();
  const col = raw as Partial<ActiveRunsColumn>;
  return {
    runs: col.runs ?? {},
    abortIntents: col.abortIntents ?? {},
  };
}

function isStale(entry: ActiveRunEntry): boolean {
  const age = Date.now() - new Date(entry.startedAt).getTime();
  return age > ACTIVE_RUN_TTL_MS;
}

function pruneStaleRuns(runs: Record<string, ActiveRunEntry>): Record<string, ActiveRunEntry> {
  const out: Record<string, ActiveRunEntry> = {};
  for (const [k, v] of Object.entries(runs)) {
    if (!isStale(v)) out[k] = v;
  }
  return out;
}

function pruneExpiredIntents(
  intents: Record<string, AbortIntentEntry>,
): Record<string, AbortIntentEntry> {
  const now = Date.now();
  const out: Record<string, AbortIntentEntry> = {};
  for (const [k, v] of Object.entries(intents)) {
    if (new Date(v.expiresAt).getTime() > now) out[k] = v;
  }
  return out;
}

/**
 * Execute `mutate` inside a row-locking transaction on `SharedConversation`.
 * The `FOR UPDATE` lock serializes concurrent writers on this row.
 */
async function withLockedRow(
  conversationId: string,
  mutate: (current: ActiveRunsColumn) => ActiveRunsColumn,
): Promise<void> {
  await db.$transaction(async (tx) => {
    // Lock the row for the duration of this transaction.
    const rows = await tx.$queryRaw<{ active_runs: unknown }[]>`
      SELECT active_runs
      FROM shared_conversations
      WHERE id = ${conversationId}
      FOR UPDATE
    `;

    const current = parseColumn(rows[0]?.active_runs ?? null);
    const next = mutate(current);

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: { activeRuns: next as unknown as Prisma.InputJsonValue },
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record a newly-started run.  Also opportunistically prunes stale entries.
 */
export async function setActiveRun(
  conversationId: string,
  entry: Omit<ActiveRunEntry, "abortRequested">,
): Promise<void> {
  await withLockedRow(conversationId, (col) => {
    const runs = pruneStaleRuns(col.runs);
    runs[entry.requestId] = { ...entry, startedAt: entry.startedAt };
    return { ...col, runs };
  });
}

/**
 * Remove a single run entry by `requestId` (called in `finally`).
 * Only removes the named key — sibling keys are untouched.
 */
export async function clearActiveRun(
  conversationId: string,
  requestId: string,
): Promise<void> {
  await withLockedRow(conversationId, (col) => {
    const runs = pruneStaleRuns(col.runs);
    delete runs[requestId];
    return { ...col, runs };
  });
}

/**
 * Flag one or more runs as `abortRequested`.  Missing keys are silently skipped
 * (race: the run may have already cleared in `finally`).
 */
export async function requestAbortForRuns(
  conversationId: string,
  requestIds: string[],
): Promise<void> {
  await withLockedRow(conversationId, (col) => {
    const runs = pruneStaleRuns(col.runs);
    for (const id of requestIds) {
      if (runs[id]) {
        runs[id] = { ...runs[id], abortRequested: true };
      }
    }
    return { ...col, runs };
  });
}

/**
 * Lock-free read of all currently-active run entries (stale entries filtered out).
 */
export async function getActiveRuns(
  conversationId: string,
): Promise<ActiveRunEntry[]> {
  const row = await db.sharedConversation.findFirst({
    where: { id: conversationId },
    select: { activeRuns: true },
  });
  const col = parseColumn(row?.activeRuns ?? null);
  return Object.values(col.runs).filter((r) => !isStale(r));
}

/**
 * Lock-free read of the `abortRequested` flag for a single run.
 * Returns `false` if the entry is gone (already cleared).
 */
export async function isRunAbortRequested(
  conversationId: string,
  requestId: string,
): Promise<boolean> {
  const row = await db.sharedConversation.findFirst({
    where: { id: conversationId },
    select: { activeRuns: true },
  });
  const col = parseColumn(row?.activeRuns ?? null);
  return col.runs[requestId]?.abortRequested === true;
}

// ─── Pending-abort intent ────────────────────────────────────────────────────

/**
 * Store a turn-scoped abort intent (for the start-race: Stop pressed before
 * the run's `request_id` was persisted).
 */
export async function setPendingAbortIntent(
  conversationId: string,
  turnId: string,
): Promise<void> {
  const now = new Date();
  const intent: AbortIntentEntry = {
    turnId,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ABORT_INTENT_TTL_MS).toISOString(),
  };

  await withLockedRow(conversationId, (col) => {
    const abortIntents = pruneExpiredIntents(col.abortIntents);
    abortIntents[turnId] = intent;
    return { ...col, abortIntents };
  });
}

/**
 * Atomically consume the pending-abort intent for `turnId` (if it exists and
 * has not expired).  Returns the intent if it was present; `null` otherwise.
 *
 * "Consume" means remove — calling this twice for the same `turnId` returns
 * `null` on the second call, preventing double-cancellation.
 */
export async function consumePendingAbortIntent(
  conversationId: string,
  turnId: string,
): Promise<AbortIntentEntry | null> {
  let found: AbortIntentEntry | null = null;

  await withLockedRow(conversationId, (col) => {
    const abortIntents = pruneExpiredIntents(col.abortIntents);
    const intent = abortIntents[turnId];
    if (intent) {
      found = intent;
      delete abortIntents[turnId];
    }
    return { ...col, abortIntents };
  });

  return found;
}

/**
 * Derive a single boolean: "does this conversation have at least one
 * non-stale, non-aborted active run?"  Used by the Stop-button visibility
 * logic and the Pusher broadcast.
 */
export async function hasActiveRun(conversationId: string): Promise<boolean> {
  const runs = await getActiveRuns(conversationId);
  return runs.length > 0;
}
