import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { shouldSkipJanitorRun, executeScheduledJanitorRuns } from "@/services/janitor-cron";
import * as janitorService from "@/services/janitor";
import { db } from "@/lib/db";
import { JanitorType, TaskStatus, WorkflowStatus } from "@prisma/client";

vi.mock("@/services/janitor", () => ({
  createJanitorRun: vi.fn(),
}));

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

  describe("GraphMindset type (DEDUPLICATION)", () => {
    beforeEach(() => {
      vi.mocked(mockedDb.janitorRun.findFirst).mockResolvedValue(null);
    });

    it("should return false (no skip) when no in-progress DEDUPLICATION run exists", async () => {
      const result = await shouldSkipJanitorRun("ws-1", JanitorType.DEDUPLICATION);
      expect(result).toBe(false);
    });

    it("should return true when an in-progress DEDUPLICATION run exists", async () => {
      vi.mocked(mockedDb.janitorRun.findFirst).mockResolvedValue({
        id: "run-ded-1",
        status: "RUNNING",
        janitorType: JanitorType.DEDUPLICATION,
      } as any);

      const result = await shouldSkipJanitorRun("ws-1", JanitorType.DEDUPLICATION);
      expect(result).toBe(true);
    });

    it("should NOT check recommendations or tasks for DEDUPLICATION", async () => {
      const result = await shouldSkipJanitorRun("ws-1", JanitorType.DEDUPLICATION);
      expect(result).toBe(false);
      expect(mockedDb.janitorRecommendation.findFirst).not.toHaveBeenCalled();
      expect(mockedDb.task.findFirst).not.toHaveBeenCalled();
    });

    it("should check in-progress run without repositoryId filter for DEDUPLICATION", async () => {
      vi.mocked(mockedDb.janitorRun.findFirst).mockResolvedValue(null);

      await shouldSkipJanitorRun("ws-1", JanitorType.DEDUPLICATION);

      expect(mockedDb.janitorRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            janitorConfig: { workspaceId: "ws-1" },
            janitorType: JanitorType.DEDUPLICATION,
            status: { in: ["PENDING", "RUNNING"] },
          }),
        }),
      );
      // repositoryId should NOT be in the where clause for GraphMindset types
      const callArg = vi.mocked(mockedDb.janitorRun.findFirst).mock.calls[0][0] as any;
      expect(callArg.where).not.toHaveProperty("repositoryId");
    });
  });
});

describe("executeScheduledJanitorRuns — DEDUPLICATION", () => {
  const mockCreateJanitorRun = vi.mocked(janitorService.createJanitorRun);

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(db, {
      workspace: { findMany: vi.fn() },
      janitorRun: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn(), update: vi.fn() },
      janitorRecommendation: { findFirst: vi.fn().mockResolvedValue(null) },
      task: { findFirst: vi.fn().mockResolvedValue(null) },
    });
  });

  const makeWorkspace = (overrides: Record<string, unknown> = {}) => ({
    id: "ws-1",
    slug: "test-ws",
    name: "Test Workspace",
    ownerId: "owner-1",
    janitorConfig: {
      id: "jc-1",
      unitTestsEnabled: false,
      integrationTestsEnabled: false,
      e2eTestsEnabled: false,
      securityReviewEnabled: false,
      mockGenerationEnabled: false,
      generalRefactoringEnabled: false,
      deduplicationEnabled: true,
    },
    swarm: { swarmUrl: "https://ai.sphinx.chat/api", swarmSecretAlias: "alias-123" },
    repositories: [
      { id: "repo-1", repositoryUrl: "https://github.com/org/repo", branch: "main", ignoreDirs: null },
      { id: "repo-2", repositoryUrl: "https://github.com/org/repo2", branch: "main", ignoreDirs: null },
    ],
    ...overrides,
  });

  it("should dispatch DEDUPLICATION only once per workspace (not per repo)", async () => {
    vi.mocked(mockedDb.workspace.findMany).mockResolvedValue([makeWorkspace()] as any);
    mockCreateJanitorRun.mockResolvedValue({ id: "run-1" });

    await executeScheduledJanitorRuns();

    // Should have called createJanitorRun exactly once (not once per repo)
    expect(mockCreateJanitorRun).toHaveBeenCalledTimes(1);
    expect(mockCreateJanitorRun).toHaveBeenCalledWith(
      "test-ws",
      "owner-1",
      "deduplication",
      "SCHEDULED",
    );
  });

  it("should skip DEDUPLICATION when workspace has no swarm URL", async () => {
    vi.mocked(mockedDb.workspace.findMany).mockResolvedValue([
      makeWorkspace({ swarm: { swarmUrl: null, swarmSecretAlias: "alias" } }),
    ] as any);

    const result = await executeScheduledJanitorRuns();

    expect(mockCreateJanitorRun).not.toHaveBeenCalled();
    expect(result.skipped).toBeGreaterThan(0);
  });

  it("should skip DEDUPLICATION when workspace has no swarm at all", async () => {
    vi.mocked(mockedDb.workspace.findMany).mockResolvedValue([
      makeWorkspace({ swarm: null }),
    ] as any);

    const result = await executeScheduledJanitorRuns();

    expect(mockCreateJanitorRun).not.toHaveBeenCalled();
    expect(result.skipped).toBeGreaterThan(0);
  });
});
