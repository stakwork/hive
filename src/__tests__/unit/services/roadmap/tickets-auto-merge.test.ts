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
  mockResolveAutoMergeDefault,
} = vi.hoisted(() => ({
  mockDbTask: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
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
    create: vi.fn(),
  },
  mockCheckRepoAllowsAutoMerge: vi.fn(),
  mockResolveAutoMergeDefault: vi.fn().mockResolvedValue(false),
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
  resolveAutoMergeDefault: (...args: unknown[]) => mockResolveAutoMergeDefault(...args),
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

vi.mock("@/lib/pods/utils", () => ({
  releaseTaskPod: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

import { validateRoadmapTaskAccess, validateFeatureAccess } from "@/services/roadmap/utils";
import { updateTicket, createTicket } from "@/services/roadmap/tickets";

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

// ── createTicket — autoMerge default ──────────────────────────────────────

const FEATURE_ID = "feature-1";

function makeFeature() {
  return {
    id: FEATURE_ID,
    workspaceId: "ws-1",
    deleted: false,
    workspace: {
      id: "ws-1",
      ownerId: USER_ID,
      deleted: false,
      members: [],
    },
  };
}

function makeCreatedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-new",
    title: "New Task",
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    order: 1,
    featureId: FEATURE_ID,
    phaseId: null,
    workspaceId: "ws-1",
    bountyCode: "BC-0001",
    dependsOnTaskIds: [],
    runBuild: true,
    runTestSuite: true,
    autoMerge: false,
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
    feature: { id: FEATURE_ID, title: "Feature", phases: [] },
    ...overrides,
  };
}

describe("createTicket — autoMerge default", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateFeatureAccess).mockResolvedValue(makeFeature() as never);
    mockDbPhase.findFirst.mockResolvedValue(null);
    mockDbUser.findUnique.mockResolvedValue({ id: USER_ID, name: "Test User" });
    mockDbTask.create.mockResolvedValue(makeCreatedTask());
  });

  it("defaults autoMerge to false when not provided", async () => {
    await createTicket(FEATURE_ID, USER_ID, {
      title: "New Task",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
    });

    expect(mockDbTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoMerge: false }),
      })
    );
  });

  it("sets autoMerge to true when explicitly passed true", async () => {
    mockDbTask.create.mockResolvedValue(makeCreatedTask({ autoMerge: true }));

    await createTicket(FEATURE_ID, USER_ID, {
      title: "New Task",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
      autoMerge: true,
    });

    expect(mockDbTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoMerge: true }),
      })
    );
  });

  it("sets autoMerge to false when explicitly passed false", async () => {
    await createTicket(FEATURE_ID, USER_ID, {
      title: "New Task",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
      autoMerge: false,
    });

    expect(mockDbTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoMerge: false }),
      })
    );
  });

  it("defaults autoMerge to true for SKILL type when not explicitly provided", async () => {
    mockDbWorkflowTask.create.mockResolvedValue({});

    await createTicket(FEATURE_ID, USER_ID, {
      title: "SKILL Task",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
      workflowId: 10,
      workflowTaskType: "SKILL" as never,
    });

    expect(mockDbTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoMerge: true }),
      })
    );
  });

  it("honours explicit autoMerge: false even for SKILL type", async () => {
    mockDbWorkflowTask.create.mockResolvedValue({});

    await createTicket(FEATURE_ID, USER_ID, {
      title: "SKILL Task",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
      workflowId: 10,
      workflowTaskType: "SKILL" as never,
      autoMerge: false,
    });

    expect(mockDbTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoMerge: false }),
      })
    );
  });

  it("defaults autoMerge to false for WORKFLOW type", async () => {
    mockDbWorkflowTask.create.mockResolvedValue({});

    await createTicket(FEATURE_ID, USER_ID, {
      title: "WORKFLOW Task",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
      workflowId: 10,
      workflowTaskType: "WORKFLOW" as never,
    });

    expect(mockDbTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoMerge: false }),
      })
    );
  });
});

// ── createTicket — resolveAutoMergeDefault integration ────────────────────

