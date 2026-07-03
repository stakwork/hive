import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { executeScheduledActivityRecapRuns } from "@/services/daily-recap-cron";
import { db } from "@/lib/db";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db");

const mockCreateBatchProjects = vi.fn();
vi.mock("@/lib/service-factory", () => ({
  stakworkService: () => ({
    createBatchProjects: mockCreateBatchProjects,
  }),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_DAILY_RECAP_WORKFLOW_ID: "42",
  },
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: () => "https://hive.example.com",
}));

vi.mock("@/services/roadmap/user-activity", () => ({
  getUserActivityFeed: vi.fn(),
}));

import { getUserActivityFeed } from "@/services/roadmap/user-activity";

const mockedDb = vi.mocked(db);
const mockedGetUserActivityFeed = vi.mocked(getUserActivityFeed);

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeRun = (id: string) => ({
  id,
  type: StakworkRunType.DAILY_RECAP,
  status: WorkflowStatus.PENDING,
  userId: `user-${id}`,
  workspaceId: "ws-1",
  webhookUrl: "",
  projectId: null,
  featureId: null,
  taskId: null,
  result: null,
  dataType: "string",
  feedback: null,
  decision: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  autoAccept: false,
  promptVersionId: null,
  evalSetId: null,
});

const makeActivityItems = (n = 3) =>
  Array.from({ length: n }, (_, i) => ({
    id: `item-${i}`,
    kind: "task" as const,
    category: "task" as const,
    action: "created" as const,
    title: `Task ${i}`,
    link: "/tasks/x",
    workspaceName: "Test WS",
    orgName: "Org",
    timestamp: new Date().toISOString(),
    completed: false,
  }));

/**
 * Per-user findFirst call order (happy path — activity found):
 *   0: cursor   — COMPLETED run for `since`
 *   1: lastResultRun — COMPLETED run with result != null for previous_recap
 *   2: inflightRun  — guard check
 *
 * When no activity found (skip path), only call 0 (cursor) fires.
 */
function setupDb(overrides: Partial<{
  users: unknown[];
  ownedWorkspace: unknown;
  membership: unknown;
  lastRun: unknown;
  lastResultRun: unknown;
  inflightRun: unknown;
  stakworkRunCreate: unknown;
  stakworkRunUpdate: unknown;
  reaperCount: number;
}> = {}) {
  const {
    users = [{ id: "user-1" }],
    ownedWorkspace = { id: "ws-1" },
    membership = null,
    lastRun = null,
    lastResultRun = null,
    inflightRun = null,
    stakworkRunCreate = makeRun("run-1"),
    stakworkRunUpdate = makeRun("run-1"),
    reaperCount = 0,
  } = overrides;

  Object.assign(db, {
    user: {
      findMany: vi.fn().mockResolvedValue(users),
    },
    workspace: {
      findFirst: vi.fn().mockResolvedValue(ownedWorkspace),
    },
    workspaceMember: {
      findFirst: vi.fn().mockResolvedValue(membership),
    },
    stakworkRun: {
      findFirst: vi.fn()
        .mockResolvedValueOnce(lastRun)       // [0] cursor (COMPLETED run for since)
        .mockResolvedValueOnce(lastResultRun) // [1] previous_recap (COMPLETED with result != null)
        .mockResolvedValueOnce(inflightRun)   // [2] guard check
        .mockResolvedValue(null),             // subsequent users
      create: vi.fn().mockResolvedValue(stakworkRunCreate),
      update: vi.fn().mockResolvedValue(stakworkRunUpdate),
      updateMany: vi.fn().mockResolvedValue({ count: reaperCount }),
    },
  });
}

// ── vercel.json ──────────────────────────────────────────────────────────────

