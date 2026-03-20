import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { createAuthenticatedPostRequest } from "@/__tests__/support/helpers/request-builders";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { generateUniqueSlug } from "@/__tests__/support/helpers/ids";

async function createTestWorkspace(ownerId: string) {
  const slug = generateUniqueSlug("branch-test-ws");
  return db.workspaces.create({
    data: {
      name: `Branch Test Workspace ${slug}`,
      slug,
      ownerId,
      members: {
        create: {user_id: ownerId, role: "OWNER" },
      },
    },
  });
}

async function cleanup(workspaceIds: string[], userIds: string[]) {
  await db.tasks.deleteMany({ where: {workspace_id: { in: workspaceIds } } });
  await db.workspace_members.deleteMany({ where: {workspace_id: { in: workspaceIds } } });
  await db.workspaces.deleteMany({ where: { id: { in: workspaceIds } } });
  await db.users.deleteMany({ where: { id: { in: userIds } } });
}

describe("POST /api/tasks — branch persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("persists branch on the created task when branch is provided", async () => {
    const user = await createTestUser({ name: "Branch Test User" });
    const workspace = await createTestWorkspace(user.id);

    try {
      const request = createAuthenticatedPostRequest(
        "http://localhost/api/tasks",
        { id: user.id, email: user.email ?? "", name: user.name ?? "" },
        {
          title: "Task with branch",
          workspaceSlug: workspace.slug,
          branch: "feature/my-branch",
          status: "active",
        },
      );

      const response = await POST(request);

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data).toBeDefined();
      const taskId = body.data.id;

      const task = await db.tasks.findUnique({
        where: { id: taskId },
        select: { branch: true },
      });

      expect(task?.branch).toBe("feature/my-branch");
    } finally {
      await cleanup([workspace.id], [user.id]);
    }
  });

  test("creates task with branch: null when branch is omitted from body", async () => {
    const user = await createTestUser({ name: "Branch Null Test User" });
    const workspace = await createTestWorkspace(user.id);

    try {
      const request = createAuthenticatedPostRequest(
        "http://localhost/api/tasks",
        { id: user.id, email: user.email ?? "", name: user.name ?? "" },
        {
          title: "Task without branch",
          workspaceSlug: workspace.slug,
          status: "active",
        },
      );

      const response = await POST(request);

      expect(response.status).toBe(201);
      const body = await response.json();
      const taskId = body.data.id;

      const task = await db.tasks.findUnique({
        where: { id: taskId },
        select: { branch: true },
      });

      expect(task?.branch).toBeNull();
    } finally {
      await cleanup([workspace.id], [user.id]);
    }
  });
});
