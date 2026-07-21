/**
 * Atomic helpers for tracking in-flight repo_agent runs on a
 * SharedConversation row (the `active_runs` JSON column).
 *
 * Shape of each map entry:
 *   { requestId, workspaceId, startedAt, abortRequested? }
 *
 * Rules:
 *   - Every **mutation** runs inside a row-locking Prisma transaction
 *     so ~20 concurrent executes in one canvas turn never lose updates.
 *   - **Reads** (isAbortRequested, getActiveRuns) are lock-free — a
 *     slightly stale read is fine; the next poll cycle catches it.
 *   - A **staleness reaper** treats entries older than ACTIVE_RUN_TTL_MS
 *     as dead so a crashed lambda can't leave a phantom "run active".
 *   - A **pending-abort intent** (`{ turnId, requestedAt, expiresAt }`)
 *     lets Stop land before the run's request_id is even registered; it
 *     is scoped to a turnId and consumed atomically so it can't cancel
 *     a later unrelated run.
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max age of an activeRun entry before we treat it as a crashed/dead run. */
export const ACTIVE_RUN_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Max age of a pending-abort intent before it expires (avoids cancelling future turns). */
export const PENDING_ABORT_TTL_MS = 60 * 1000; // 1 minute

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActiveRunEntry {
  requestId: string;
  workspaceId: string;
  startedAt: string; // ISO timestamp
  abortRequested?: boolean;
}

export interface PendingAbortIntent {
  turnId: string;
  requestedAt: string; // ISO timestamp
  expiresAt: string; // ISO timestamp
}

