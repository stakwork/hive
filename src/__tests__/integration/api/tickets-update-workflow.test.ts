import { describe, test, expect, beforeEach, vi } from "vitest";
import { PATCH } from "@/app/api/tickets/[ticketId]/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import {
  createAuthenticatedPatchRequest,
  expectSuccess,
  expectError,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Task, Feature } from "@prisma/client";

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
