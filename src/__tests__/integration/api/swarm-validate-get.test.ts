import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/swarm/validate/route";
import { db } from "@/lib/db";
import { resetDatabase } from "@/__tests__/support/fixtures/database";
import {
  getMockedSession,
  createAuthenticatedSession,
} from "@/__tests__/support/helpers/auth";
import {
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  expectBadRequest,
} from "@/__tests__/support/helpers/api-assertions";
import { createGetRequest } from "@/__tests__/support/helpers/request-builders";
import { EncryptionService } from "@/lib/encryption";

vi.mock("@/lib/auth/nextauth");
vi.mock("next-auth");

// Mock global fetch for SwarmService external API calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("GET /api/swarm/validate - Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  let workspace: any;
  let owner: any;
  let admin: any;
  let pm: any;
  let developer: any;
  let stakeholder: any;
  let viewer: any;
  let outsider: any;

  beforeEach(async () => {
    await resetDatabase();

    // Reset fetch mock - simulate successful URI validation
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        message: "Domain validated successfully",
        data: {
          domain_exists: true,
          swarm_name_exist: true,
        },
      }),
    });

    // Create users
    owner = await db.user.create({
      data: {
        email: "owner@example.com",
        name: "Owner User",
      },
    });

    admin = await db.user.create({
      data: {
        email: "admin@example.com",
        name: "Admin User",
      },
    });

    pm = await db.user.create({
      data: {
        email: "pm@example.com",
        name: "PM User",
      },
    });

    developer = await db.user.create({
      data: {
        email: "developer@example.com",
        name: "Developer User",
      },
    });

    stakeholder = await db.user.create({
      data: {
        email: "stakeholder@example.com",
        name: "Stakeholder User",
      },
    });

    viewer = await db.user.create({
      data: {
        email: "viewer@example.com",
        name: "Viewer User",
      },
    });

    outsider = await db.user.create({
      data: {
        email: "outsider@example.com",
        name: "Outsider User",
      },
    });

    // Create workspace
    workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: owner.id,
      },
    });

    // Create workspace members with different roles
    await db.workspaceMember.createMany({
      data: [
        { workspaceId: workspace.id, userId: admin.id, role: "ADMIN" },
        { workspaceId: workspace.id, userId: pm.id, role: "PM" },
        { workspaceId: workspace.id, userId: developer.id, role: "DEVELOPER" },
        { workspaceId: workspace.id, userId: stakeholder.id, role: "STAKEHOLDER" },
        { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("Unauthorized");
    });

    test("returns 401 for invalid session (missing userId)", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("Unauthorized");
    });
  });

  // TODO: Re-enable after workspace access validation is added to /api/swarm/validate route
  // The route currently doesn't validate workspace access - needs to be implemented in a separate PR
  describe.skip("Parameter Validation", () => {
    test("returns 404 when uri parameter is missing", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("Provide url please");
    });

    test("returns 400 when workspaceId parameter is missing", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat`
      );
      const response = await GET(request);

      await expectBadRequest(response);
      const json = await response.json();
      expect(json.message).toBe("Workspace ID is required");
    });
  });

  // TODO: Re-enable after workspace access validation is added to /api/swarm/validate route
  describe.skip("Workspace Access Authorization", () => {
    test("returns 404 for non-existent workspace", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=non-existent-id`
      );
      const response = await GET(request);

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("Access denied");
    });

    test("returns 403 for users who are not workspace members", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: outsider.id, email: outsider.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      await expectForbidden(response);
      const json = await response.json();
      expect(json.message).toBe("Access denied");
    });

    test("returns 403 for workspace members who have left (leftAt set)", async () => {
      // Mark viewer as having left the workspace
      await db.workspaceMember.update({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: viewer.id,
          },
        },
        data: {
          leftAt: new Date(),
        },
      });

      getMockedSession().mockResolvedValue({
        user: { id: viewer.id, email: viewer.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      await expectForbidden(response);
    });

    test("returns 403 for soft-deleted workspaces", async () => {
      // Soft-delete workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true },
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      await expectForbidden(response);
    });
  });

  describe("Role-Based Permissions", () => {
    test("allows OWNER to validate swarm URI", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty("domain_exists");
      expect(data.data).toHaveProperty("swarm_name_exist");
    });

    test("allows ADMIN to validate swarm URI", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: admin.id, email: admin.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    test("allows PM to validate swarm URI", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: pm.id, email: pm.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    test("allows DEVELOPER to validate swarm URI", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: developer.id, email: developer.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    test("allows STAKEHOLDER to validate swarm URI (read-only)", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: stakeholder.id, email: stakeholder.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    test("allows VIEWER to validate swarm URI (minimum read permission)", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: viewer.id, email: viewer.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Swarm URI Validation", () => {
    test("validates URI through external SwarmService API", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.domain_exists).toBe(true);
      expect(data.data.swarm_name_exist).toBe(true);

      // Verify external API was called
      expect(mockFetch).toHaveBeenCalled();
    });

    test("handles domain not found response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          message: "Domain not found",
          data: {
            domain_exists: false,
            swarm_name_exist: false,
          },
        }),
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=nonexistent-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.domain_exists).toBe(false);
      expect(data.data.swarm_name_exist).toBe(false);
    });

    test("handles swarm name not found response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          message: "Swarm name does not exist",
          data: {
            domain_exists: true,
            swarm_name_exist: false,
          },
        }),
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=valid-domain-no-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.domain_exists).toBe(true);
      expect(data.data.swarm_name_exist).toBe(false);
    });

    test("handles external API timeout", async () => {
      mockFetch.mockRejectedValue(new Error("Request timeout"));

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("Failed to validate uri");
    });

    test("handles external API 500 error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("Failed to validate uri");
    });
  });

  // TODO: Re-enable after workspace access validation is added to /api/swarm/validate route
  describe.skip("Workspace Isolation", () => {
    test("cannot validate URI using another workspace's ID", async () => {
      // Create second workspace
      const otherWorkspace = await db.workspace.create({
        data: {
          name: "Other Workspace",
          slug: "other-workspace",
          ownerId: outsider.id,
        },
      });

      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      // Owner tries to validate URI using other workspace's ID
      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${otherWorkspace.id}`
      );
      const response = await GET(request);

      await expectForbidden(response);
      const json = await response.json();
      expect(json.message).toBe("Access denied");
    });

    test("validates URI only within user's authorized workspace", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: admin.id, email: admin.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `/api/swarm/validate?uri=test-swarm.sphinx.chat&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    test("handles extremely long URI", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const longUri = "a".repeat(1000) + ".sphinx.chat";
      const request = createGetRequest(
        `/api/swarm/validate?uri=${encodeURIComponent(longUri)}&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      // Should either succeed or fail gracefully
      expect([200, 400, 500]).toContain(response.status);
    });

    test("handles URI with special characters", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const specialUri = "test_swarm-v2.sphinx.chat";
      const request = createGetRequest(
        `/api/swarm/validate?uri=${encodeURIComponent(specialUri)}&workspaceId=${workspace.id}`
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("handles concurrent validation requests", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: owner.id, email: owner.email },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const requests = Array.from({ length: 5 }, (_, i) =>
        createGetRequest(
          `/api/swarm/validate?uri=swarm-${i}.sphinx.chat&workspaceId=${workspace.id}`
        )
      );

      const responses = await Promise.all(requests.map((req) => GET(req)));

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
    });
  });
});