import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { shouldSkipJanitorRun } from "@/services/janitor-cron";
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

      const janitorCron = vercelConfig.crons.find(
        (cron: { path: string; schedule: string }) => cron.path === "/api/cron/janitors",
      );
      expect(janitorCron).toBeDefined();
      expect(janitorCron.schedule).toBeDefined();
      expect(typeof janitorCron.schedule).toBe("string");
    });

    it("should have a valid cron schedule format", () => {
      const vercelPath = path.join(process.cwd(), "vercel.json");
      const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
      const janitorCron = vercelConfig.crons.find(
        (cron: { path: string; schedule: string }) => cron.path === "/api/cron/janitors",
      );

      // Basic validation that it has 5 parts (minute hour day month dayofweek)
      const scheduleParts = janitorCron.schedule.split(" ");
      expect(scheduleParts).toHaveLength(5);
    });
  });
});

describe("shouldSkipJanitorRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(db, {
      task: {
        findFirst: vi.fn(),
      },
      janitorRecommendation: {
        findFirst: vi.fn(),
      },
      janitorRun: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
  });

  const createMockTask = (
    overrides: {
      status?: TaskStatus;
      workflowStatus?: WorkflowStatus;
      prArtifacts?: Array<{ content: { status?: string } }>;
    } = {},
  ) => {
    const {
      status = TaskStatus.IN_PROGRESS,
      workflowStatus = WorkflowStatus.IN_PROGRESS,
      prArtifacts = [],
    } = overrides;

    return {
      id: "task-1",
      workspaceId: "ws-1",
      janitorType: JanitorType.UNIT_TESTS,
      status,
      workflowStatus,
      deleted: false,
      chatMessages:
        prArtifacts.length > 0
          ? [
              {
                artifacts: prArtifacts,
              },
            ]
          : [],
    };
  };

  describe("in-progress run check", () => {
    it("should return true when a RUNNING janitor run exists", async () => {
      vi.mocked(mockedDb.janitorRun.findFirst).mockResolvedValue({
        id: "run-1",
        status: "RUNNING",
        janitorType: JanitorType.UNIT_TESTS,
      } as any);

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(true);
      expect(mockedDb.janitorRecommendation.findFirst).not.toHaveBeenCalled();
      expect(mockedDb.task.findFirst).not.toHaveBeenCalled();
    });

    it("should return true when a PENDING janitor run exists", async () => {
      vi.mocked(mockedDb.janitorRun.findFirst).mockResolvedValue({
        id: "run-1",
        status: "PENDING",
        janitorType: JanitorType.UNIT_TESTS,
      } as any);

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(true);
    });

    it("should check for in-progress run with correct janitor type and repository", async () => {
      vi.mocked(mockedDb.janitorRun.findFirst).mockResolvedValue(null);
      vi.mocked(mockedDb.janitorRecommendation.findFirst).mockResolvedValue(null);
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(null);

      await shouldSkipJanitorRun("ws-1", JanitorType.SECURITY_REVIEW, "repo-1");

      expect(mockedDb.janitorRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            janitorConfig: { workspaceId: "ws-1" },
            janitorType: JanitorType.SECURITY_REVIEW,
            repositoryId: "repo-1",
            status: { in: ["PENDING", "RUNNING"] },
          }),
        }),
      );
    });

    it("should proceed to recommendation check when no in-progress run exists", async () => {
      vi.mocked(mockedDb.janitorRun.findFirst).mockResolvedValue(null);
      vi.mocked(mockedDb.janitorRecommendation.findFirst).mockResolvedValue(null);
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(null);

      await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(mockedDb.janitorRecommendation.findFirst).toHaveBeenCalled();
    });

    it("should not block repo-B when repo-A has an active run", async () => {
      // Mock repo-A has an active run
      vi.mocked(mockedDb.janitorRun.findFirst).mockResolvedValueOnce({
        id: "run-1",
        status: "RUNNING",
        janitorType: JanitorType.UNIT_TESTS,
        repositoryId: "repo-A",
      } as any);

      // Check if repo-A should skip (yes)
      const resultA = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-A");
      expect(resultA).toBe(true);

      // Mock repo-B has no active run
      vi.mocked(mockedDb.janitorRun.findFirst).mockResolvedValueOnce(null);
      vi.mocked(mockedDb.janitorRecommendation.findFirst).mockResolvedValueOnce(null);
      vi.mocked(mockedDb.task.findFirst).mockResolvedValueOnce(null);

      // Check if repo-B should skip (no - different repo)
      const resultB = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-B");
      expect(resultB).toBe(false);
    });
  });

  describe("pending recommendations check", () => {
    beforeEach(() => {
      vi.mocked(mockedDb.janitorRun.findFirst).mockResolvedValue(null);
    });

    it("should return true when pending recommendation exists", async () => {
      vi.mocked(mockedDb.janitorRecommendation.findFirst).mockResolvedValue({
        id: "rec-1",
        status: "PENDING",
      } as any);

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(true);
      expect(mockedDb.task.findFirst).not.toHaveBeenCalled();
    });

    it("should check for pending recommendation with correct janitor type", async () => {
      vi.mocked(mockedDb.janitorRecommendation.findFirst).mockResolvedValue(null);
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(null);

      await shouldSkipJanitorRun("ws-1", JanitorType.E2E_TESTS, "repo-1");

      expect(mockedDb.janitorRecommendation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: "ws-1",
            status: "PENDING",
            janitorRun: {
              janitorType: JanitorType.E2E_TESTS,
            },
          }),
        }),
      );
    });

    it("should proceed to task check when no pending recommendation exists", async () => {
      vi.mocked(mockedDb.janitorRecommendation.findFirst).mockResolvedValue(null);
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(null);

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(false);
      expect(mockedDb.task.findFirst).toHaveBeenCalled();
    });
  });

  describe("active task check", () => {
    beforeEach(() => {
      vi.mocked(mockedDb.janitorRun.findFirst).mockResolvedValue(null);
      vi.mocked(mockedDb.janitorRecommendation.findFirst).mockResolvedValue(null);
    });

    it("should return false when no janitor tasks exist", async () => {
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(null);

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(false);
    });

    it("should return true when task has no PR artifacts and status is not DONE", async () => {
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(createMockTask({ status: TaskStatus.IN_PROGRESS }) as any);

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(true);
    });

    it("should return false when task has no PR artifacts and status is DONE", async () => {
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(createMockTask({ status: TaskStatus.DONE }) as any);

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(false);
    });

    it("should return true when task has PR with status IN_PROGRESS", async () => {
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
        createMockTask({
          prArtifacts: [{ content: { status: "IN_PROGRESS" } }],
        }) as any,
      );

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(true);
    });

    it("should return false when task has PR with status DONE (merged)", async () => {
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
        createMockTask({
          prArtifacts: [{ content: { status: "DONE" } }],
        }) as any,
      );

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(false);
    });

    it("should return false when task has PR with status CANCELLED (closed)", async () => {
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
        createMockTask({
          prArtifacts: [{ content: { status: "CANCELLED" } }],
        }) as any,
      );

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(false);
    });

    it("should return false when task status is CANCELLED (discarded)", async () => {
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(createMockTask({ status: TaskStatus.CANCELLED }) as any);

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(false);
    });

    it("should return false when task workflowStatus is FAILED (discarded)", async () => {
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
        createMockTask({ workflowStatus: WorkflowStatus.FAILED }) as any,
      );

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(false);
    });

    it("should return false when task workflowStatus is HALTED (discarded)", async () => {
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(
        createMockTask({ workflowStatus: WorkflowStatus.HALTED }) as any,
      );

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.UNIT_TESTS, "repo-1");

      expect(result).toBe(false);
    });

    it("should query for the most recent task of the specified janitor type and repository", async () => {
      vi.mocked(mockedDb.task.findFirst).mockResolvedValue(null);

      await shouldSkipJanitorRun("ws-1", JanitorType.INTEGRATION_TESTS, "repo-1");

      expect(mockedDb.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: "ws-1",
            janitorType: JanitorType.INTEGRATION_TESTS,
            repositoryId: "repo-1",
            deleted: false,
          }),
          orderBy: { createdAt: "desc" },
        }),
      );
    });
  });
});
