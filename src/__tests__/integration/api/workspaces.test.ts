import { describe, test, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/workspaces/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import {
  WORKSPACE_ERRORS,
  WORKSPACE_LIMITS,
} from "@/lib/constants";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/fixtures";
import { invokeRoute } from "@/__tests__/harness";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

describe("Workspace API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const url = "http://localhost:3000/api/workspaces";

  describe("POST /api/workspaces", () => {
    test("creates workspace successfully", async () => {
      const user = await createTestUser();
      const slug = `test-workspace-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url,
        session: { user: { id: user.id, email: user.email } },
        body: {
          name: "Test Workspace",
          description: "A test workspace",
          slug,
        },
      });

      const data = await json<{ workspace: { name: string; slug: string; ownerId: string } }>();

      expect(status).toBe(201);
      expect(data.workspace).toMatchObject({
        name: "Test Workspace",
        slug,
        ownerId: user.id,
      });
    });

    test("enforces workspace limit", async () => {
      const user = await createTestUser();

      for (let index = 0; index < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; index++) {
        await createTestWorkspace({
          ownerId: user.id,
          name: `Workspace ${index + 1}`,
          slug: `workspace-${index + 1}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`,
        });
      }

      const slug = `extra-workspace-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url,
        session: { user: { id: user.id, email: user.email } },
        body: {
          name: "Extra Workspace",
          description: "This should fail",
          slug,
        },
      });

      const data = await json<{ error: string }>();

      expect(status).toBe(400);
      expect(data.error).toBe(WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED);
    });

    test("permits creation after workspace deletion", async () => {
      const user = await createTestUser();

      const workspaces = [];
      for (let index = 0; index < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; index++) {
        const workspace = await createTestWorkspace({
          ownerId: user.id,
          name: `Workspace ${index + 1}`,
          slug: `workspace-${index + 1}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`,
        });
        workspaces.push(workspace);
      }

      await db.workspace.update({
        where: { id: workspaces[0].id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const slug = `new-workspace-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url,
        session: { user: { id: user.id, email: user.email } },
        body: {
          name: "New Workspace",
          slug,
        },
      });

      const data = await json<{ workspace: { name: string; slug: string } }>();

      expect(status).toBe(201);
      expect(data.workspace.name).toBe("New Workspace");
      expect(data.workspace.slug).toBe(slug);
    });

    test("rejects unauthenticated requests", async () => {
      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url,
        session: null,
        body: {
          name: "Test Workspace",
          slug: "test-workspace",
        },
      });

      const data = await json<{ error: string }>();

      expect(status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("rejects missing required fields", async () => {
      const user = await createTestUser();

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url,
        session: { user: { id: user.id, email: user.email } },
        body: {
          description: "Missing name and slug",
        },
      });

      const data = await json<{ error: string }>();

      expect(status).toBe(400);
      expect(data.error).toBe("Missing required fields");
    });

    test("rejects duplicate slugs", async () => {
      const user = await createTestUser();
      const slug = `duplicate-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;

      await createTestWorkspace({
        ownerId: user.id,
        name: "First Workspace",
        slug,
      });

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url,
        session: { user: { id: user.id, email: user.email } },
        body: {
          name: "Duplicate Workspace",
          slug,
        },
      });

      const data = await json<{ error: string }>();

      expect(status).toBe(400);
      expect(data.error).toBe(WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS);
    });
  });
});
