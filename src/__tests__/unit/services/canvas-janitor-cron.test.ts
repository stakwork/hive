import { describe, it, expect, vi, beforeEach } from "vitest";
import { JanitorStatus } from "@prisma/client";

vi.mock("@/services/canvas-janitor", () => ({
  runCanvasJanitorForOrg: vi.fn().mockResolvedValue({ cardsCreated: 0 }),
}));

import { db } from "@/lib/db";
import { runCanvasJanitorForOrg } from "@/services/canvas-janitor";
import { executeScheduledCanvasJanitorRuns } from "@/services/canvas-janitor-cron";

const mockedRunJanitor = vi.mocked(runCanvasJanitorForOrg);

function makeConfig(overrides: {
  orgId?: string;
  githubLogin?: string;
  enabled?: boolean;
  scheduleIntervalDays?: number;
  lastRunAt?: Date | null;
} = {}) {
  const {
    orgId = "org-1",
    githubLogin = "test-org",
    enabled = true,
    scheduleIntervalDays = 7,
    lastRunAt = null,
  } = overrides;

  return {
    id: "cfg-1",
    orgId,
    enabled,
    scheduleIntervalDays,
    lastRunAt,
    createdAt: new Date(),
    updatedAt: new Date(),
    org: { id: orgId, githubLogin },
  };
}

describe("executeScheduledCanvasJanitorRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.canvasJanitorConfig.findMany).mockResolvedValue([] as never);
    vi.mocked(db.canvasJanitorRun.updateMany).mockResolvedValue({ count: 0 } as never);
  });

  it("returns empty result when no configs exist", async () => {
    vi.mocked(db.canvasJanitorConfig.findMany).mockResolvedValue([] as never);

    const result = await executeScheduledCanvasJanitorRuns();
    expect(result.success).toBe(true);
    expect(result.orgsProcessed).toBe(0);
    expect(result.runsCreated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("runs janitor when lastRunAt is null (never run)", async () => {
    vi.mocked(db.canvasJanitorConfig.findMany).mockResolvedValue([
      makeConfig({ lastRunAt: null }),
    ] as never);

    const result = await executeScheduledCanvasJanitorRuns();
    expect(mockedRunJanitor).toHaveBeenCalledWith("org-1", "cfg-1", undefined, "SCHEDULED");
    expect(result.runsCreated).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("skips org when lastRunAt is within the schedule interval", async () => {
    // Last run 3 days ago, interval is 7 days → should skip
    const recentRunAt = new Date(Date.now() - 3 * 86_400_000);
    vi.mocked(db.canvasJanitorConfig.findMany).mockResolvedValue([
      makeConfig({ lastRunAt: recentRunAt, scheduleIntervalDays: 7 }),
    ] as never);

    const result = await executeScheduledCanvasJanitorRuns();
    expect(mockedRunJanitor).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.runsCreated).toBe(0);
  });

  it("runs janitor when lastRunAt is past the schedule interval", async () => {
    // Last run 8 days ago, interval is 7 days → should run
    const oldRunAt = new Date(Date.now() - 8 * 86_400_000);
    vi.mocked(db.canvasJanitorConfig.findMany).mockResolvedValue([
      makeConfig({ lastRunAt: oldRunAt, scheduleIntervalDays: 7 }),
    ] as never);

    const result = await executeScheduledCanvasJanitorRuns();
    expect(mockedRunJanitor).toHaveBeenCalledOnce();
    expect(result.runsCreated).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("cleans up stale RUNNING/PENDING runs older than 2 hours", async () => {
    vi.mocked(db.canvasJanitorConfig.findMany).mockResolvedValue([] as never);

    await executeScheduledCanvasJanitorRuns();

    expect(vi.mocked(db.canvasJanitorRun.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [JanitorStatus.PENDING, JanitorStatus.RUNNING] },
          startedAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
        data: { status: JanitorStatus.FAILED },
      }),
    );
  });

  it("stale cleanup threshold is approximately 2 hours ago", async () => {
    vi.mocked(db.canvasJanitorConfig.findMany).mockResolvedValue([] as never);
    const before = new Date(Date.now() - 2 * 3600_000 - 5000);
    const after = new Date(Date.now() - 2 * 3600_000 + 5000);

    await executeScheduledCanvasJanitorRuns();

    const call = vi.mocked(db.canvasJanitorRun.updateMany).mock.calls[0][0] as {
      where: { startedAt: { lt: Date } };
    };
    const threshold = call.where.startedAt.lt;
    expect(threshold.getTime()).toBeGreaterThan(before.getTime());
    expect(threshold.getTime()).toBeLessThan(after.getTime());
  });

  it("records error and continues when one org fails", async () => {
    vi.mocked(db.canvasJanitorConfig.findMany).mockResolvedValue([
      makeConfig({ orgId: "org-1", githubLogin: "org-one", lastRunAt: null }),
      makeConfig({ orgId: "org-2", githubLogin: "org-two", lastRunAt: null }),
    ] as never);

    mockedRunJanitor
      .mockRejectedValueOnce(new Error("LLM timeout"))
      .mockResolvedValueOnce({ cardsCreated: 2 });

    const result = await executeScheduledCanvasJanitorRuns();
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].githubLogin).toBe("org-one");
    expect(result.runsCreated).toBe(1);
  });
});
