/**
 * Unit tests for src/services/error-issues/spike-detection.ts
 *
 * Covers:
 * - isNew fast-path (no DB query)
 * - isRegression fast-path (no DB query)
 * - burst: below threshold, exactly at threshold, above threshold
 * - burst: window boundary timing (events exactly at edge)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockEventCount } = vi.hoisted(() => ({
  mockEventCount: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    errorEvent: {
      count: mockEventCount,
    },
  },
}));

// Import after mocking so constants are resolved with defaults
import {
  detectOnset,
  countRecentEvents,
  spikeWindowStart,
  SPIKE_MIN_COUNT,
  SPIKE_WINDOW_MINUTES,
} from "@/services/error-issues/spike-detection";

const ISSUE_ID = "issue-abc123";

describe("spikeWindowStart", () => {
  it("returns a date SPIKE_WINDOW_MINUTES before the reference timestamp", () => {
    const now = new Date("2025-06-01T12:00:00Z");
    const start = spikeWindowStart(now);
    const diffMs = now.getTime() - start.getTime();
    expect(diffMs).toBe(SPIKE_WINDOW_MINUTES * 60 * 1000);
  });
});

describe("detectOnset — fast-paths (no DB query)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns isOnset=true with reason=new when isNew=true", async () => {
    const result = await detectOnset(ISSUE_ID, true, false);
    expect(result).toEqual({ isOnset: true, reason: "new" });
    expect(mockEventCount).not.toHaveBeenCalled();
  });

  it("returns isOnset=true with reason=regression when isRegression=true", async () => {
    const result = await detectOnset(ISSUE_ID, false, true);
    expect(result).toEqual({ isOnset: true, reason: "regression" });
    expect(mockEventCount).not.toHaveBeenCalled();
  });

  it("isNew takes precedence over isRegression", async () => {
    const result = await detectOnset(ISSUE_ID, true, true);
    expect(result).toEqual({ isOnset: true, reason: "new" });
    expect(mockEventCount).not.toHaveBeenCalled();
  });
});

describe("detectOnset — burst detection (DB query)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns isOnset=false when count is below threshold", async () => {
    mockEventCount.mockResolvedValue(SPIKE_MIN_COUNT - 1);
    const result = await detectOnset(ISSUE_ID, false, false);
    expect(result).toEqual({ isOnset: false, reason: null });
    expect(mockEventCount).toHaveBeenCalledOnce();
  });

  it("returns isOnset=true when count is exactly at threshold", async () => {
    mockEventCount.mockResolvedValue(SPIKE_MIN_COUNT);
    const result = await detectOnset(ISSUE_ID, false, false);
    expect(result).toEqual({ isOnset: true, reason: "burst" });
  });

  it("returns isOnset=true when count is above threshold", async () => {
    mockEventCount.mockResolvedValue(SPIKE_MIN_COUNT + 5);
    const result = await detectOnset(ISSUE_ID, false, false);
    expect(result).toEqual({ isOnset: true, reason: "burst" });
  });

  it("passes the correct window start to db.errorEvent.count", async () => {
    mockEventCount.mockResolvedValue(0);
    const now = new Date("2025-06-01T12:30:00Z");
    await detectOnset(ISSUE_ID, false, false, now);

    expect(mockEventCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          issueId: ISSUE_ID,
          createdAt: { gte: spikeWindowStart(now) },
        }),
      }),
    );
  });
});

describe("countRecentEvents — window boundary timing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses gte so an event exactly at the window start is included", async () => {
    mockEventCount.mockResolvedValue(1);
    const now = new Date("2025-06-01T12:00:00Z");
    const count = await countRecentEvents(ISSUE_ID, now);

    const expectedStart = spikeWindowStart(now);
    expect(mockEventCount).toHaveBeenCalledWith({
      where: {
        issueId: ISSUE_ID,
        createdAt: { gte: expectedStart },
      },
    });
    expect(count).toBe(1);
  });

  it("returns zero when DB returns 0", async () => {
    mockEventCount.mockResolvedValue(0);
    const count = await countRecentEvents(ISSUE_ID, new Date());
    expect(count).toBe(0);
  });
});
