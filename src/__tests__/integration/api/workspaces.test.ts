import { describe, test, expect, beforeEach } from "vitest";
import { GET, POST, DELETE } from "@/app/api/workspaces/route";
import { db } from "@/lib/db";
import {
  WORKSPACE_ERRORS,
  WORKSPACE_LIMITS,
} from "@/lib/constants";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectError,
  generateUniqueSlug,
  createAuthenticatedPostRequest,
  createAuthenticatedGetRequest,
  createAuthenticatedDeleteRequest,
  createPostRequest,
} from "@/__tests__/support/helpers";

describe("Workspace API - Integration Tests", () => {
  describe("POST /api/workspaces", () => {
    test.each([
      {
        name: "creates workspace successfully",
        setup: async () => ({ user: await createTestUser() }),
        requestData: {
          name: "Test Workspace",
          description: "A test workspace",
        },
        expectedStatus: 201,
        assertions: async (response: Response, { user }: { user: any }) => {
          const data = await expectSuccess(response, 201);
          const slug = data.workspace.slug;
          expect(data.workspace).toMatchObject({
            name: "Test Workspace",
            slug,
            ownerId: user.id,
          });
        },
      },
      {
        name: "enforces workspace limit",
        setup: async () => {
          const user = await createTestUser();
          for (let index = 0; index < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; index++) {
            await createTestWorkspace({
              ownerId: user.id,
              name: `Workspace ${index + 1}`,
              slug: generateUniqueSlug(`workspace-${index + 1}`),
            });
          }
          return { user };
        },
        requestData: {
          name: "Extra Workspace",
          description: "This should fail",
        },
        expectedStatus: 400,
        assertions: async (response: Response) => {
          await expectError(response, WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED, 400);
        },
      },
      {
        name: "permits creation after workspace deletion",
        setup: async () => {
          const user = await createTestUser();
          const workspaces = [];
          for (let index = 0; index < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; index++) {
            const workspace = await createTestWorkspace({
              ownerId: user.id,
              name: `Workspace ${index + 1}`,
              slug: generateUniqueSlug(`workspace-${index + 1}`),
            });
            workspaces.push(workspace);
          }
          await db.workspace.update({
            where: { id: workspaces[0].id },
            data: { deleted: true, deletedAt: new Date() },
          });
          return { user };
        },
        requestData: {
          name: "New Workspace",
        },
        expectedStatus: 201,
        assertions: async (response: Response) => {
          const data = await expectSuccess(response, 201);
          expect(data.workspace.name).toBe("New Workspace");
        },
      },
      {
        name: "rejects duplicate slugs",
        setup: async () => {
          const user = await createTestUser();
          const slug = generateUniqueSlug("duplicate");
          await createTestWorkspace({
            ownerId: user.id,
            name: "First Workspace",
            slug,
          });
          return { user, slug };
        },
        requestData: {
          name: "Duplicate Workspace",
        },
        expectedStatus: 400,
        assertions: async (response: Response) => {
          await expectError(response, WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS, 400);
        },
      },
    ])("$name", async ({ setup, requestData, assertions }) => {
      const context = await setup();
      const slug = (context as any).slug || generateUniqueSlug(requestData.name.toLowerCase().replace(/\s+/g, "-"));

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/workspaces",
        { ...requestData, slug },
        context.user
      );

      const response = await POST(request);
      await assertions(response, context);
    });

    test("rejects unauthenticated requests", async () => {
      // Create request without middleware auth headers
      const request = createPostRequest("http://localhost:3000/api/workspaces", {
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const response = await POST(request);

      // Should get 401 Unauthorized
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    test("rejects missing required fields", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/workspaces",
        { description: "Missing name and slug" },
        user
      );

      const response = await POST(request);

      await expectError(response, "Missing required fields", 400);
    });
  });
});