describe("Daily Recap Cron — vercel.json configuration", () => {
  it("should have daily-recap cron scheduled hourly (0 * * * *)", () => {
    const vercelPath = path.join(process.cwd(), "vercel.json");
    expect(fs.existsSync(vercelPath)).toBe(true);

    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
    expect(vercelConfig.crons).toBeDefined();

    const dailyCron = vercelConfig.crons.find(
      (c: { path: string }) => c.path === "/api/cron/daily-recap",
    );
    expect(dailyCron).toBeDefined();
    expect(dailyCron.schedule).toBe("0 * * * *");
  });
});

// ── executeScheduledActivityRecapRuns ───────────────────────────────────────────

describe("executeScheduledActivityRecapRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips users when no workspace can be attributed", async () => {
    setupDb({ ownedWorkspace: null, membership: null });
    mockedGetUserActivityFeed.mockResolvedValue([]);

    const result = await executeScheduledActivityRecapRuns();

    expect(result.skipped).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(mockedDb.stakworkRun.create).not.toHaveBeenCalled();
  });

  it("skips users with empty activity feed (strict activity gate)", async () => {
    setupDb();
    mockedGetUserActivityFeed.mockResolvedValue([]);

    const result = await executeScheduledActivityRecapRuns();

    expect(result.skipped).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(mockedDb.stakworkRun.create).not.toHaveBeenCalled();
  });

  it("creates a PENDING row and queues a batch entry for users with activity", async () => {
    setupDb();
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(3));
    mockCreateBatchProjects.mockResolvedValue({
      data: {
        ref_id: "ref-1",
        projects: [{ name: "daily-recap-run-1", project_id: 999 }],
      },
    });

    const result = await executeScheduledActivityRecapRuns();

    expect(mockedDb.stakworkRun.create).toHaveBeenCalledOnce();
    const createCall = vi.mocked(mockedDb.stakworkRun.create).mock.calls[0][0];
    expect(createCall.data).toMatchObject({
      type: StakworkRunType.DAILY_RECAP,
      userId: "user-1",
      workspaceId: "ws-1",
      status: WorkflowStatus.PENDING,
      dataType: "string",
      autoAccept: false,
    });

    expect(mockCreateBatchProjects).toHaveBeenCalledOnce();

    // Back-fill: sets projectId + IN_PROGRESS
    const updateCalls = vi.mocked(mockedDb.stakworkRun.update).mock.calls;
    const backFill = updateCalls.find((c) => c[0].data?.projectId === 999);
    expect(backFill).toBeDefined();
    expect(backFill![0].data).toMatchObject({
      projectId: 999,
      status: WorkflowStatus.IN_PROGRESS,
    });

    expect(result.dispatched).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("dispatched vars contain exactly previous_recap, since, activity, window_start, webhookUrl", async () => {
    setupDb({ lastResultRun: { result: "Prior recap text" } });
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(2));
    mockCreateBatchProjects.mockResolvedValue({
      data: {
        ref_id: "ref-1",
        projects: [{ name: "daily-recap-run-1", project_id: 1 }],
      },
    });

    const before = Date.now();
    await executeScheduledDailyRecapRuns();
    const after = Date.now();

    const batchCall = mockCreateBatchProjects.mock.calls[0][0];
    const vars = batchCall[0].workflow_params.set_var.attributes.vars;

    expect(Object.keys(vars).sort()).toEqual(
      ["activity", "previous_recap", "since", "webhookUrl", "window_start"].sort(),
    );
    expect(vars.previous_recap).toBe("Prior recap text");
    expect(typeof vars.since).toBe("string");
    expect(typeof vars.activity).toBe("string");
    expect(typeof vars.window_start).toBe("string");
    expect(typeof vars.webhookUrl).toBe("string");

    // window_start should be ~24h before dispatch time
    const windowStart = new Date(vars.window_start as string).getTime();
    expect(windowStart).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 1000);
    expect(windowStart).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000 + 1000);
  });

  it("uses empty string for previous_recap when no prior result run exists", async () => {
    setupDb({ lastResultRun: null });
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(1));
    mockCreateBatchProjects.mockResolvedValue({
      data: {
        ref_id: "ref-1",
        projects: [{ name: "daily-recap-run-1", project_id: 1 }],
      },
    });

    await executeScheduledDailyRecapRuns();

    const batchCall = mockCreateBatchProjects.mock.calls[0][0];
    const vars = batchCall[0].workflow_params.set_var.attributes.vars;
    expect(vars.previous_recap).toBe("");
  });

  it("splits >500 eligible users into exactly 2 batch calls", async () => {
    const users = Array.from({ length: 501 }, (_, i) => ({ id: `user-${i}` }));

    setupDb({ users });
    // Each user gets a unique run id so back-fill works
    users.forEach((_, i) => {
      vi.mocked(mockedDb.stakworkRun.create).mockResolvedValueOnce(makeRun(`run-${i}`) as any);
    });
    vi.mocked(mockedDb.stakworkRun.update).mockResolvedValue(makeRun("x") as any);
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(1));

    // Build per-batch responses
    mockCreateBatchProjects.mockImplementation(async (payload: Array<{ name: string }>) => ({
      data: {
        ref_id: "ref",
        projects: payload.map((p) => ({ name: p.name, project_id: 1 })),
      },
    }));

    const result = await executeScheduledActivityRecapRuns();

    expect(mockCreateBatchProjects).toHaveBeenCalledTimes(2);
    expect(result.usersProcessed).toBe(501);
    expect(result.dispatched).toBe(501);
  });

  it("back-fills projectId and sets IN_PROGRESS on success", async () => {
    setupDb();
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(2));
    mockCreateBatchProjects.mockResolvedValue({
      data: {
        ref_id: "ref-1",
        projects: [{ name: "daily-recap-run-1", project_id: 777 }],
      },
    });

    await executeScheduledActivityRecapRuns();

    const updateCalls = vi.mocked(mockedDb.stakworkRun.update).mock.calls;
    const backFillCall = updateCalls.find((c) => c[0].data?.projectId === 777);
    expect(backFillCall).toBeDefined();
    expect(backFillCall![0].data.status).toBe(WorkflowStatus.IN_PROGRESS);
  });

  it("marks the row as FAILED and logs an error when batch item has no project_id", async () => {
    setupDb();
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(1));
    mockCreateBatchProjects.mockResolvedValue({
      data: {
        ref_id: "ref-1",
        projects: [{ name: "daily-recap-run-1", error: "workflow error" }],
      },
    });

    const result = await executeScheduledActivityRecapRuns();

    // Row set to FAILED
    const updateCalls = vi.mocked(mockedDb.stakworkRun.update).mock.calls;
    const failCall = updateCalls.find((c) => c[0].data?.status === WorkflowStatus.FAILED);
    expect(failCall).toBeDefined();

    // Error recorded, but loop continues (dispatched = 0)
    expect(result.dispatched).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("marks all rows in a chunk FAILED if the batch call throws, without aborting other chunks", async () => {
    const users = [{ id: "user-A" }, { id: "user-B" }];
    setupDb({ users });
    vi.mocked(mockedDb.stakworkRun.create)
      .mockResolvedValueOnce(makeRun("run-A") as any)
      .mockResolvedValueOnce(makeRun("run-B") as any);
    vi.mocked(mockedDb.stakworkRun.update).mockResolvedValue(makeRun("x") as any);
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(1));

    // Reject with an ApiError object literal — matching what handleRequest actually throws
    mockCreateBatchProjects.mockRejectedValue({
      message: "stakwork stakworkRequest /projects/batch: HTTP 400 Bad Request",
      status: 400,
      service: "stakwork",
      details: { body: "param is missing or the value is empty: project" },
    });

    const result = await executeScheduledActivityRecapRuns();

    // Both users error-logged with the real message (not '[object Object]')
    expect(result.errors.length).toBe(2);
    expect(result.dispatched).toBe(0);
    expect(result.errors[0].error).toBe(
      "stakwork stakworkRequest /projects/batch: HTTP 400 Bad Request",
    );
    expect(result.errors[1].error).toBe(
      "stakwork stakworkRequest /projects/batch: HTTP 400 Bad Request",
    );
  });
});