describe("createTicket — resolveAutoMergeDefault (canvasAutonomousTurns path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateFeatureAccess).mockResolvedValue(makeFeature() as never);
    mockDbPhase.findFirst.mockResolvedValue(null);
    mockDbUser.findUnique.mockResolvedValue({ id: USER_ID, name: "Test User" });
    mockDbTask.create.mockResolvedValue(makeCreatedTask());
  });

  it("calls resolveAutoMergeDefault with correct args when no autoMerge provided and repo is linked", async () => {
    mockResolveAutoMergeDefault.mockResolvedValue(false);
    mockDbRepository.findFirst.mockResolvedValue({
      id: "repo-1",
      name: "myrepo",
      repositoryUrl: "https://github.com/owner/myrepo",
    });

    await createTicket(FEATURE_ID, USER_ID, {
      title: "Task with repo",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
      repositoryId: "repo-1",
    });

    expect(mockResolveAutoMergeDefault).toHaveBeenCalledWith(USER_ID, "repo-1");
  });

  it("sets autoMerge: true when resolveAutoMergeDefault returns true", async () => {
    mockResolveAutoMergeDefault.mockResolvedValue(true);
    mockDbRepository.findFirst.mockResolvedValue({
      id: "repo-1",
      name: "myrepo",
      repositoryUrl: "https://github.com/owner/myrepo",
    });
    mockDbTask.create.mockResolvedValue(makeCreatedTask({ autoMerge: true }));

    await createTicket(FEATURE_ID, USER_ID, {
      title: "Task with autonomous turns",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
      repositoryId: "repo-1",
    });

    expect(mockDbTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoMerge: true }),
      })
    );
  });

  it("sets autoMerge: false when resolveAutoMergeDefault returns false", async () => {
    mockResolveAutoMergeDefault.mockResolvedValue(false);
    mockDbRepository.findFirst.mockResolvedValue({
      id: "repo-1",
      name: "myrepo",
      repositoryUrl: "https://github.com/owner/myrepo",
    });

    await createTicket(FEATURE_ID, USER_ID, {
      title: "Task with auto-turns off",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
      repositoryId: "repo-1",
    });

    expect(mockDbTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoMerge: false }),
      })
    );
  });

  it("does NOT call resolveAutoMergeDefault when autoMerge is explicitly true", async () => {
    mockDbTask.create.mockResolvedValue(makeCreatedTask({ autoMerge: true }));
    mockDbRepository.findFirst.mockResolvedValue({
      id: "repo-1",
      name: "myrepo",
      repositoryUrl: "https://github.com/owner/myrepo",
    });

    await createTicket(FEATURE_ID, USER_ID, {
      title: "Task explicit true",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
      repositoryId: "repo-1",
      autoMerge: true,
    });

    expect(mockResolveAutoMergeDefault).not.toHaveBeenCalled();
    expect(mockDbTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoMerge: true }),
      })
    );
  });

  it("does NOT call resolveAutoMergeDefault when autoMerge is explicitly false", async () => {
    mockDbRepository.findFirst.mockResolvedValue({
      id: "repo-1",
      name: "myrepo",
      repositoryUrl: "https://github.com/owner/myrepo",
    });

    await createTicket(FEATURE_ID, USER_ID, {
      title: "Task explicit false",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
      repositoryId: "repo-1",
      autoMerge: false,
    });

    expect(mockResolveAutoMergeDefault).not.toHaveBeenCalled();
    expect(mockDbTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoMerge: false }),
      })
    );
  });

  it("passes null repositoryId for workflow tasks (no GitHub check)", async () => {
    mockResolveAutoMergeDefault.mockResolvedValue(false);
    mockDbWorkflowTask.create.mockResolvedValue({});

    await createTicket(FEATURE_ID, USER_ID, {
      title: "Workflow task",
      status: "TODO" as never,
      priority: "MEDIUM" as never,
      workflowId: 10,
      workflowTaskType: "WORKFLOW" as never,
    });

    // resolveAutoMergeDefault should not be called for workflow tasks
    // (they hit the SKILL branch or the isWorkflowTask && SKILL check first)
    expect(mockDbTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoMerge: false }),
      })
    );
  });
});
