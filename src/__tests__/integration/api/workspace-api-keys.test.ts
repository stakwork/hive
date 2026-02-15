import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/workspaces/[slug]/api-keys/route";
import { DELETE } from "@/app/api/workspaces/[slug]/api-keys/[keyId]/route";
import { db } from "@/lib/db";
import { createTestWorkspaceScenario } from "@/__tests__/support/factories/workspace.factory";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
  expectForbidden,
  expectError,
  createGetRequest,
  createPostRequest,
  createDeleteRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";

describe("Workspace API Keys Integration Tests", () => {
  async function createTestWorkspaceWithUsers() {
    const scenario = await createTestWorkspaceScenario({
      owner: {
        name: "Owner User",
      },
      members: [
        {
          user: { name: "Developer User" },
          role: "DEVELOPER",
        },
        {
          user: { name: "Viewer User" },
          role: "VIEWER",
        },
      ],
    });

    return {
      ownerUser: scenario.owner,
      workspace: scenario.workspace,
      developerUser: scenario.members[0],
      viewerUser: scenario.members[1],
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/[slug]/api-keys", () => {
    test("should return empty list when no API keys exist", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.keys).toEqual([]);
    });

    test("should return API keys for workspace", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();

      // Create an API key directly in the database
      await db.workspaceApiKey.create({
        data: {
          workspaceId: workspace.id,
          name: "Test Key",
          keyPrefix: "hive_tes",
          keyHash: "testhash123",
          createdById: ownerUser.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.keys).toHaveLength(1);
      expect(data.keys[0].name).toBe("Test Key");
      expect(data.keys[0].keyPrefix).toBe("hive_tes");
      expect(data.keys[0].createdBy.id).toBe(ownerUser.id);
      // Should not include full key
      expect(data.keys[0].key).toBeUndefined();
    });

    test("should return 401 when user not authenticated", async () => {
      const { workspace } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectUnauthorized(response);
    });

    test("should return 403 when user is viewer (no write access)", async () => {
      const { viewerUser, workspace } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys`
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectForbidden(response);
    });

    test("should return 404 for non-existent workspace", async () => {
      const { ownerUser } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/nonexistent/api-keys"
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: "nonexistent" }),
      });

      await expectForbidden(response);
    });
  });

  describe("POST /api/workspaces/[slug]/api-keys", () => {
    test("should create API key and return full key once", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys`,
        {
          name: "My API Key",
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 201);
      expect(data.name).toBe("My API Key");
      expect(data.key).toBeDefined();
      expect(data.key.startsWith("hive_")).toBe(true);
      expect(data.keyPrefix).toBe(data.key.slice(0, 8));

      // Verify key was stored in database
      const keyInDb = await db.workspaceApiKey.findUnique({
        where: { id: data.id },
      });
      expect(keyInDb).toBeTruthy();
      expect(keyInDb?.name).toBe("My API Key");
      expect(keyInDb?.workspaceId).toBe(workspace.id);
      expect(keyInDb?.createdById).toBe(ownerUser.id);
    });

    test("should create API key with expiration", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys`,
        {
          name: "Expiring Key",
          expiresAt,
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 201);
      expect(data.name).toBe("Expiring Key");
      expect(data.expiresAt).toBeDefined();

      // Verify expiration was stored
      const keyInDb = await db.workspaceApiKey.findUnique({
        where: { id: data.id },
      });
      expect(keyInDb?.expiresAt).toBeTruthy();
    });

    test("should allow developer to create API key", async () => {
      const { developerUser, workspace } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(developerUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys`,
        {
          name: "Developer Key",
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 201);
      expect(data.name).toBe("Developer Key");
    });

    test("should return 400 for missing name", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Invalid request body", 400);
    });

    test("should return 403 when user is viewer", async () => {
      const { viewerUser, workspace } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys`,
        {
          name: "Should Fail",
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectForbidden(response);
    });

    test("should return 401 when user not authenticated", async () => {
      const { workspace } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys`,
        {
          name: "Should Fail",
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectUnauthorized(response);
    });
  });

  describe("DELETE /api/workspaces/[slug]/api-keys/[keyId]", () => {
    test("should revoke API key as owner", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();

      // Create an API key
      const apiKey = await db.workspaceApiKey.create({
        data: {
          workspaceId: workspace.id,
          name: "Key to Revoke",
          keyPrefix: "hive_tes",
          keyHash: "revoketesthash",
          createdById: ownerUser.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createDeleteRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys/${apiKey.id}`
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, keyId: apiKey.id }),
      });

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.message).toBe("API key revoked");

      // Verify key was revoked in database
      const keyInDb = await db.workspaceApiKey.findUnique({
        where: { id: apiKey.id },
      });
      expect(keyInDb?.revokedAt).toBeTruthy();
      expect(keyInDb?.revokedById).toBe(ownerUser.id);
    });

    test("should allow developer to revoke their own key", async () => {
      const { developerUser, workspace } = await createTestWorkspaceWithUsers();

      // Create an API key owned by developer
      const apiKey = await db.workspaceApiKey.create({
        data: {
          workspaceId: workspace.id,
          name: "Developer Key",
          keyPrefix: "hive_dev",
          keyHash: "devkeyhash",
          createdById: developerUser.id,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(developerUser)
      );

      const request = createDeleteRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys/${apiKey.id}`
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, keyId: apiKey.id }),
      });

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);

      // Verify key was revoked
      const keyInDb = await db.workspaceApiKey.findUnique({
        where: { id: apiKey.id },
      });
      expect(keyInDb?.revokedAt).toBeTruthy();
    });

    test("should prevent developer from revoking another user's key", async () => {
      const { ownerUser, developerUser, workspace } =
        await createTestWorkspaceWithUsers();

      // Create an API key owned by owner
      const apiKey = await db.workspaceApiKey.create({
        data: {
          workspaceId: workspace.id,
          name: "Owner Key",
          keyPrefix: "hive_own",
          keyHash: "ownerkeyhash",
          createdById: ownerUser.id,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(developerUser)
      );

      const request = createDeleteRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys/${apiKey.id}`
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, keyId: apiKey.id }),
      });

      await expectForbidden(response, "can only revoke your own keys");

      // Verify key was NOT revoked
      const keyInDb = await db.workspaceApiKey.findUnique({
        where: { id: apiKey.id },
      });
      expect(keyInDb?.revokedAt).toBeNull();
    });

    test("should return 400 when key already revoked", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();

      // Create an already revoked API key
      const apiKey = await db.workspaceApiKey.create({
        data: {
          workspaceId: workspace.id,
          name: "Already Revoked",
          keyPrefix: "hive_rev",
          keyHash: "revokedkeyhash",
          createdById: ownerUser.id,
          revokedAt: new Date(),
          revokedById: ownerUser.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createDeleteRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys/${apiKey.id}`
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, keyId: apiKey.id }),
      });

      await expectError(response, "already revoked", 400);
    });

    test("should return 404 for non-existent key", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createDeleteRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys/nonexistent`
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, keyId: "nonexistent" }),
      });

      await expectNotFound(response, "API key not found");
    });

    test("should return 404 when key belongs to different workspace", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();

      // Create another workspace
      const otherScenario = await createTestWorkspaceScenario({
        owner: { name: "Other Owner" },
      });

      // Create key in other workspace
      const apiKey = await db.workspaceApiKey.create({
        data: {
          workspaceId: otherScenario.workspace.id,
          name: "Other Workspace Key",
          keyPrefix: "hive_oth",
          keyHash: "otherwshash",
          createdById: otherScenario.owner.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createDeleteRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys/${apiKey.id}`
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, keyId: apiKey.id }),
      });

      await expectNotFound(response, "API key not found");
    });

    test("should return 401 when user not authenticated", async () => {
      const { workspace, ownerUser } = await createTestWorkspaceWithUsers();

      const apiKey = await db.workspaceApiKey.create({
        data: {
          workspaceId: workspace.id,
          name: "Test Key",
          keyPrefix: "hive_tes",
          keyHash: "testkeyhash",
          createdById: ownerUser.id,
        },
      });

      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createDeleteRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys/${apiKey.id}`
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, keyId: apiKey.id }),
      });

      await expectUnauthorized(response);
    });

    test("should return 403 when user is viewer", async () => {
      const { viewerUser, ownerUser, workspace } =
        await createTestWorkspaceWithUsers();

      const apiKey = await db.workspaceApiKey.create({
        data: {
          workspaceId: workspace.id,
          name: "Test Key",
          keyPrefix: "hive_tes",
          keyHash: "viewertesthash",
          createdById: ownerUser.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      const request = createDeleteRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/api-keys/${apiKey.id}`
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, keyId: apiKey.id }),
      });

      await expectForbidden(response);
    });
  });
});
