/**
 * Integration test: Pod release on HALTED workflowStatus via PATCH /api/tasks/[taskId]
 *
 * Verifies that:
 * 1. Non-agent tasks with a pod have releaseTaskPod called when workflowStatus → HALTED.
 * 2. Agent tasks with a pod do NOT have releaseTaskPod called (pod kept for retry).
 * 3. Non-member requests are rejected with 403 before any pod release logic runs.
 * 4. At least one test lets releaseTaskPod run against the real test DB and asserts
 *    post-call that task.podId is null and pod usageStatus is UNUSED.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
  createTestSwarm,
  createTestPod,
} from "@/__tests__/support/fixtures";
import { releaseTaskPod } from "@/lib/pods/utils";
import {
  createAuthenticatedPatchRequest,
  createPatchRequest,
  addMiddlewareHeaders,
} from "@/__tests__/support/helpers/request-builders";
import type { User, Workspace } from "@prisma/client";

// Mock releaseTaskPod at module level — we spy on it and restore real
// implementation for the DB-level assertion test below.
vi.mock("@/lib/pods/utils", async () => {
  const actual = await vi.importActual("@/lib/pods/utils");
  return {
    ...actual,
    releaseTaskPod: vi.fn().mockResolvedValue({ success: true, podDropped: true, taskCleared: true }),
  };
});

// Mock external services that would make real HTTP calls
vi.mock("@/services/task-workflow", () => ({
  startTaskWorkflow: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/services/workflow-editor-retry", () => ({
  executeWorkflowEditorRetry: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/services/workflow-editor", () => ({
  triggerWorkflowEditorRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getTaskChannelName: (id: string) => `task-${id}`,
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/canvas", () => ({
  notifyFeatureCanvasRefresh: vi.fn().mockResolvedValue(undefined),
}));

describe("PATCH /api/tasks/[taskId] — pod release on HALTED", () => {
  let owner: User;
  let workspace: Workspace;

  beforeEach(async () => {
    vi.clearAllMocks();

    owner = await createTestUser({ email: `owner-${Date.now()}@test.com` });
    workspace = await createTestWorkspace({
      name: "Test Workspace",
      slug: `test-ws-${Date.now()}`,
      ownerId: owner.id,
    });

    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: "OWNER" },
    });
  });

  test("returns 403 for non-member before any pod release runs", async () => {
    const nonMember = await createTestUser({ email: `outsider-${Date.now()}@test.com` });
    const swarm = await createTestSwarm({ workspaceId: workspace.id });
    const pod = await createTestPod({ swarmId: swarm.id, usageStatus: "USED" });

    const task = await createTestTask({
      workspaceId: workspace.id,
      createdById: owner.id,
      status: "IN_PROGRESS",
    });
    await db.task.update({ where: { id: task.id }, data: { podId: pod.podId } });

    const req = createAuthenticatedPatchRequest(
      `/api/tasks/${task.id}`,
      { workflowStatus: "HALTED" },
      nonMember,
    );

    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });
    expect(res.status).toBe(403);
    expect(releaseTaskPod).not.toHaveBeenCalled();
  });

  test("calls releaseTaskPod with correct args for non-agent task with pod on HALTED", async () => {
    const swarm = await createTestSwarm({ workspaceId: workspace.id });
    const pod = await createTestPod({ swarmId: swarm.id, usageStatus: "USED" });

    const task = await createTestTask({
      workspaceId: workspace.id,
      createdById: owner.id,
      status: "IN_PROGRESS",
    });
    // Assign pod and set mode = live
    await db.task.update({ where: { id: task.id }, data: { podId: pod.podId, mode: "live" } });

    const req = createAuthenticatedPatchRequest(
      `/api/tasks/${task.id}`,
      { workflowStatus: "HALTED" },
      owner,
    );

    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });
    expect(res.status).toBe(200);

    // Give fire-and-forget a tick to execute
    await new Promise((r) => setTimeout(r, 50));

    expect(releaseTaskPod).toHaveBeenCalledOnce();
    expect(releaseTaskPod).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.id,
        podId: pod.podId,
        workspaceId: workspace.id,
        newWorkflowStatus: null,
      }),
    );
  });

  test("does NOT call releaseTaskPod for agent-mode task with pod on HALTED", async () => {
    const swarm = await createTestSwarm({ workspaceId: workspace.id });
    const pod = await createTestPod({ swarmId: swarm.id, usageStatus: "USED" });

    const task = await createTestTask({
      workspaceId: workspace.id,
      createdById: owner.id,
      status: "IN_PROGRESS",
    });
    await db.task.update({ where: { id: task.id }, data: { podId: pod.podId, mode: "agent" } });

    const req = createAuthenticatedPatchRequest(
      `/api/tasks/${task.id}`,
      { workflowStatus: "HALTED" },
      owner,
    );

    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));

    expect(releaseTaskPod).not.toHaveBeenCalled();
  });

  test("does NOT call releaseTaskPod when task has no pod", async () => {
    const task = await createTestTask({
      workspaceId: workspace.id,
      createdById: owner.id,
      status: "IN_PROGRESS",
    });
    // no podId set

    const req = createAuthenticatedPatchRequest(
      `/api/tasks/${task.id}`,
      { workflowStatus: "HALTED" },
      owner,
    );

    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));

    expect(releaseTaskPod).not.toHaveBeenCalled();
  });

  test("DB-level: pod usageStatus becomes UNUSED and task.podId becomes null after HALTED (real releaseTaskPod)", async () => {
    // Restore real implementation for this test
    const { releaseTaskPod: realRelease } = await vi.importActual<typeof import("@/lib/pods/utils")>(
      "@/lib/pods/utils",
    );
    vi.mocked(releaseTaskPod).mockImplementation(realRelease);

    const swarm = await createTestSwarm({ workspaceId: workspace.id });
    const pod = await createTestPod({ swarmId: swarm.id, usageStatus: "USED" });

    const task = await createTestTask({
      workspaceId: workspace.id,
      createdById: owner.id,
      status: "IN_PROGRESS",
    });
    // Assign pod to task and mark ownership so verifyOwnership check passes
    await db.task.update({ where: { id: task.id }, data: { podId: pod.podId, mode: "live" } });
    await db.pod.update({
      where: { id: pod.id },
      data: { usageStatusMarkedBy: task.id },
    });

    const req = createAuthenticatedPatchRequest(
      `/api/tasks/${task.id}`,
      { workflowStatus: "HALTED" },
      owner,
    );

    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });
    expect(res.status).toBe(200);

    // Wait for fire-and-forget to complete
    await new Promise((r) => setTimeout(r, 300));

    // Verify DB state
    const updatedTask = await db.task.findUnique({ where: { id: task.id } });
    expect(updatedTask?.podId).toBeNull();

    const updatedPod = await db.pod.findUnique({ where: { id: pod.id } });
    expect(updatedPod?.usageStatus).toBe("UNUSED");
  });
});
