import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { hasActiveJanitorTask } from "@/services/janitor-cron";
import { db } from "@/lib/db";
import { JanitorType, TaskStatus, WorkflowStatus } from "@prisma/client";

vi.mock("@/lib/db");

const mockedDb = vi.mocked(db);

describe("Janitor Cron Configuration", () => {
  describe("vercel.json cron configuration", () => {
    it("should have janitor cron job configured", () => {
      const vercelPath = path.join(process.cwd(), "vercel.json");
      expect(fs.existsSync(vercelPath)).toBe(true);

      const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
      expect(vercelConfig.crons).toBeDefined();
      expect(Array.isArray(vercelConfig.crons)).toBe(true);

      const janitorCron = vercelConfig.crons.find((cron: { path: string; schedule: string }) => cron.path === "/api/cron/janitors");
      expect(janitorCron).toBeDefined();
      expect(janitorCron.schedule).toBeDefined();
      expect(typeof janitorCron.schedule).toBe("string");
    });

    it("should have a valid cron schedule format", () => {
      const vercelPath = path.join(process.cwd(), "vercel.json");
      const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
      const janitorCron = vercelConfig.crons.find((cron: { path: string; schedule: string }) => cron.path === "/api/cron/janitors");

      // Basic validation that it has 5 parts (minute hour day month dayofweek)
      const scheduleParts = janitorCron.schedule.split(" ");
      expect(scheduleParts).toHaveLength(5);
    });
  });
});

describe("hasActiveJanitorTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(db, {
      task: {
        findFirst: vi.fn(),
      },
    });
  });

  const createMockTask = (overrides: {
    status?: TaskStatus;
    workflowStatus?: WorkflowStatus;
    prArtifacts?: Array<{ content: { status?: string } }>;
  } = {}) => {
    const { status = TaskStatus.IN_PROGRESS, workflowStatus = WorkflowStatus.IN_PROGRESS, prArtifacts = [] } = overrides;

    return {
      id: "task-1",
      workspaceId: "ws-1",
      janitorType: JanitorType.UNIT_TESTS,
      status,
      workflowStatus,
      deleted: false,
      chatMessages: prArtifacts.length > 0 ? [{
        artifacts: prArtifacts,
      }] : [],
    };
  };

  it("should return false when no janitor tasks exist", async () => {
    vi.mocked(mockedDb.task.findFirst).mockResolvedValue(null);

    const result = await hasActiveJanitorTask("ws-1", JanitorType.UNIT_TESTS);

    expect(result).toBe(false);
  });

  it("should return true when task has no PR artifacts and status is not DONE", async () => {
    vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
      createMockTask({ status: TaskStatus.IN_PROGRESS }) as any,
    );

    const result = await hasActiveJanitorTask("ws-1", JanitorType.UNIT_TESTS);

    expect(result).toBe(true);
  });

  it("should return false when task has no PR artifacts and status is DONE", async () => {
    vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
      createMockTask({ status: TaskStatus.DONE }) as any,
    );

    const result = await hasActiveJanitorTask("ws-1", JanitorType.UNIT_TESTS);

    expect(result).toBe(false);
  });

  it("should return true when task has PR with status IN_PROGRESS", async () => {
    vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
      createMockTask({
        prArtifacts: [{ content: { status: "IN_PROGRESS" } }],
      }) as any,
    );

    const result = await hasActiveJanitorTask("ws-1", JanitorType.UNIT_TESTS);

    expect(result).toBe(true);
  });

  it("should return false when task has PR with status DONE (merged)", async () => {
    vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
      createMockTask({
        prArtifacts: [{ content: { status: "DONE" } }],
      }) as any,
    );

    const result = await hasActiveJanitorTask("ws-1", JanitorType.UNIT_TESTS);

    expect(result).toBe(false);
  });

  it("should return false when task has PR with status CANCELLED (closed)", async () => {
    vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
      createMockTask({
        prArtifacts: [{ content: { status: "CANCELLED" } }],
      }) as any,
    );

    const result = await hasActiveJanitorTask("ws-1", JanitorType.UNIT_TESTS);

    expect(result).toBe(false);
  });

  it("should return false when task status is CANCELLED (discarded)", async () => {
    vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
      createMockTask({ status: TaskStatus.CANCELLED }) as any,
    );

    const result = await hasActiveJanitorTask("ws-1", JanitorType.UNIT_TESTS);

    expect(result).toBe(false);
  });

  it("should return false when task workflowStatus is FAILED (discarded)", async () => {
    vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
      createMockTask({ workflowStatus: WorkflowStatus.FAILED }) as any,
    );

    const result = await hasActiveJanitorTask("ws-1", JanitorType.UNIT_TESTS);

    expect(result).toBe(false);
  });

  it("should query for the most recent task of the specified janitor type", async () => {
    vi.mocked(mockedDb.task.findFirst).mockResolvedValue(null);

    await hasActiveJanitorTask("ws-1", JanitorType.INTEGRATION_TESTS);

    expect(mockedDb.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws-1",
          janitorType: JanitorType.INTEGRATION_TESTS,
          deleted: false,
        }),
        orderBy: { createdAt: "desc" },
      })
    );
  });
});