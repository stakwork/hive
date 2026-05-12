import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/tasks/[taskId]/workflow-task/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import {
  createAuthenticatedPostRequest,
  expectSuccess,
  expectError,
  createPostRequest,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Task } from "@prisma/client";

describe("POST /api/tasks/[taskId]/workflow-task", () => {
  let owner: User;
  let workspace: Workspace;
  let task: Task;

  beforeEach(async () => {
    vi.clearAllMocks();

    owner = await createTestUser({ email: "owner@test.com" });
    workspace = await createTestWorkspace({
      name: "Test Workspace",
      slug: "test-workspace",
      ownerId: owner.id,
    });

    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: "OWNER" },
    });

    task = await db.task.create({
      data: {
        title: "WFE Task",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        mode: "workflow_editor",
      },
    });
  });

  test("requires authentication", async () => {
    const request = createPostRequest(
      `http://localhost:3000/api/tasks/${task.id}/workflow-task`,
      { workflowId: 1, workflowName: "foo", workflowRefId: "ref" }
    );
    const response = await POST(request, { params: Promise.resolve({ taskId: task.id }) });
    expect(response.status).toBe(401);
  });

  test("returns 400 when workflowId is missing", async () => {
    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/tasks/${task.id}/workflow-task`,
      owner,
      { workflowName: "foo" }
    );
    const response = await POST(request, { params: Promise.resolve({ taskId: task.id }) });
    await expectError(response, "workflowId", 400);
  });

  test("creates WorkflowTask row on first call", async () => {
    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/tasks/${task.id}/workflow-task`,
      owner,
      { workflowId: 42, workflowName: "my-wf", workflowRefId: "ref-001", workflowVersionId: "v1" }
    );
    const response = await POST(request, { params: Promise.resolve({ taskId: task.id }) });
    const data = await expectSuccess(response, 200);

    expect(data.data.workflowId).toBe(42);
    expect(data.data.workflowName).toBe("my-wf");
    expect(data.data.workflowRefId).toBe("ref-001");

    const row = await db.workflowTask.findUnique({ where: { taskId: task.id } });
    expect(row).not.toBeNull();
    expect(row!.workflowId).toBe(42);
  });

  test("upserts idempotently on second call", async () => {
    const makeRequest = () =>
      createAuthenticatedPostRequest(
        `http://localhost:3000/api/tasks/${task.id}/workflow-task`,
        owner,
        { workflowId: 42, workflowName: "my-wf", workflowRefId: "ref-001" }
      );

    await POST(makeRequest(), { params: Promise.resolve({ taskId: task.id }) });
    const response2 = await POST(makeRequest(), { params: Promise.resolve({ taskId: task.id }) });
    await expectSuccess(response2, 200);

    const rows = await db.workflowTask.findMany({ where: { taskId: task.id } });
    expect(rows).toHaveLength(1);
  });

  test("updates existing WorkflowTask row on repeated call with new workflowId", async () => {
    const req1 = createAuthenticatedPostRequest(
      `http://localhost:3000/api/tasks/${task.id}/workflow-task`,
      owner,
      { workflowId: 10, workflowName: "first", workflowRefId: "ref-a" }
    );
    await POST(req1, { params: Promise.resolve({ taskId: task.id }) });

    const req2 = createAuthenticatedPostRequest(
      `http://localhost:3000/api/tasks/${task.id}/workflow-task`,
      owner,
      { workflowId: 99, workflowName: "second", workflowRefId: "ref-b" }
    );
    await POST(req2, { params: Promise.resolve({ taskId: task.id }) });

    const row = await db.workflowTask.findUnique({ where: { taskId: task.id } });
    expect(row!.workflowId).toBe(99);
    expect(row!.workflowName).toBe("second");
  });

  test("returns 404 for a non-existent task", async () => {
    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/tasks/nonexistent/workflow-task`,
      owner,
      { workflowId: 1 }
    );
    const response = await POST(request, { params: Promise.resolve({ taskId: "nonexistent" }) });
    await expectError(response, "not found", 404);
  });
});
