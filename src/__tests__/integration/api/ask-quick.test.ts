import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/ask/quick/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestSwarm,
  createTestRepository,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers/request-builders";
import {
  expectError,
} from "@/__tests__/support/helpers/api-assertions";

describe("POST /api/ask/quick", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdSwarmIds: string[] = [];
  const createdRepositoryIds: string[] = [];
  const createdMemberIds: string[] = [];

  beforeEach(() => {
    // Clear any state between tests
  });

  afterEach(async () => {
    // Cleanup test data in reverse dependency order
    await db.workspaceMember.deleteMany({
      where: { id: { in: createdMemberIds } },
    });
    await db.swarm.deleteMany({
      where: { id: { in: createdSwarmIds } },
    });
    await db.repository.deleteMany({
      where: { id: { in: createdRepositoryIds } },
    });
    await db.workspace.deleteMany({
      where: { id: { in: createdWorkspaceIds } },
    });
    await db.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });

    // Clear tracking arrays
    createdMemberIds.length = 0;
    createdSwarmIds.length = 0;
    createdRepositoryIds.length = 0;
    createdWorkspaceIds.length = 0;
    createdUserIds.length = 0;
  });

  describe("Input Validation", () => {
    test("should reject missing messages parameter", async () => {
      const user = await createTestUser({
        email: "test@example.com",
        name: "Test User",
      });
      createdUserIds.push(user.id);

      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: user.id,
      });
      createdWorkspaceIds.push(workspace.id);

      const request = createAuthenticatedPostRequest(
        "/api/ask/quick",
        {
          workspaceSlug: workspace.slug,
          // messages missing
        },
        user
      );

      const response = await POST(request);
      await expectError(response, "Missing required parameter: messages", 400);
    });

    test("should reject empty messages array", async () => {
      const user = await createTestUser({
        email: "test@example.com",
        name: "Test User",
      });
      createdUserIds.push(user.id);

      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: user.id,
      });
      createdWorkspaceIds.push(workspace.id);

      const request = createAuthenticatedPostRequest(
        "/api/ask/quick",
        {
          messages: [], // empty array
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);
      await expectError(response, "Missing required parameter: messages", 400);
    });

    test("should reject missing workspaceSlug parameter", async () => {
      const user = await createTestUser({
        email: "test@example.com",
        name: "Test User",
      });
      createdUserIds.push(user.id);

      const request = createAuthenticatedPostRequest(
        "/api/ask/quick",
        {
          messages: [{ role: "user", content: "test question" }],
          // workspaceSlug missing
        },
        user
      );

      const response = await POST(request);
      await expectError(response, "Missing required parameter", 400);
    });
  });

  describe("Resource Validation", () => {
    test("should reject workspace without swarm", async () => {
      const user = await createTestUser({
        email: "test@example.com",
        name: "Test User",
      });
      createdUserIds.push(user.id);

      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: user.id,
      });
      createdWorkspaceIds.push(workspace.id);

      const member = await createTestMembership({
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      });
      createdMemberIds.push(member.id);

      const request = createAuthenticatedPostRequest(
        "/api/ask/quick",
        {
          messages: [{ role: "user", content: "test question" }],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);
      await expectError(response, "Swarm not found", 404);
    });
  });
});