// ── Staleness reaper ─────────────────────────────────────────────────────────

describe("Staleness reaper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls updateMany with correct filters to reap stale PENDING/IN_PROGRESS runs", async () => {
    setupDb();
    mockedGetUserActivityFeed.mockResolvedValue([]);

    await executeScheduledActivityRecapRuns();

    expect(mockedDb.stakworkRun.updateMany).toHaveBeenCalledOnce();
    const call = vi.mocked(mockedDb.stakworkRun.updateMany).mock.calls[0][0];
    expect(call.where).toMatchObject({
      type: StakworkRunType.DAILY_RECAP,
      status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
    });
    expect(call.where?.createdAt).toHaveProperty("lt");
    expect(call.data).toEqual({ status: WorkflowStatus.FAILED });
  });

  it("logs a warning when reaped.count > 0", async () => {
    setupDb({ reaperCount: 3 });
    mockedGetUserActivityFeed.mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await executeScheduledActivityRecapRuns();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Reaped 3 stale DAILY_RECAP run(s)"),
    );
    warnSpy.mockRestore();
  });

  it("does NOT log a warning when reaped.count === 0", async () => {
    setupDb({ reaperCount: 0 });
    mockedGetUserActivityFeed.mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await executeScheduledActivityRecapRuns();

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("Reaped"));
    warnSpy.mockRestore();
  });
});

