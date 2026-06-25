import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { executeScheduledDailyRecapRuns } from "@/services/daily-recap-cron";
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

function setupDb(overrides: Partial<{
  users: unknown[];
  ownedWorkspace: unknown;
  membership: unknown;
  lastRun: unknown;
  stakworkRunCreate: unknown;
  stakworkRunUpdate: unknown;
}> = {}) {
  const {
    users = [{ id: "user-1" }],
    ownedWorkspace = { id: "ws-1" },
    membership = null,
    lastRun = null,
    stakworkRunCreate = makeRun("run-1"),
    stakworkRunUpdate = makeRun("run-1"),
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
      findFirst: vi.fn().mockResolvedValue(lastRun),
      create: vi.fn().mockResolvedValue(stakworkRunCreate),
      update: vi.fn().mockResolvedValue(stakworkRunUpdate),
    },
  });
}

// ── vercel.json ──────────────────────────────────────────────────────────────

describe("Daily Recap Cron — vercel.json configuration", () => {
  it("should have daily-recap cron job configured", () => {
    const vercelPath = path.join(process.cwd(), "vercel.json");
    expect(fs.existsSync(vercelPath)).toBe(true);

    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
    expect(vercelConfig.crons).toBeDefined();

    const dailyCron = vercelConfig.crons.find(
      (c: { path: string }) => c.path === "/api/cron/daily-recap",
    );
    expect(dailyCron).toBeDefined();
    expect(typeof dailyCron.schedule).toBe("string");

    const parts = dailyCron.schedule.split(" ");
    expect(parts).toHaveLength(5);
  });
});

// ── executeScheduledDailyRecapRuns ───────────────────────────────────────────

describe("executeScheduledDailyRecapRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips users when no workspace can be attributed", async () => {
    setupDb({ ownedWorkspace: null, membership: null });
    mockedGetUserActivityFeed.mockResolvedValue([]);

    const result = await executeScheduledDailyRecapRuns();

    expect(result.skipped).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(mockedDb.stakworkRun.create).not.toHaveBeenCalled();
  });

  it("skips users with empty activity feed", async () => {
    setupDb();
    mockedGetUserActivityFeed.mockResolvedValue([]);

    const result = await executeScheduledDailyRecapRuns();

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

    const result = await executeScheduledDailyRecapRuns();

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

    const result = await executeScheduledDailyRecapRuns();

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

    await executeScheduledDailyRecapRuns();

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

    const result = await executeScheduledDailyRecapRuns();

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

    mockCreateBatchProjects.mockRejectedValue(new Error("network failure"));

    const result = await executeScheduledDailyRecapRuns();

    // Both users error-logged
    expect(result.errors.length).toBe(2);
    expect(result.dispatched).toBe(0);
  });
});
