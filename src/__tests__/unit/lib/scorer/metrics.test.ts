/**
 * Unit tests for scorer metrics.ts
 *
 * Covers:
 * - getCachedWindowedMetrics / setCachedWindowedMetrics: set/get, TTL expiry, LRU eviction
 * - computeMetricsBulk (via computeAndCacheMetrics): createdAt bounds on artifact/agentLog queries,
 *   take: 500 cap on feature fetch
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    feature: { findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    artifact: { findMany: vi.fn() },
    agentLog: { groupBy: vi.fn() },
    scorerDigest: { upsert: vi.fn() },
    workspace: { update: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  getCachedWindowedMetrics,
  setCachedWindowedMetrics,
  computeAndCacheMetrics,
} from "@/lib/scorer/metrics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeature(id = "f1") {
  return {
    id,
    title: "Feature " + id,
    status: "IN_PROGRESS",
    workspaceId: "ws1",
    architecture: null,
    tasks: [
      {
        id: "t1",
        title: "Task 1",
        description: null,
        featureId: id,
        workflowStartedAt: null,
        workflowCompletedAt: null,
        haltRetryAttempted: false,
        chatMessages: [{ message: "do this please" }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Windowed cache tests
// ---------------------------------------------------------------------------

describe("getCachedWindowedMetrics / setCachedWindowedMetrics", () => {
  const wsId = "ws-cache-test";
  const win = "7d";
  const data = {
    aggregate: {
      featureCount: 1,
      avgMessagesPerTask: 1,
      ciPassRate: 0,
      avgPlanPrecision: 0,
      avgPlanRecall: 0,
      prMergeRate: 0,
    },
    features: [],
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("set and get returns the cached data", () => {
    setCachedWindowedMetrics(wsId, win, data);
    const result = getCachedWindowedMetrics(wsId, win);
    expect(result).toEqual(data);
  });

  test("returns null when no entry exists", () => {
    expect(getCachedWindowedMetrics("nonexistent", "7d")).toBeNull();
  });

  test("returns null after TTL expires (5 minutes)", () => {
    setCachedWindowedMetrics(wsId, "30d", data);
    // Advance past 5-minute TTL
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(getCachedWindowedMetrics(wsId, "30d")).toBeNull();
  });

  test("returns data before TTL expires", () => {
    setCachedWindowedMetrics(wsId, "24h", data);
    vi.advanceTimersByTime(4 * 60 * 1000); // 4 minutes — still valid
    expect(getCachedWindowedMetrics(wsId, "24h")).toEqual(data);
  });

  test("LRU eviction: oldest entry dropped when at capacity (100)", () => {
    vi.useRealTimers(); // use real timers for this test

    // Pre-fill cache to exactly 100 entries
    for (let i = 0; i < 100; i++) {
      setCachedWindowedMetrics(`ws-lru-${i}`, "7d", data);
    }

    // The first key inserted should still exist at capacity
    expect(getCachedWindowedMetrics("ws-lru-0", "7d")).toEqual(data);

    // Adding one more should evict the oldest (ws-lru-0)
    setCachedWindowedMetrics("ws-lru-overflow", "7d", data);
    expect(getCachedWindowedMetrics("ws-lru-0", "7d")).toBeNull();

    // The new entry should be present
    expect(getCachedWindowedMetrics("ws-lru-overflow", "7d")).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// computeMetricsBulk (via computeAndCacheMetrics) — query bounds
// ---------------------------------------------------------------------------

describe("computeAndCacheMetrics — DB query bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: feature.findMany returns one feature with a task
    mockDb.feature.findMany.mockResolvedValue([makeFeature()]);
    // No artifacts, no agent logs
    mockDb.artifact.findMany.mockResolvedValue([]);
    mockDb.agentLog.groupBy.mockResolvedValue([]);
    // scorerDigest upsert and workspace update succeed
    mockDb.$transaction.mockResolvedValue([]);
    mockDb.workspace.update.mockResolvedValue({});
  });

  test("feature findMany uses take: 500", async () => {
    await computeAndCacheMetrics("ws1");

    expect(mockDb.feature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 })
    );
  });

  test("artifact findMany does NOT include createdAt when no since", async () => {
    await computeAndCacheMetrics("ws1");

    expect(mockDb.artifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ createdAt: expect.anything() }),
      })
    );
  });

  test("artifact findMany includes createdAt: { gte: since } when since is provided", async () => {
    const since = new Date("2024-01-01T00:00:00Z");
    await computeAndCacheMetrics("ws1", since);

    expect(mockDb.artifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: since },
        }),
      })
    );
  });

  test("agentLog groupBy does NOT include createdAt when no since", async () => {
    await computeAndCacheMetrics("ws1");

    expect(mockDb.agentLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ createdAt: expect.anything() }),
      })
    );
  });

  test("agentLog groupBy includes createdAt: { gte: since } when since is provided", async () => {
    const since = new Date("2024-01-01T00:00:00Z");
    await computeAndCacheMetrics("ws1", since);

    expect(mockDb.agentLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: since },
        }),
      })
    );
  });

  test("feature findMany includes createdAt: { gte: since } in where when since is provided", async () => {
    const since = new Date("2024-06-01T00:00:00Z");
    await computeAndCacheMetrics("ws1", since);

    expect(mockDb.feature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: since },
        }),
      })
    );
  });
});
