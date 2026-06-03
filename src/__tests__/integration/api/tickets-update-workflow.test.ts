import { describe, test, expect, beforeEach, vi } from "vitest";
import { PATCH } from "@/app/api/tickets/[ticketId]/route";
import { POST as assignAll } from "@/app/api/features/[featureId]/tasks/assign-all/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import {
  createAuthenticatedPatchRequest,
  createAuthenticatedPostRequest,
  expectSuccess,
  expectError,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Task, Feature } from "@prisma/client";

// Mock workflow-editor so triggerWorkflowEditorRun doesn't hit external APIs
vi.mock("@/services/workflow-editor", () => ({
  triggerWorkflowEditorRun: vi.fn().mockResolvedValue(undefined),
  saveWorkflowArtifact: vi.fn().mockResolvedValue(undefined),
}));

// Mock coordinator sweeps so eager-start doesn't run in tests
vi.mock("@/services/task-coordinator-cron", async () => {
  const actual = await vi.importActual("@/services/task-coordinator-cron");
  return {
    ...actual,
    processTicketSweep: vi.fn().mockResolvedValue(0),
    processWorkflowTaskSweep: vi.fn().mockResolvedValue(0),
  };
});

// Mock pool status queries
vi.mock("@/lib/pods/status-queries", () => ({
  getPoolStatusFromPods: vi.fn().mockResolvedValue({
    unusedVms: 0,
    runningVms: 0,
    pendingVms: 0,
    failedVms: 0,
    usedVms: 0,
    lastCheck: new Date().toISOString(),
    queuedCount: 0,
  }),
}));

describe("PATCH /api/tickets/[ticketId] — workflow fields", () => {
  let owner: User;
  let workspace: Workspace;
  let feature: Feature;
  let task: Task;

  beforeEach(async () => {
    vi.clearAllMocks();

    owner = await createTestUser({ email: "owner@test.com" });
    workspace = await createTestWorkspace({
      name: "Stakwork",
      slug: "stakwork",
      ownerId: owner.id,
    });

    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: "OWNER" },
    });

    feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    task = await db.task.create({
      data: {
        title: "Repo Task",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: "TODO",
      },
    });
  });

  test("PATCH with workflowId upserts WorkflowTask and clears repositoryId", async () => {
    const request = createAuthenticatedPatchRequest(
      `http://localhost:3000/api/tickets/${task.id}`,
      { workflowId: 55, workflowName: "wf-test", workflowRefId: "ref-55" },
      owner
    );
    const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id }) });
    await expectSuccess(response, 200);

    const wt = await db.workflowTask.findUnique({ where: { taskId: task.id } });
    expect(wt).not.toBeNull();
    expect(wt!.workflowId).toBe(55);
    expect(wt!.workflowName).toBe("wf-test");
    expect(wt!.workflowRefId).toBe("ref-55");

    const updatedTask = await db.task.findUnique({
      where: { id: task.id },
      select: { repositoryId: true, mode: true },
    });
    expect(updatedTask!.repositoryId).toBeNull();
    expect(updatedTask!.mode).toBe("workflow_editor");
  });

  test("PATCH with workflowId updates existing WorkflowTask idempotently", async () => {
    await db.workflowTask.create({
      data: { taskId: task.id, workflowId: 10, workflowName: "old", workflowRefId: "old-ref" },
    });

    const request = createAuthenticatedPatchRequest(
      `http://localhost:3000/api/tickets/${task.id}`,
      { workflowId: 20, workflowName: "new", workflowRefId: "new-ref" },
      owner
    );
    await PATCH(request, { params: Promise.resolve({ ticketId: task.id }) });

    const rows = await db.workflowTask.findMany({ where: { taskId: task.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].workflowId).toBe(20);
  });

  test("PATCH with both workflowId and repositoryId returns 400", async () => {
    const repo = await db.repository.create({
      data: {
        name: "my-repo",
        repositoryUrl: "https://github.com/test/my-repo",
        workspaceId: workspace.id,
      },
    });

    const request = createAuthenticatedPatchRequest(
      `http://localhost:3000/api/tickets/${task.id}`,
      { workflowId: 55, repositoryId: repo.id },
      owner
    );
    const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id }) });
    expect(response.status).toBe(400);
  });

  test("PATCH with repositoryId on a workflow task removes WorkflowTask", async () => {
    // Set up as a workflow task first
    await db.workflowTask.create({
      data: { taskId: task.id, workflowId: 77, workflowName: "wf", workflowRefId: "ref" },
    });
    await db.task.update({ where: { id: task.id }, data: { mode: "workflow_editor" } });

    const repo = await db.repository.create({
      data: {
        name: "switch-repo",
        repositoryUrl: "https://github.com/test/switch-repo",
        workspaceId: workspace.id,
      },
    });

    const request = createAuthenticatedPatchRequest(
      `http://localhost:3000/api/tickets/${task.id}`,
      { repositoryId: repo.id },
      owner
    );
    await PATCH(request, { params: Promise.resolve({ ticketId: task.id }) });

    const wt = await db.workflowTask.findUnique({ where: { taskId: task.id } });
    expect(wt).toBeNull();
  });
});

