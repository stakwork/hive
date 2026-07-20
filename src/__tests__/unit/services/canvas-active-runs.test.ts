/**
 * Unit tests for `src/services/canvas-active-runs.ts`.
 *
 * Coverage:
 *  1. setActiveRun writes the entry and concurrent calls don't clobber each other
 *  2. clearActiveRun removes only its own key; sibling keys survive
 *  3. requestAbortForRuns sets abortRequested on targeted keys only
 *  4. getActiveRuns filters out stale entries (past TTL)
 *  5. isRunAbortRequested returns true/false correctly
 *  6. setPendingAbortIntent + consumePendingAbortIntent (happy path)
 *  7. consumePendingAbortIntent is idempotent (second call → null)
 *  8. consumePendingAbortIntent returns null for a different turnId
 *  9. Stale entries are pruned on next write
 * 10. hasActiveRun returns false when only stale entries remain
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Prisma mock ──────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    sharedConversation: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  setActiveRun,
  clearActiveRun,
  requestAbortForRuns,
  getActiveRuns,
  isRunAbortRequested,
  setPendingAbortIntent,
  consumePendingAbortIntent,
  hasActiveRun,
  ACTIVE_RUN_TTL_MS,
  ABORT_INTENT_TTL_MS,
} from "@/services/canvas-active-runs";

// ── Type aliases for mock cast ────────────────────────────────────────────────
const txn = db.$transaction as ReturnType<typeof vi.fn>;
const findFirst = db.sharedConversation.findFirst as ReturnType<typeof vi.fn>;
const update = db.sharedConversation.update as ReturnType<typeof vi.fn>;

const CONV_ID = "conv-test-1";

// ── Transaction simulator ────────────────────────────────────────────────────
/**
 * Simulates the row-locking transaction: the callback receives a tx object
 * whose `$queryRaw` returns `[{ active_runs: currentValue }]`.
 * Updates are captured in `updates`.
 */
function setupTxn(currentActiveRuns: unknown) {
  const updates: unknown[] = [];
  txn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ active_runs: currentActiveRuns }]),
      sharedConversation: {
        update: vi.fn().mockImplementation(({ data }: { data: { activeRuns: unknown } }) => {
          updates.push(data.activeRuns);
          // Update the "DB" so the next read sees the latest value.
          currentActiveRuns = data.activeRuns;
          return Promise.resolve({});
        }),
      },
    };
    await cb(tx);
  });
  return { updates, getCurrentValue: () => currentActiveRuns };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("setActiveRun", () => {
  it("writes an entry under the requestId key", async () => {
    const { updates } = setupTxn(null);

    await setActiveRun(CONV_ID, {
      requestId: "req-1",
      workspaceId: "ws-1",
      startedAt: new Date().toISOString(),
    });

    expect(updates).toHaveLength(1);
    const written = updates[0] as { runs: Record<string, unknown> };
    expect(written.runs["req-1"]).toBeDefined();
    expect((written.runs["req-1"] as { requestId: string }).requestId).toBe("req-1");
  });

  it("two concurrent setActiveRun calls each persist their key without clobbering", async () => {
    // Simulate concurrent calls by running both through the same txn helper,
    // but we need to serialize them since the txn mock is sequential.
    const now = new Date().toISOString();
    let state: unknown = null;

    // Make txn actually accumulate state.
    txn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const currentState = state;
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ active_runs: currentState }]),
        sharedConversation: {
          update: vi.fn().mockImplementation(({ data }: { data: { activeRuns: unknown } }) => {
            state = data.activeRuns;
            return Promise.resolve({});
          }),
        },
      };
      await cb(tx);
    });

    await setActiveRun(CONV_ID, { requestId: "req-A", workspaceId: "ws-1", startedAt: now });
    await setActiveRun(CONV_ID, { requestId: "req-B", workspaceId: "ws-2", startedAt: now });

    const col = state as { runs: Record<string, unknown> };
    expect(col.runs["req-A"]).toBeDefined();
    expect(col.runs["req-B"]).toBeDefined();
  });
});

describe("clearActiveRun", () => {
  it("removes only its own key; sibling key survives", async () => {
    const now = new Date().toISOString();
    const initial = {
      runs: {
        "req-1": { requestId: "req-1", workspaceId: "ws-1", startedAt: now },
        "req-2": { requestId: "req-2", workspaceId: "ws-2", startedAt: now },
      },
      abortIntents: {},
    };
    const { updates } = setupTxn(initial);

    await clearActiveRun(CONV_ID, "req-1");

    const written = updates[0] as { runs: Record<string, unknown> };
    expect(written.runs["req-1"]).toBeUndefined();
    expect(written.runs["req-2"]).toBeDefined();
  });
});

