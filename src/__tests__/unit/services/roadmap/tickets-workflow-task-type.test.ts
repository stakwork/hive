import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const {
  mockDbTask,
  mockDbRepository,
  mockDbFeature,
  mockDbPhase,
  mockDbUser,
  mockDbWorkflowTask,
  mockSaveWorkflowArtifact,
} = vi.hoisted(() => ({
  mockDbTask: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  mockDbRepository: {
    findFirst: vi.fn(),
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
    create: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  mockSaveWorkflowArtifact: vi.fn(),
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
  saveWorkflowArtifact: mockSaveWorkflowArtifact,
}));

vi.mock("@/lib/bounty-code", () => ({
  ensureUniqueBountyCode: vi.fn().mockResolvedValue("BC-TEST"),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/github", () => ({
  parsePRUrl: vi.fn(),
  getOctokitForWorkspace: vi.fn(),
  checkRepoAllowsAutoMerge: vi.fn(),
}));

vi.mock("@/lib/pods/utils", () => ({
  releaseTaskPod: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/system-assignees", () => ({
  getSystemAssigneeUser: vi.fn().mockReturnValue(null),
}));

vi.mock("@/services/roadmap/utils", () => ({
  validateFeatureAccess: vi.fn(),
  validateRoadmapTaskAccess: vi.fn(),
  calculateNextOrder: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/lib/validators", () => ({
  validateEnum: vi.fn(),
}));

vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { createTicket, updateTicket } from "@/services/roadmap/tickets";
import { validateFeatureAccess, validateRoadmapTaskAccess } from "@/services/roadmap/utils";

const BASE_FEATURE = {
  id: "feature-1",
  workspaceId: "ws-1",
};

const BASE_CREATED_TASK = {
  id: "task-1",
  title: "Workflow Task",
  description: null,
  status: "TODO",
  priority: "MEDIUM",
  order: 1,
  featureId: "feature-1",
  phaseId: null,
  workspaceId: "ws-1",
  bountyCode: "BC-TEST",
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
};

describe("createTicket — workflowTaskType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateFeatureAccess).mockResolvedValue(BASE_FEATURE as any);
    mockDbPhase.findFirst.mockResolvedValue(null);
    mockDbUser.findUnique.mockResolvedValue({ id: "user-1", name: "Test User" });
    mockDbTask.create.mockResolvedValue(BASE_CREATED_TASK);
    mockDbWorkflowTask.create.mockResolvedValue({ id: "wt-1" });
    mockSaveWorkflowArtifact.mockResolvedValue(undefined);
  });

  it("persists SKILL workflowTaskType on WorkflowTask when workflowId is provided", async () => {
    await createTicket("feature-1", "user-1", {
      title: "Skill Task",
      workflowId: 10,
      workflowName: "my-skill",
      workflowRefId: "ref-1",
      workflowTaskType: "SKILL",
    });

    expect(mockDbWorkflowTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ workflowTaskType: "SKILL" }),
    });
  });

  it("persists WORKFLOW workflowTaskType on WorkflowTask when workflowId is provided", async () => {
    await createTicket("feature-1", "user-1", {
      title: "Sub-Workflow Task",
      workflowId: 20,
      workflowTaskType: "WORKFLOW",
    });

    expect(mockDbWorkflowTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ workflowTaskType: "WORKFLOW" }),
    });
  });

  it("persists SCRIPT workflowTaskType on isNewWorkflow task", async () => {
    await createTicket("feature-1", "user-1", {
      title: "Script Task",
      isNewWorkflow: true,
      workflowTaskType: "SCRIPT",
    });

    expect(mockDbWorkflowTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "task-1",
        workflowId: null,
        workflowTaskType: "SCRIPT",
      }),
    });
  });

  it("persists null workflowTaskType when not provided", async () => {
    await createTicket("feature-1", "user-1", {
      title: "Untyped Workflow Task",
      workflowId: 99,
      workflowName: "untyped",
    });

    expect(mockDbWorkflowTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ workflowTaskType: null }),
    });
  });

  it("persists PROMPT workflowTaskType on new-workflow task", async () => {
    await createTicket("feature-1", "user-1", {
      title: "Prompt Task",
      isNewWorkflow: true,
      workflowTaskType: "PROMPT",
    });

    expect(mockDbWorkflowTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ workflowTaskType: "PROMPT" }),
    });
  });

  it("persists workflowVersionId on WorkflowTask when workflowId is provided", async () => {
    await createTicket("feature-1", "user-1", {
      title: "Versioned Task",
      workflowId: 10,
      workflowName: "my-workflow",
      workflowRefId: "ref-1",
      workflowTaskType: "PROMPT",
      workflowVersionId: "version-abc-123",
    });

    expect(mockDbWorkflowTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowTaskType: "PROMPT",
        workflowVersionId: "version-abc-123",
      }),
    });
  });

  it("persists workflowVersionId on isNewWorkflow task", async () => {
    await createTicket("feature-1", "user-1", {
      title: "New Workflow Versioned",
      isNewWorkflow: true,
      workflowTaskType: "SCRIPT",
      workflowVersionId: "version-xyz-456",
    });

    expect(mockDbWorkflowTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "task-1",
        workflowId: null,
        workflowTaskType: "SCRIPT",
        workflowVersionId: "version-xyz-456",
      }),
    });
  });

  it("persists null workflowVersionId when not provided (workflowId branch)", async () => {
    await createTicket("feature-1", "user-1", {
      title: "No Version Task",
      workflowId: 99,
      workflowName: "untyped",
      workflowTaskType: "WORKFLOW",
    });

    expect(mockDbWorkflowTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ workflowVersionId: null }),
    });
  });

  it("persists null workflowVersionId when not provided (isNewWorkflow branch)", async () => {
    await createTicket("feature-1", "user-1", {
      title: "No Version New Workflow",
      isNewWorkflow: true,
      workflowTaskType: "PROMPT",
    });

    expect(mockDbWorkflowTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ workflowVersionId: null }),
    });
  });
});