describe("POST /api/features/[featureId]/tasks/assign-all — workflow task behaviour", () => {
  let owner: User;
  let workspace: Workspace;
  let feature: Feature;
  let phase: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    owner = await createTestUser({ email: "owner-assignall@test.com" });
    workspace = await createTestWorkspace({
      name: "AssignAll WS",
      slug: "assign-all-ws",
      ownerId: owner.id,
    });

    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: "OWNER" },
    });

    feature = await db.feature.create({
      data: {
        title: "Assign All Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    phase = await db.phase.create({
      data: {
        name: "Phase 1",
        order: 0,
        featureId: feature.id,
      },
    });
  });

  test("workflow task is assigned to TASK_COORDINATOR — triggerWorkflowEditorRun NOT called inline", async () => {
    const { triggerWorkflowEditorRun } = await import("@/services/workflow-editor");

    // Create a workflow task
    const workflowTask = await db.task.create({
      data: {
        title: "My Workflow Task",
        description: "Run the workflow",
        workspaceId: workspace.id,
        featureId: feature.id,
        phaseId: phase.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: "TODO",
        mode: "workflow_editor",
      },
    });

    await db.workflowTask.create({
      data: {
        taskId: workflowTask.id,
        workflowId: 55,
        workflowName: "Test Workflow",
        workflowRefId: "ref-55",
      },
    });

    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/features/${feature.id}/tasks/assign-all`,
      owner,
      {}
    );
    const response = await assignAll(request, { params: Promise.resolve({ featureId: feature.id }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);

    // Verify task assigned to coordinator, NOT dispatched inline
    const updated = await db.task.findUnique({ where: { id: workflowTask.id } });
    expect(updated?.systemAssigneeType).toBe("TASK_COORDINATOR");

    // triggerWorkflowEditorRun must NOT have been called inline
    expect(triggerWorkflowEditorRun).not.toHaveBeenCalled();
  });

  test("both repo and workflow tasks are assigned to TASK_COORDINATOR in a single updateMany", async () => {
    const { triggerWorkflowEditorRun } = await import("@/services/workflow-editor");

    // Create a repo (coding) task
    const repoTask = await db.task.create({
      data: {
        title: "Repo Task",
        workspaceId: workspace.id,
        featureId: feature.id,
        phaseId: phase.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: "TODO",
        mode: "agent",
      },
    });

    // Create a workflow task
    const workflowTask = await db.task.create({
      data: {
        title: "Workflow Task",
        workspaceId: workspace.id,
        featureId: feature.id,
        phaseId: phase.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: "TODO",
        mode: "workflow_editor",
      },
    });

    await db.workflowTask.create({
      data: {
        taskId: workflowTask.id,
        workflowId: 77,
        workflowName: "Bulk Workflow",
        workflowRefId: "ref-77",
      },
    });

    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/features/${feature.id}/tasks/assign-all`,
      owner,
      {}
    );
    const response = await assignAll(request, { params: Promise.resolve({ featureId: feature.id }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.count).toBe(2);

    const updatedRepo = await db.task.findUnique({ where: { id: repoTask.id } });
    const updatedWorkflow = await db.task.findUnique({ where: { id: workflowTask.id } });

    expect(updatedRepo?.systemAssigneeType).toBe("TASK_COORDINATOR");
    expect(updatedWorkflow?.systemAssigneeType).toBe("TASK_COORDINATOR");

    // No inline dispatch for workflow tasks
    expect(triggerWorkflowEditorRun).not.toHaveBeenCalled();
  });
});
