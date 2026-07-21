/**
 * Unit tests for canvas-active-runs service.
 *
 * Scope:
 *   - Two concurrent runs set/clear their own key without clobbering
 *   - Stale (past-TTL) entries excluded from active / getActiveRuns
 *   - Turn-scoped pending-abort intent consumed only by matching run,
 *     not by a later turn's run
 *   - areAllRunsAlreadyAborted returns correct value
 *   - requestAbortForAllRuns flags all live runs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock Prisma (hoisted so the factory runs before module init) ──────────────
const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    sharedConversation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { mockDb };
});

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

import {
  setActiveRun,
  clearActiveRun,
  getActiveRuns,
  hasActiveRuns,
  isAbortRequestedForRun,
  requestAbortForAllRuns,
  setPendingAbortIntent,
  areAllRunsAlreadyAborted,
  ACTIVE_RUN_TTL_MS,
  PENDING_ABORT_TTL_MS,
} from "@/services/canvas-active-runs";

const CONV_ID = "conv-123";

function makeEntry(requestId: string, workspaceId = "ws-1", ageMs = 0) {
  return {
    requestId,
    workspaceId,
    startedAt: new Date(Date.now() - ageMs).toISOString(),
  };
}

function makeDoc(runs: Record<string, unknown>, pendingAbortIntent?: unknown) {
  return { runs, ...(pendingAbortIntent ? { pendingAbortIntent } : {}) };
}

// Helper: set up the $transaction mock to simulate
// the read-modify-write pattern.
function setupTransaction(initialDoc: unknown) {
  let currentDoc = initialDoc;

  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
    const txMock = {
      sharedConversation: {
        findUnique: vi.fn().mockResolvedValue({ activeRuns: currentDoc }),
        update: vi.fn().mockImplementation(({ data }) => {
          // Capture the written value for subsequent reads.
          currentDoc = data.activeRuns;
          return Promise.resolve({ id: CONV_ID });
        }),
      },
    };
    return fn(txMock as unknown as typeof mockDb);
  });

  mockDb.sharedConversation.findUnique.mockImplementation(() =>
    Promise.resolve({ activeRuns: currentDoc }),
  );

  return {
    getDoc: () => currentDoc,
  };
}

describe("canvas-active-runs service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── setActiveRun / clearActiveRun ──────────────────────────────────────

  it("registers a run and makes it visible in getActiveRuns", async () => {
    setupTransaction(null);

    await setActiveRun(CONV_ID, makeEntry("req-1"));

    const runs = await getActiveRuns(CONV_ID);
    expect(runs).toHaveLength(1);
    expect(runs[0].requestId).toBe("req-1");
  });

  it("two concurrent runs do not clobber each other", async () => {
    // Simulate: run-A sets first, then run-B sets.
    // The transaction mock is sequential here; in real Prisma they'd
    // serialize via FOR UPDATE. We verify that after both writes,
    // both keys are present.
    const ctx = setupTransaction(null);

    await setActiveRun(CONV_ID, makeEntry("req-A", "ws-1"));
    // After run-A: doc should have req-A.
    expect(JSON.stringify(ctx.getDoc())).toContain("req-A");

    await setActiveRun(CONV_ID, makeEntry("req-B", "ws-2"));
    // After run-B: doc should have both.
    expect(JSON.stringify(ctx.getDoc())).toContain("req-A");
    expect(JSON.stringify(ctx.getDoc())).toContain("req-B");
  });

  it("clearActiveRun removes only its own key, not siblings", async () => {
    const ctx = setupTransaction(null);

    await setActiveRun(CONV_ID, makeEntry("req-A"));
    await setActiveRun(CONV_ID, makeEntry("req-B"));

    const { wasLast } = await clearActiveRun(CONV_ID, "req-A");
    expect(wasLast).toBe(false); // req-B still active

    const remaining = await getActiveRuns(CONV_ID);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].requestId).toBe("req-B");
    void ctx;
  });

  it("clearActiveRun returns wasLast=true when last run cleared", async () => {
    setupTransaction(null);
    await setActiveRun(CONV_ID, makeEntry("req-only"));
    const { wasLast } = await clearActiveRun(CONV_ID, "req-only");
    expect(wasLast).toBe(true);
  });

  // ─── Staleness reaper ────────────────────────────────────────────────────

  it("stale entries (>TTL) are excluded from getActiveRuns", async () => {
    // Pre-seed the doc with a stale entry (age > TTL).
    const staleEntry = makeEntry("req-stale", "ws-1", ACTIVE_RUN_TTL_MS + 1000);
    setupTransaction(makeDoc({ "req-stale": staleEntry }));

    const runs = await getActiveRuns(CONV_ID);
    expect(runs).toHaveLength(0);
  });

  it("hasActiveRuns returns false when all entries are stale", async () => {
    const staleEntry = makeEntry("req-stale", "ws-1", ACTIVE_RUN_TTL_MS + 1000);
    setupTransaction(makeDoc({ "req-stale": staleEntry }));

    expect(await hasActiveRuns(CONV_ID)).toBe(false);
  });

  it("hasActiveRuns returns true when at least one live entry exists", async () => {
    const freshEntry = makeEntry("req-fresh", "ws-1", 0);
    setupTransaction(makeDoc({ "req-fresh": freshEntry }));

    expect(await hasActiveRuns(CONV_ID)).toBe(true);
  });

  // ─── requestAbortForAllRuns ───────────────────────────────────────────────

  it("requestAbortForAllRuns flags all live runs abortRequested", async () => {
    setupTransaction(null);
    await setActiveRun(CONV_ID, makeEntry("req-A"));
    await setActiveRun(CONV_ID, makeEntry("req-B"));

    const targets = await requestAbortForAllRuns(CONV_ID);
    expect(targets).toHaveLength(2);
    expect(targets.every((r) => r.abortRequested)).toBe(true);
  });

  it("requestAbortForAllRuns does not include stale runs in its return", async () => {
    const staleEntry = makeEntry("req-stale", "ws-1", ACTIVE_RUN_TTL_MS + 1000);
    const freshEntry = makeEntry("req-fresh", "ws-1", 0);
    setupTransaction(makeDoc({ "req-stale": staleEntry, "req-fresh": freshEntry }));

    const targets = await requestAbortForAllRuns(CONV_ID);
    expect(targets).toHaveLength(1);
    expect(targets[0].requestId).toBe("req-fresh");
  });

  // ─── isAbortRequestedForRun ───────────────────────────────────────────────

  it("isAbortRequestedForRun returns false before abort is requested", async () => {
    setupTransaction(makeDoc({ "req-1": makeEntry("req-1") }));
    expect(await isAbortRequestedForRun(CONV_ID, "req-1")).toBe(false);
  });

  it("isAbortRequestedForRun returns true after requestAbortForAllRuns", async () => {
    setupTransaction(null);
    await setActiveRun(CONV_ID, makeEntry("req-1"));
    await requestAbortForAllRuns(CONV_ID);

    // Now we need the mock to return the updated doc.
    // The setupTransaction helper keeps currentDoc in sync via the update mock.
    expect(await isAbortRequestedForRun(CONV_ID, "req-1")).toBe(true);
  });

  // ─── areAllRunsAlreadyAborted ─────────────────────────────────────────────

  it("areAllRunsAlreadyAborted returns false when no runs are aborted", async () => {
    setupTransaction(makeDoc({ "req-1": makeEntry("req-1") }));
    expect(await areAllRunsAlreadyAborted(CONV_ID)).toBe(false);
  });

  it("areAllRunsAlreadyAborted returns false when no runs at all", async () => {
    setupTransaction(null);
    expect(await areAllRunsAlreadyAborted(CONV_ID)).toBe(false);
  });

  // ─── Pending-abort intent ─────────────────────────────────────────────────

  it("setPendingAbortIntent writes an intent scoped to the turnId", async () => {
    const ctx = setupTransaction(null);

    await setPendingAbortIntent(CONV_ID, "turn-1");

    const doc = ctx.getDoc() as { pendingAbortIntent?: { turnId: string } };
    expect(doc?.pendingAbortIntent?.turnId).toBe("turn-1");
  });

  it("pending-abort intent consumed by setActiveRun when turnId matches", async () => {
    const ctx = setupTransaction(null);

    // Write an intent for turn-1.
    await setPendingAbortIntent(CONV_ID, "turn-1");
    expect((ctx.getDoc() as { pendingAbortIntent?: object })?.pendingAbortIntent).toBeDefined();

    // Register a run whose requestId starts with the turnId convention.
    // The intent's turnId is matched against the first segment of requestId split by ":".
    // Our convention: when the tool layer calls setActiveRun it passes the real swarm requestId,
    // but the matching logic checks intent.turnId === entry.requestId.split(":")[0].
    // For testing purposes, use "turn-1:req-1" as the requestId.
    const result = await setActiveRun(CONV_ID, makeEntry("turn-1:req-1"));
    expect(result.pendingAbortIntent).toBeDefined();
    expect(result.pendingAbortIntent?.turnId).toBe("turn-1");
  });

  it("pending-abort intent does NOT match a different turn's run", async () => {
    const ctx = setupTransaction(null);

    // Intent is for turn-1.
    await setPendingAbortIntent(CONV_ID, "turn-1");

    // A run from turn-2 should NOT consume the intent.
    const result = await setActiveRun(CONV_ID, makeEntry("turn-2:req-1"));
    expect(result.pendingAbortIntent).toBeUndefined();

    // Intent should still be in the doc.
    const doc = ctx.getDoc() as { pendingAbortIntent?: { turnId: string } };
    expect(doc?.pendingAbortIntent?.turnId).toBe("turn-1");
  });

  it("expired pending-abort intent is not consumed", async () => {
    // Inject an already-expired intent directly.
    const expiredIntent = {
      turnId: "turn-1",
      requestedAt: new Date(Date.now() - PENDING_ABORT_TTL_MS - 1000).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already past
    };
    setupTransaction(makeDoc({}, expiredIntent));

    const result = await setActiveRun(CONV_ID, makeEntry("turn-1:req-1"));
    expect(result.pendingAbortIntent).toBeUndefined();
  });
});