describe("updateTicket — workflowTaskType", () => {
  const BASE_TASK_ACCESS = {
    id: "task-1",
    featureId: "feature-1",
    feature: {
      id: "feature-1",
      workspace: { id: "ws-1", slug: "test-ws" },
    },
    deleted: false,
  };

  const BASE_UPDATED_TASK = {
    ...BASE_CREATED_TASK,
    workspace: { slug: "test-ws" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateRoadmapTaskAccess).mockResolvedValue(BASE_TASK_ACCESS as any);
    mockDbTask.update.mockResolvedValue(BASE_UPDATED_TASK);
    mockDbWorkflowTask.upsert.mockResolvedValue({ id: "wt-1" });
    mockDbWorkflowTask.updateMany.mockResolvedValue({ count: 1 });
  });

  it("includes workflowTaskType in upsert when workflowId is provided", async () => {
    await updateTicket("task-1", "user-1", {
      workflowId: 55,
      workflowName: "updated-wf",
      workflowTaskType: "SKILL",
    });

    expect(mockDbWorkflowTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ workflowTaskType: "SKILL" }),
        update: expect.objectContaining({ workflowTaskType: "SKILL" }),
      })
    );
  });

  it("calls updateMany for standalone workflowTaskType-only update", async () => {
    await updateTicket("task-1", "user-1", {
      workflowTaskType: "PROMPT",
    });

    expect(mockDbWorkflowTask.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1" },
      data: { workflowTaskType: "PROMPT" },
    });
    expect(mockDbWorkflowTask.upsert).not.toHaveBeenCalled();
  });

  it("does not call workflowTask.updateMany when workflowId is also changed", async () => {
    await updateTicket("task-1", "user-1", {
      workflowId: 77,
      workflowTaskType: "SCRIPT",
    });

    expect(mockDbWorkflowTask.upsert).toHaveBeenCalled();
    // updateMany should NOT be called when a full upsert already handles it
    expect(mockDbWorkflowTask.updateMany).not.toHaveBeenCalled();
  });

  it("includes workflowTaskType in upsert for isNewWorkflow update", async () => {
    await updateTicket("task-1", "user-1", {
      isNewWorkflow: true,
      workflowTaskType: "WORKFLOW",
    });

    expect(mockDbWorkflowTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ workflowTaskType: "WORKFLOW" }),
        update: expect.objectContaining({ workflowTaskType: "WORKFLOW" }),
      })
    );
  });
});