// ── COMPLETED-only cursor ─────────────────────────────────────────────────────

describe("COMPLETED-only cursor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes status: COMPLETED in the lastRun findFirst query", async () => {
    setupDb();
    mockedGetUserActivityFeed.mockResolvedValue([]);

    await executeScheduledActivityRecapRuns();

    // First findFirst call is the cursor
    const cursorCall = vi.mocked(mockedDb.stakworkRun.findFirst).mock.calls[0][0];
    expect(cursorCall?.where).toMatchObject({ status: WorkflowStatus.COMPLETED });
  });

  it("defaults since to ~24h ago when no prior COMPLETED run exists", async () => {
    setupDb({ lastRun: null });
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(1));
    mockCreateBatchProjects.mockResolvedValue({
      data: { ref_id: "r", projects: [{ name: "daily-recap-run-1", project_id: 1 }] },
    });

    const before = Date.now();
    await executeScheduledActivityRecapRuns();
    const after = Date.now();

    // since is passed directly now (not days)
    const activityCall = mockedGetUserActivityFeed.mock.calls[0][0];
    expect(activityCall.since).toBeInstanceOf(Date);

    const sinceMs = (activityCall.since as Date).getTime();
    expect(sinceMs).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 1000);
    expect(sinceMs).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000 + 1000);
  });

  it("uses lastRun.createdAt as the since date when a COMPLETED run exists", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    setupDb({ lastRun: { createdAt: twoDaysAgo } });
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(1));
    mockCreateBatchProjects.mockResolvedValue({
      data: { ref_id: "r", projects: [{ name: "daily-recap-run-1", project_id: 1 }] },
    });

    await executeScheduledActivityRecapRuns();

    const activityCall = mockedGetUserActivityFeed.mock.calls[0][0];
    expect(activityCall.since).toEqual(twoDaysAgo);
  });

  it("passes since directly to getUserActivityFeed (not days)", async () => {
    const cursor = new Date(Date.now() - 90 * 60 * 1000); // 90 min ago
    setupDb({ lastRun: { createdAt: cursor } });
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(2));
    mockCreateBatchProjects.mockResolvedValue({
      data: { ref_id: "r", projects: [{ name: "daily-recap-run-1", project_id: 1 }] },
    });

    await executeScheduledDailyRecapRuns();

    const activityCall = mockedGetUserActivityFeed.mock.calls[0][0];
    expect(activityCall.since).toEqual(cursor);
    expect(activityCall.days).toBeUndefined();
  });

  it("logs since and zero count when skipping due to empty activity", async () => {
    const cursor = new Date(Date.now() - 30 * 60 * 1000);
    setupDb({ lastRun: { createdAt: cursor } });
    mockedGetUserActivityFeed.mockResolvedValue([]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeScheduledDailyRecapRuns();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("no activity since"));
    logSpy.mockRestore();
  });
});

