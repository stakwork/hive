import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutoMergeNotAllowedError, AutoMergeCheckFailedError } from "@/lib/github/errors";

// ── Mocks ──────────────────────────────────────────────────────────────────
// Use vi.hoisted() so these objects exist when vi.mock() factories are hoisted.

const {
  mockDbTask,
  mockDbRepository,
  mockDbFeature,
  mockDbPhase,
  mockDbUser,
  mockDbWorkflowTask,
  mockCheckRepoAllowsAutoMerge,
} = vi.hoisted(() => ({
  mockDbTask: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  mockDbRepository: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  mockDbFeature: {
    findFirst: vi.fn(),
  },
  mockDbPhase: {
    findFirst: vi.fn(),
  },
  mockDbUser: {
    findUnique: vi.fn(),
  },
  mockDbWorkflowTask: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  mockCheckRepoAllowsAutoMerge: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: mockDbTask,
    repository: mockDbRepository,
    feature: mockDbFeature,
    phase: mockDbPhase,
    user: mockDbUser,
    workflowTask: mockDbWorkflowTask,
  },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  PUSHER_EVENTS: { FEATURE_UPDATED: "feature-updated" },
}));

vi.mock("@/services/notifications", () => ({
  createAndSendNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/workflow-editor", () => ({
  saveWorkflowArtifact: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/bounty-code", () => ({
  ensureUniqueBountyCode: vi.fn().mockResolvedValue("BC-0001"),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/github", () => ({
  parsePRUrl: (url: string) => {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) return null;
    return { owner: m[1], repo: m[2], prNumber: Number(m[3]) };
  },
  getOctokitForWorkspace: vi.fn().mockResolvedValue({ rest: {} }),
  checkRepoAllowsAutoMerge: (...args: unknown[]) => mockCheckRepoAllowsAutoMerge(...args),
}));

vi.mock("@/lib/system-assignees", () => ({
  getSystemAssigneeUser: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/validators", () => ({
  validateEnum: vi.fn(),
}));

vi.mock("@/services/roadmap/utils", () => ({
  validateFeatureAccess: vi.fn(),
  validateRoadmapTaskAccess: vi.fn(),
  calculateNextOrder: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

import { validateRoadmapTaskAccess } from "@/services/roadmap/utils";
import { updateTicket } from "@/services/roadmap/tickets";

const TASK_ID = "task-abc";
const USER_ID = "user-xyz";

/** Minimal task stub returned by validateRoadmapTaskAccess */
function makeAccessTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    featureId: "feature-1",
    feature: {
      id: "feature-1",
      workspace: {
        id: "ws-1",
        ownerId: USER_ID,
        deleted: false,
        members: [],
      },
    },
    ...overrides,
  };
}

/** Minimal task returned by db.task.findUnique (with repository include) */
function makeTaskWithRepo(repoOverrides: Record<string, unknown> | null = {}) {
  return {
    id: TASK_ID,
    repository:
      repoOverrides === null
        ? null
        : {
            id: "repo-1",
            repositoryUrl: "https://github.com/owner/myrepo",
            allowAutoMerge: false,
            ...repoOverrides,
          },
  };
}

/** Minimal updated task returned by db.task.update */
function makeUpdatedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    title: "Test Task",
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    order: 1,
    featureId: "feature-1",
    phaseId: null,
    workspaceId: "ws-1",
    bountyCode: "BC-0001",
    dependsOnTaskIds: [],
    runBuild: true,
    runTestSuite: true,
    autoMerge: true,
    deploymentStatus: null,
    deployedToStagingAt: null,
    deployedToProductionAt: null,
    workflowStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    systemAssigneeType: null,
    assignee: null,
    repository: null,
    phase: null,
    workspace: { slug: "test-ws" },
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("updateTicket — auto-merge gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateRoadmapTaskAccess).mockResolvedValue(makeAccessTask() as never);
    mockDbTask.update.mockResolvedValue(makeUpdatedTask());
  });

  it("skips GitHub check when repository.allowAutoMerge is already true (cache hit)", async () => {
    mockDbTask.findUnique.mockResolvedValue(
      makeTaskWithRepo({ allowAutoMerge: true })
    );

    await updateTicket(TASK_ID, USER_ID, { autoMerge: true });

    expect(mockCheckRepoAllowsAutoMerge).not.toHaveBeenCalled();
    expect(mockDbTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ autoMerge: true }) })
    );
  });

  it("skips GitHub check when task has no repositoryId (workflow task)", async () => {
    mockDbTask.findUnique.mockResolvedValue(makeTaskWithRepo(null));

    await updateTicket(TASK_ID, USER_ID, { autoMerge: true });

    expect(mockCheckRepoAllowsAutoMerge).not.toHaveBeenCalled();
    expect(mockDbTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ autoMerge: true }) })
    );
  });

  it("calls GitHub, caches result, and proceeds when GitHub returns allowed: true", async () => {
    mockDbTask.findUnique.mockResolvedValue(makeTaskWithRepo());
    mockCheckRepoAllowsAutoMerge.mockResolvedValue({ allowed: true });

    await updateTicket(TASK_ID, USER_ID, { autoMerge: true });

    expect(mockCheckRepoAllowsAutoMerge).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "myrepo"
    );
    expect(mockDbRepository.update).toHaveBeenCalledWith({
      where: { id: "repo-1" },
      data: { allowAutoMerge: true },
    });
    expect(mockDbTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ autoMerge: true }) })
    );
  });

  it("throws AutoMergeNotAllowedError with correct URL when GitHub returns allowed: false", async () => {
    mockDbTask.findUnique.mockResolvedValue(makeTaskWithRepo());
    mockCheckRepoAllowsAutoMerge.mockResolvedValue({ allowed: false });

    await expect(
      updateTicket(TASK_ID, USER_ID, { autoMerge: true })
    ).rejects.toThrow(AutoMergeNotAllowedError);

    await expect(
      updateTicket(TASK_ID, USER_ID, { autoMerge: true })
    ).rejects.toMatchObject({
      githubSettingsUrl: "https://github.com/owner/myrepo/settings",
    });

    expect(mockDbRepository.update).not.toHaveBeenCalled();
    expect(mockDbTask.update).not.toHaveBeenCalled();
  });

  it("throws AutoMergeCheckFailedError when GitHub check returns an error", async () => {
    mockDbTask.findUnique.mockResolvedValue(makeTaskWithRepo());
    mockCheckRepoAllowsAutoMerge.mockResolvedValue({
      allowed: false,
      error: "permission_denied",
    });

    await expect(
      updateTicket(TASK_ID, USER_ID, { autoMerge: true })
    ).rejects.toThrow(AutoMergeCheckFailedError);
  });

  it("does not run GitHub check when toggling auto-merge OFF", async () => {
    // No findUnique call needed — gate only runs for true
    await updateTicket(TASK_ID, USER_ID, { autoMerge: false });

    expect(mockDbTask.findUnique).not.toHaveBeenCalled();
    expect(mockCheckRepoAllowsAutoMerge).not.toHaveBeenCalled();
    expect(mockDbTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ autoMerge: false }) })
    );
  });
});