interface ActiveRunsDoc {
  runs?: Record<string, ActiveRunEntry>;
  pendingAbortIntent?: PendingAbortIntent;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseDoc(raw: unknown): ActiveRunsDoc {
  if (!raw || typeof raw !== "object") return {};
  return raw as ActiveRunsDoc;
}

function isStale(entry: ActiveRunEntry): boolean {
  const age = Date.now() - new Date(entry.startedAt).getTime();
  return age > ACTIVE_RUN_TTL_MS;
}

/**
 * Return only the live (non-stale) entries. Caller is responsible for
 * persisting the pruned map when inside a transaction.
 */
function liveEntries(runs: Record<string, ActiveRunEntry>): Record<string, ActiveRunEntry> {
  const live: Record<string, ActiveRunEntry> = {};
  for (const [key, entry] of Object.entries(runs)) {
    if (!isStale(entry)) live[key] = entry;
  }
  return live;
}

// ---------------------------------------------------------------------------
// Mutations (all transactional)
// ---------------------------------------------------------------------------

/**
 * Register a new in-flight run. Prunes stale entries opportunistically.
 * Returns the (now-consumed) pendingAbortIntent if one exists for this turnId
 * so the caller can self-abort immediately.
 */
export async function setActiveRun(
  conversationId: string,
  entry: ActiveRunEntry,
): Promise<{ pendingAbortIntent?: PendingAbortIntent }> {
  return db.$transaction(async (tx) => {
    const row = await tx.sharedConversation.findUnique({
      where: { id: conversationId },
      select: { activeRuns: true },
    });
    if (!row) return {};

    const doc = parseDoc(row.activeRuns);
    const runs = liveEntries(doc.runs ?? {});
    runs[entry.requestId] = entry;

    // Check for (and atomically consume) a pending-abort intent for this turnId.
    let consumedIntent: PendingAbortIntent | undefined;
    if (doc.pendingAbortIntent) {
      const intent = doc.pendingAbortIntent;
      const expired = new Date(intent.expiresAt) < new Date();
      if (!expired && intent.turnId === entry.requestId.split(":")[0]) {
        // The intent matches this run's turn — consume it.
        consumedIntent = intent;
        // Clear it so later runs in the same turn don't re-consume.
        delete doc.pendingAbortIntent;
      }
    }

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: {
        activeRuns: {
          runs,
          ...(doc.pendingAbortIntent ? { pendingAbortIntent: doc.pendingAbortIntent } : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { pendingAbortIntent: consumedIntent };
  });
}

/**
 * Remove a single run entry from the map (called in the execute `finally`).
 * If this was the last run, optionally broadcast the run-ended state.
 */
export async function clearActiveRun(
  conversationId: string,
  requestId: string,
): Promise<{ wasLast: boolean }> {
  return db.$transaction(async (tx) => {
    const row = await tx.sharedConversation.findUnique({
      where: { id: conversationId },
      select: { activeRuns: true },
    });
    if (!row) return { wasLast: true };

    const doc = parseDoc(row.activeRuns);
    const runs = liveEntries(doc.runs ?? {});
    delete runs[requestId];

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: {
        activeRuns: {
          runs,
          ...(doc.pendingAbortIntent ? { pendingAbortIntent: doc.pendingAbortIntent } : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { wasLast: Object.keys(runs).length === 0 };
  });
}

/**
 * Set `abortRequested: true` on every active (non-stale) run entry.
 * Returns the list of entries so the caller can proxy the abort to each swarm.
 */
export async function requestAbortForAllRuns(
  conversationId: string,
): Promise<ActiveRunEntry[]> {
  return db.$transaction(async (tx) => {
    const row = await tx.sharedConversation.findUnique({
      where: { id: conversationId },
      select: { activeRuns: true },
    });
    if (!row) return [];

    const doc = parseDoc(row.activeRuns);
    const runs = liveEntries(doc.runs ?? {});

    const targets: ActiveRunEntry[] = [];
    for (const key of Object.keys(runs)) {
      runs[key] = { ...runs[key], abortRequested: true };
      targets.push(runs[key]);
    }

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: {
        activeRuns: {
          runs,
          ...(doc.pendingAbortIntent ? { pendingAbortIntent: doc.pendingAbortIntent } : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return targets;
  });
}

// ---------------------------------------------------------------------------
// Reads (lock-free)
// ---------------------------------------------------------------------------

/**
 * Check whether a specific run has been flagged for abort.
 * Lock-free — a slightly stale read is acceptable (next poll catches it).
 */
export async function isAbortRequestedForRun(
  conversationId: string,
  requestId: string,
): Promise<boolean> {
  const row = await db.sharedConversation.findUnique({
    where: { id: conversationId },
    select: { activeRuns: true },
  });
  if (!row) return false;
  const doc = parseDoc(row.activeRuns);
  const entry = (doc.runs ?? {})[requestId];
  if (!entry || isStale(entry)) return false;
  return entry.abortRequested === true;
}

/**
 * Return all live active run entries for a conversation (for the abort endpoint).
 */
export async function getActiveRuns(
  conversationId: string,
): Promise<ActiveRunEntry[]> {
  const row = await db.sharedConversation.findUnique({
    where: { id: conversationId },
    select: { activeRuns: true },
  });
  if (!row) return [];
  const doc = parseDoc(row.activeRuns);
  return Object.values(liveEntries(doc.runs ?? {}));
}

/**
 * Returns true if there is at least one non-stale active run.
 * Used to derive the server-side boolean for Pusher broadcast and
 * conversation read endpoints (never exposes the raw map to clients).
 */
export async function hasActiveRuns(conversationId: string): Promise<boolean> {
  const runs = await getActiveRuns(conversationId);
  return runs.length > 0;
}

// ---------------------------------------------------------------------------
// Pending-abort intent
// ---------------------------------------------------------------------------

/**
 * Write a turn-scoped pending-abort intent. Used when Stop is pressed
 * before the run's request_id has been registered (start race).
 * The intent is keyed to `turnId` so only the matching run consumes it.
 */
export async function setPendingAbortIntent(
  conversationId: string,
  turnId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.sharedConversation.findUnique({
      where: { id: conversationId },
      select: { activeRuns: true },
    });
    if (!row) return;

    const doc = parseDoc(row.activeRuns);
    const runs = liveEntries(doc.runs ?? {});
    const now = new Date();
    const intent: PendingAbortIntent = {
      turnId,
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PENDING_ABORT_TTL_MS).toISOString(),
    };

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: {
        activeRuns: {
          runs,
          pendingAbortIntent: intent,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

/**
 * Check if any entries in the map are already all marked abortRequested
 * (used for the idempotent short-circuit in the abort endpoint).
 */
export async function areAllRunsAlreadyAborted(
  conversationId: string,
): Promise<boolean> {
  const runs = await getActiveRuns(conversationId);
  if (runs.length === 0) return false;
  return runs.every((r) => r.abortRequested === true);
}
