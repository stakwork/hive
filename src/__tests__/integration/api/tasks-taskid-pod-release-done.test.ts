/**
 * Integration tests: pod release when task is manually marked Done
 * via PATCH /api/tasks/[taskId]
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { db } from "@/lib/db";
import { TaskStatus, WorkflowStatus } from "@prisma/client";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import {
  generateUniqueId,
  generateUniqueSlug,
  createAuthenticatedPatchRequest,
} from "@/__tests__/support/helpers";
import { releaseTaskPod } from "@/lib/pods/utils";

// ── External-service mocks ─────────────────────────────────────────────────
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (id: string) => `task-${id}`,
  PUSHER_EVENTS: {
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
  },
}));

vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/canvas", () => ({
  notifyFeatureCanvasRefresh: vi.fn().mockResolvedValue(undefined),
}));

// Partial mock: keep everything from utils but stub out releaseTaskPod
vi.mock("@/lib/pods/utils", async () => {
  const actual = await vi.importActual("@/lib/pods/utils");
  return { ...actual, releaseTaskPod: vi.fn() };
});

// ── Helpers ────────────────────────────────────────────────────────────────
async function createUserAndWorkspace() {
  const userId = generateUniqueId("user");
  const user = await db.user.create({
    data: { id: userId, email: `${userId}@test.com`, name: "Test User" },
  });
  const workspace = await db.workspace.create({
    data: {
      name: "Pod-Release Test WS",
      slug: generateUniqueSlug("pod-release"),
      ownerId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  return { user, workspace };
}

async function createTask(
  workspaceId: string,
  userId: string,
  overrides: Record<string, unknown> = {}
) {
  return db.task.create({
    data: {
      title: "Pod Release Task",
      workspaceId,
      createdById: userId,
      updatedById: userId,
      status: TaskStatus.IN_PROGRESS,
      workflowStatus: WorkflowStatus.IN_PROGRESS,
      ...overrides,
    },
  });
}

function patchRequest(url: string, body: object, user: { id: string; email: string | null; name: string | null }) {
  return createAuthenticatedPatchRequest(url, body, user);
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe("PATCH /api/tasks/[taskId] — pod release on manual Done", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    vi.mocked(releaseTaskPod).mockResolvedValue({
      success: true,
      podDropped: true,
      taskCleared: true,
    } as Awaited<ReturnType<typeof releaseTaskPod>>);
  });

  test("releases pod when status=DONE and task has an active pod (non-agent)", async () => {
    const { user, workspace } = await createUserAndWorkspace();
    const task = await createTask(workspace.id, user.id, { podId: "pod-abc" });

    const req = patchRequest(
      `http://localhost/api/tasks/${task.id}`,
      { status: "DONE" },
      user
    );
    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Give fire-and-forget a tick to settle
    await new Promise((r) => setImmediate(r));

    expect(releaseTaskPod).toHaveBeenCalledOnce();
    expect(releaseTaskPod).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.id,
        podId: "pod-abc",
        workspaceId: workspace.id,
        verifyOwnership: true,
        clearTaskFields: true,
        newWorkflowStatus: null,
      })
    );
  });

  test("does NOT release pod when task.mode === 'agent', even with status=DONE and active pod", async () => {
    const { user, workspace } = await createUserAndWorkspace();
    const task = await createTask(workspace.id, user.id, {
      podId: "pod-agent",
      mode: "agent",
    });

    const req = patchRequest(
      `http://localhost/api/tasks/${task.id}`,
      { status: "DONE" },
      user
    );
    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });

    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(releaseTaskPod).not.toHaveBeenCalled();
  });

  test("does NOT release pod when podId is null (no active pod)", async () => {
    const { user, workspace } = await createUserAndWorkspace();
    const task = await createTask(workspace.id, user.id, { podId: null });

    const req = patchRequest(
      `http://localhost/api/tasks/${task.id}`,
      { status: "DONE" },
      user
    );
    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });

    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(releaseTaskPod).not.toHaveBeenCalled();
  });

  test("does NOT release pod when payload contains only workflowStatus=COMPLETED (no status=DONE)", async () => {
    const { user, workspace } = await createUserAndWorkspace();
    const task = await createTask(workspace.id, user.id, { podId: "pod-xyz" });

    const req = patchRequest(
      `http://localhost/api/tasks/${task.id}`,
      { workflowStatus: "COMPLETED" },
      user
    );
    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });

    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(releaseTaskPod).not.toHaveBeenCalled();
  });

  test("does NOT release pod for other status values (e.g. IN_PROGRESS)", async () => {
    const { user, workspace } = await createUserAndWorkspace();
    const task = await createTask(workspace.id, user.id, {
      podId: "pod-xyz",
      status: TaskStatus.TODO,
    });

    const req = patchRequest(
      `http://localhost/api/tasks/${task.id}`,
      { status: "IN_PROGRESS" },
      user
    );
    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });

    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(releaseTaskPod).not.toHaveBeenCalled();
  });

  test("status update succeeds even when releaseTaskPod throws (failure-tolerant)", async () => {
    const { user, workspace } = await createUserAndWorkspace();
    const task = await createTask(workspace.id, user.id, { podId: "pod-fail" });

    vi.mocked(releaseTaskPod).mockRejectedValue(new Error("pool manager down"));

    const req = patchRequest(
      `http://localhost/api/tasks/${task.id}`,
      { status: "DONE" },
      user
    );
    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });

    // Status update must still return 200
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.task.status).toBe("DONE");
  });

  // ── Regression: HALTED pod-release path unaffected ─────────────────────
  test("regression: still releases pod for HALTED workflowStatus (non-agent)", async () => {
    const { user, workspace } = await createUserAndWorkspace();
    const task = await createTask(workspace.id, user.id, { podId: "pod-halted" });

    const req = patchRequest(
      `http://localhost/api/tasks/${task.id}`,
      { workflowStatus: "HALTED" },
      user
    );
    const res = await PATCH(req, { params: Promise.resolve({ taskId: task.id }) });

    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(releaseTaskPod).toHaveBeenCalledOnce();
    expect(releaseTaskPod).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.id,
        podId: "pod-halted",
        newWorkflowStatus: null,
      })
    );
  });
});