// ── In-flight guard ───────────────────────────────────────────────────────────

describe("In-flight guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips user and increments skipped when a fresh in-flight run exists", async () => {
    const freshRun = { id: "run-inflight", createdAt: new Date(Date.now() - 5 * 60_000) }; // 5 min old
    setupDb({ inflightRun: freshRun });
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(3));

    const result = await executeScheduledActivityRecapRuns();

    expect(result.skipped).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(mockedDb.stakworkRun.create).not.toHaveBeenCalled();
  });

  it("does NOT skip user when guard findFirst returns null (no in-flight run)", async () => {
    setupDb({ inflightRun: null });
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(2));
    mockCreateBatchProjects.mockResolvedValue({
      data: { ref_id: "r", projects: [{ name: "daily-recap-run-1", project_id: 1 }] },
    });

    const result = await executeScheduledActivityRecapRuns();

    expect(result.skipped).toBe(0);
    expect(mockedDb.stakworkRun.create).toHaveBeenCalledOnce();
  });

  it("logs the userId and run age when skipping due to in-flight guard", async () => {
    const freshRun = { id: "run-inflight", createdAt: new Date(Date.now() - 10 * 60_000) }; // 10 min old
    setupDb({ inflightRun: freshRun });
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(1));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeScheduledActivityRecapRuns();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping user user-1"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("in-flight run run-inflight"),
    );
    logSpy.mockRestore();
  });

  it("does NOT call db.stakworkRun.create for a guarded user", async () => {
    const freshRun = { id: "run-inf", createdAt: new Date(Date.now() - 2 * 60_000) };
    setupDb({ inflightRun: freshRun });
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(3));

    await executeScheduledActivityRecapRuns();

    expect(mockedDb.stakworkRun.create).not.toHaveBeenCalled();
  });

  it("queries guard with status IN [PENDING, IN_PROGRESS] and createdAt >= guardCutoff", async () => {
    setupDb({ inflightRun: null });
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(1));
    mockCreateBatchProjects.mockResolvedValue({
      data: { ref_id: "r", projects: [{ name: "daily-recap-run-1", project_id: 1 }] },
    });

    await executeScheduledActivityRecapRuns();

    // Guard is the 3rd findFirst call (index 2): cursor [0], lastResultRun [1], guard [2]
    const guardCall = vi.mocked(mockedDb.stakworkRun.findFirst).mock.calls[2][0];
    expect(guardCall?.where).toMatchObject({
      type: StakworkRunType.DAILY_RECAP,
      status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
    });
    expect(guardCall?.where?.createdAt).toHaveProperty("gte");
  });
});

// ── window_start rolling-24h horizon ─────────────────────────────────────────

describe("window_start rolling-24h horizon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("window_start is always ~24h before dispatch (not read from DB)", async () => {
    setupDb();
    mockedGetUserActivityFeed.mockResolvedValue(makeActivityItems(1));
    mockCreateBatchProjects.mockResolvedValue({
      data: { ref_id: "r", projects: [{ name: "daily-recap-run-1", project_id: 1 }] },
    });

    const before = Date.now();
    await executeScheduledDailyRecapRuns();
    const after = Date.now();

    const batchCall = mockCreateBatchProjects.mock.calls[0][0];
    const windowStart = new Date(batchCall[0].workflow_params.set_var.attributes.vars.window_start as string).getTime();

    expect(windowStart).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 1000);
    expect(windowStart).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000 + 1000);
  });
});