describe("requestAbortForRuns", () => {
  it("sets abortRequested on targeted keys only", async () => {
    const now = new Date().toISOString();
    const initial = {
      runs: {
        "req-1": { requestId: "req-1", workspaceId: "ws-1", startedAt: now },
        "req-2": { requestId: "req-2", workspaceId: "ws-2", startedAt: now },
      },
      abortIntents: {},
    };
    const { updates } = setupTxn(initial);

    await requestAbortForRuns(CONV_ID, ["req-1"]);

    const written = updates[0] as { runs: Record<string, { abortRequested?: boolean }> };
    expect(written.runs["req-1"]?.abortRequested).toBe(true);
    expect(written.runs["req-2"]?.abortRequested).toBeUndefined();
  });

  it("silently skips missing keys (already cleared)", async () => {
    const { updates } = setupTxn({ runs: {}, abortIntents: {} });
    await expect(requestAbortForRuns(CONV_ID, ["req-ghost"])).resolves.not.toThrow();
    expect(updates).toHaveLength(1);
  });
});

describe("getActiveRuns", () => {
  it("returns non-stale entries", async () => {
    const now = new Date().toISOString();
    findFirst.mockResolvedValue({
      activeRuns: {
        runs: { "req-1": { requestId: "req-1", workspaceId: "ws-1", startedAt: now } },
        abortIntents: {},
      },
    });

    const runs = await getActiveRuns(CONV_ID);
    expect(runs).toHaveLength(1);
    expect(runs[0].requestId).toBe("req-1");
  });

  it("filters out stale entries (past TTL)", async () => {
    const staleTime = new Date(Date.now() - ACTIVE_RUN_TTL_MS - 1000).toISOString();
    findFirst.mockResolvedValue({
      activeRuns: {
        runs: {
          "req-stale": { requestId: "req-stale", workspaceId: "ws-1", startedAt: staleTime },
        },
        abortIntents: {},
      },
    });

    const runs = await getActiveRuns(CONV_ID);
    expect(runs).toHaveLength(0);
  });

  it("returns empty array when no activeRuns column exists", async () => {
    findFirst.mockResolvedValue({ activeRuns: null });
    const runs = await getActiveRuns(CONV_ID);
    expect(runs).toEqual([]);
  });
});

describe("isRunAbortRequested", () => {
  it("returns true when the flag is set", async () => {
    const now = new Date().toISOString();
    findFirst.mockResolvedValue({
      activeRuns: {
        runs: {
          "req-1": {
            requestId: "req-1",
            workspaceId: "ws-1",
            startedAt: now,
            abortRequested: true,
          },
        },
        abortIntents: {},
      },
    });

    expect(await isRunAbortRequested(CONV_ID, "req-1")).toBe(true);
  });

  it("returns false when the flag is not set", async () => {
    const now = new Date().toISOString();
    findFirst.mockResolvedValue({
      activeRuns: {
        runs: { "req-1": { requestId: "req-1", workspaceId: "ws-1", startedAt: now } },
        abortIntents: {},
      },
    });

    expect(await isRunAbortRequested(CONV_ID, "req-1")).toBe(false);
  });

  it("returns false when the entry is gone (already cleared)", async () => {
    findFirst.mockResolvedValue({ activeRuns: { runs: {}, abortIntents: {} } });
    expect(await isRunAbortRequested(CONV_ID, "req-gone")).toBe(false);
  });
});

