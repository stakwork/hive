/**
 * Unit tests: pod release in updateTicket when status is set to DONE
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted) ────────────────────────────────────────────────────────
const {
  mockDbTask,
  mockDbRepository,
  mockDbFeature,
  mockDbPhase,
  mockDbUser,
  mockDbWorkflowTask,
  mockReleaseTaskPod,
} = vi.hoisted(() => ({
  mockDbTask: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
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
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  mockReleaseTaskPod: vi.fn(),
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
  parsePRUrl: vi.fn(),
  getOctokitForWorkspace: vi.fn(),
  checkRepoAllowsAutoMerge: vi.fn(),
}));

vi.mock("@/lib/pods/utils", () => ({
  releaseTaskPod: mockReleaseTaskPod,
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

// ── Imports (after mocks) ──────────────────────────────────────────────────
import { updateTicket } from "@/services/roadmap/tickets";
import { validateRoadmapTaskAccess } from "@/services/roadmap/utils";

// ── Shared test fixtures ───────────────────────────────────────────────────
const TASK_ID = "task-1";
const USER_ID = "user-1";
const WORKSPACE_ID = "ws-1";
const POD_ID = "pod-abc";

const BASE_TASK_ACCESS = {
  id: TASK_ID,
  featureId: "feature-1",
  feature: {
    id: "feature-1",
    workspace: { id: WORKSPACE_ID, slug: "test-ws" },
  },
  deleted: false,
};

const BASE_UPDATED_TASK = {
  id: TASK_ID,
  title: "Task",
  description: null,
  status: "DONE",
  priority: "MEDIUM",
  order: 1,
  featureId: "feature-1",
  phaseId: null,
  workspaceId: WORKSPACE_ID,
  bountyCode: "BC-0001",
  dependsOnTaskIds: [],
  runBuild: true,
  runTestSuite: true,
  autoMerge: false,
  deploymentStatus: null,
  deployedToStagingAt: null,
  deployedToProductionAt: null,
  workflowStatus: "COMPLETED",
  createdAt: new Date(),
  updatedAt: new Date(),
  systemAssigneeType: null,
  assignee: null,
  repository: null,
  phase: null,
  workspace: { slug: "test-ws" },
};

// ── Tests ──────────────────────────────────────────────────────────────────
describe("updateTicket — pod release on status=DONE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateRoadmapTaskAccess).mockResolvedValue(BASE_TASK_ACCESS as any);
    mockDbTask.update.mockResolvedValue(BASE_UPDATED_TASK);
    mockReleaseTaskPod.mockResolvedValue({ success: true, podDropped: true, taskCleared: true });
  });

  it("releases pod when data.status===DONE and task has an active podId", async () => {
    // findUnique called to fetch podInfo before the update
    mockDbTask.findUnique.mockResolvedValue({
      podId: POD_ID,
      workspaceId: WORKSPACE_ID,
    });

    await updateTicket(TASK_ID, USER_ID, { status: "DONE" as any });

    expect(mockReleaseTaskPod).toHaveBeenCalledOnce();
    expect(mockReleaseTaskPod).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        podId: POD_ID,
        workspaceId: WORKSPACE_ID,
        verifyOwnership: true,
        clearTaskFields: true,
        newWorkflowStatus: null,
      })
    );
  });

  it("does NOT release pod when task podId is null (no active pod)", async () => {
    mockDbTask.findUnique.mockResolvedValue({ podId: null, workspaceId: WORKSPACE_ID });

    await updateTicket(TASK_ID, USER_ID, { status: "DONE" as any });

    expect(mockReleaseTaskPod).not.toHaveBeenCalled();
  });

  it("does NOT call findUnique or releaseTaskPod for non-DONE status values", async () => {
    // findUnique should never be called for non-DONE status
    await updateTicket(TASK_ID, USER_ID, { status: "IN_PROGRESS" as any });

    expect(mockDbTask.findUnique).not.toHaveBeenCalled();
    expect(mockReleaseTaskPod).not.toHaveBeenCalled();
  });

  it("does NOT call findUnique or releaseTaskPod when no status is provided at all", async () => {
    await updateTicket(TASK_ID, USER_ID, { title: "Updated title" });

    expect(mockDbTask.findUnique).not.toHaveBeenCalled();
    expect(mockReleaseTaskPod).not.toHaveBeenCalled();
  });

  it("still completes the status update even when releaseTaskPod throws", async () => {
    mockDbTask.findUnique.mockResolvedValue({ podId: POD_ID, workspaceId: WORKSPACE_ID });
    mockReleaseTaskPod.mockRejectedValue(new Error("pool manager unavailable"));

    // Should not throw — failure must be swallowed
    const result = await updateTicket(TASK_ID, USER_ID, { status: "DONE" as any });

    expect(result).toBeDefined();
    expect(result.status).toBe("DONE");
    expect(mockReleaseTaskPod).toHaveBeenCalledOnce();
  });

  it("passes newWorkflowStatus: null so the COMPLETED status is not overwritten", async () => {
    mockDbTask.findUnique.mockResolvedValue({ podId: POD_ID, workspaceId: WORKSPACE_ID });

    await updateTicket(TASK_ID, USER_ID, { status: "DONE" as any });

    const call = mockReleaseTaskPod.mock.calls[0][0];
    expect(call.newWorkflowStatus).toBeNull();
  });
});