describe("setPendingAbortIntent / consumePendingAbortIntent", () => {
  it("stores and then consumes the intent", async () => {
    let state: unknown = { runs: {}, abortIntents: {} };
    txn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ active_runs: state }]),
        sharedConversation: {
          update: vi.fn().mockImplementation(({ data }: { data: { activeRuns: unknown } }) => {
            state = data.activeRuns;
            return Promise.resolve({});
          }),
        },
      };
      await cb(tx);
    });

    await setPendingAbortIntent(CONV_ID, "turn-1");
    const intent = await consumePendingAbortIntent(CONV_ID, "turn-1");

    expect(intent).not.toBeNull();
    expect(intent?.turnId).toBe("turn-1");
  });

  it("consumePendingAbortIntent is idempotent — second call returns null", async () => {
    let state: unknown = { runs: {}, abortIntents: {} };
    txn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ active_runs: state }]),
        sharedConversation: {
          update: vi.fn().mockImplementation(({ data }: { data: { activeRuns: unknown } }) => {
            state = data.activeRuns;
            return Promise.resolve({});
          }),
        },
      };
      await cb(tx);
    });

    await setPendingAbortIntent(CONV_ID, "turn-2");
    await consumePendingAbortIntent(CONV_ID, "turn-2"); // first consume
    const second = await consumePendingAbortIntent(CONV_ID, "turn-2"); // second consume
    expect(second).toBeNull();
  });

  it("does not consume an intent for a different turnId", async () => {
    let state: unknown = { runs: {}, abortIntents: {} };
    txn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ active_runs: state }]),
        sharedConversation: {
          update: vi.fn().mockImplementation(({ data }: { data: { activeRuns: unknown } }) => {
            state = data.activeRuns;
            return Promise.resolve({});
          }),
        },
      };
      await cb(tx);
    });

    await setPendingAbortIntent(CONV_ID, "turn-A");
    const result = await consumePendingAbortIntent(CONV_ID, "turn-B"); // different turn
    expect(result).toBeNull();

    // The intent for turn-A should still be there.
    const remaining = await consumePendingAbortIntent(CONV_ID, "turn-A");
    expect(remaining).not.toBeNull();
    expect(remaining?.turnId).toBe("turn-A");
  });

  it("returns null for an expired intent", async () => {
    const expiredTime = new Date(Date.now() - ABORT_INTENT_TTL_MS - 1000).toISOString();
    const state = {
      runs: {},
      abortIntents: {
        "turn-old": {
          turnId: "turn-old",
          requestedAt: expiredTime,
          expiresAt: expiredTime, // already expired
        },
      },
    };
    txn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ active_runs: state }]),
        sharedConversation: { update: vi.fn().mockResolvedValue({}) },
      };
      await cb(tx);
    });

    const result = await consumePendingAbortIntent(CONV_ID, "turn-old");
    expect(result).toBeNull();
  });
});

describe("hasActiveRun", () => {
  it("returns true when a fresh run exists", async () => {
    findFirst.mockResolvedValue({
      activeRuns: {
        runs: {
          "req-1": {
            requestId: "req-1",
            workspaceId: "ws-1",
            startedAt: new Date().toISOString(),
          },
        },
        abortIntents: {},
      },
    });

    expect(await hasActiveRun(CONV_ID)).toBe(true);
  });

  it("returns false when only stale entries remain", async () => {
    const staleTime = new Date(Date.now() - ACTIVE_RUN_TTL_MS - 1000).toISOString();
    findFirst.mockResolvedValue({
      activeRuns: {
        runs: {
          "req-stale": { requestId: "req-stale", workspaceId: "ws-1", startedAt: staleTime },
        },
        abortIntents: {},
      },
    });

    expect(await hasActiveRun(CONV_ID)).toBe(false);
  });

  it("returns false when there are no runs at all", async () => {
    findFirst.mockResolvedValue({ activeRuns: null });
    expect(await hasActiveRun(CONV_ID)).toBe(false);
  });
});

describe("stale entry pruning on write", () => {
  it("stale entries are removed during the next setActiveRun write", async () => {
    const staleTime = new Date(Date.now() - ACTIVE_RUN_TTL_MS - 5000).toISOString();
    const initial = {
      runs: {
        "req-stale": { requestId: "req-stale", workspaceId: "ws-1", startedAt: staleTime },
      },
      abortIntents: {},
    };

    const updates: unknown[] = [];
    txn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ active_runs: initial }]),
        sharedConversation: {
          update: vi.fn().mockImplementation(({ data }: { data: { activeRuns: unknown } }) => {
            updates.push(data.activeRuns);
            return Promise.resolve({});
          }),
        },
      };
      await cb(tx);
    });

    await setActiveRun(CONV_ID, {
      requestId: "req-fresh",
      workspaceId: "ws-2",
      startedAt: new Date().toISOString(),
    });

    const written = updates[0] as { runs: Record<string, unknown> };
    expect(written.runs["req-stale"]).toBeUndefined();
    expect(written.runs["req-fresh"]).toBeDefined();
  });
});
