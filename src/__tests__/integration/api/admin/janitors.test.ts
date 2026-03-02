import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPutRequest,
} from "@/__tests__/support/helpers/request-builders";

describe("Admin Janitors API", () => {
  let superAdminUser: { id: string; email: string; name: string };
  let regularUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; name: string; slug: string };

  beforeEach(async () => {
    // Create test users
    superAdminUser = await createTestUser({
      role: "SUPER_ADMIN",
      email: "superadmin@test.com",
      name: "Super Admin",
    });
    regularUser = await createTestUser({
      role: "USER",
      email: "regular@test.com",
      name: "Regular User",
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: regularUser.id,
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });
  });

  describe("GET /api/admin/workspaces/[id]/janitors", () => {
    it("should return 403 for non-superadmin", async () => {
      const request = createAuthenticatedGetRequest(
        `/api/admin/workspaces/${testWorkspace.id}/janitors`,
        regularUser
      );
      const { GET } = await import(
        "@/app/api/admin/workspaces/[id]/janitors/route"
      );
      const response = await GET(request, {
        params: Promise.resolve({ id: testWorkspace.id }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Forbidden");
    });

    it("should return 404 for unknown workspace ID", async () => {
      const fakeId = "cm00000000000000000000000";
      const request = createAuthenticatedGetRequest(
        `/api/admin/workspaces/${fakeId}/janitors`,
        superAdminUser
      );
      const { GET } = await import(
        "@/app/api/admin/workspaces/[id]/janitors/route"
      );
      const response = await GET(request, {
        params: Promise.resolve({ id: fakeId }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Workspace not found");
    });

    it("should return and upsert default janitor config for valid workspace", async () => {
      const request = createAuthenticatedGetRequest(
        `/api/admin/workspaces/${testWorkspace.id}/janitors`,
        superAdminUser
      );
      const { GET } = await import(
        "@/app/api/admin/workspaces/[id]/janitors/route"
      );
      const response = await GET(request, {
        params: Promise.resolve({ id: testWorkspace.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.config).toBeDefined();
      expect(data.config.workspaceId).toBe(testWorkspace.id);

      // Verify all expected boolean fields exist
      expect(typeof data.config.unitTestsEnabled).toBe("boolean");
      expect(typeof data.config.integrationTestsEnabled).toBe("boolean");
      expect(typeof data.config.e2eTestsEnabled).toBe("boolean");
      expect(typeof data.config.securityReviewEnabled).toBe("boolean");
      expect(typeof data.config.mockGenerationEnabled).toBe("boolean");
      expect(typeof data.config.generalRefactoringEnabled).toBe("boolean");
      expect(typeof data.config.taskCoordinatorEnabled).toBe("boolean");
      expect(typeof data.config.recommendationSweepEnabled).toBe("boolean");
      expect(typeof data.config.ticketSweepEnabled).toBe("boolean");
      expect(typeof data.config.prMonitorEnabled).toBe("boolean");
      expect(typeof data.config.prConflictFixEnabled).toBe("boolean");
      expect(typeof data.config.prCiFailureFixEnabled).toBe("boolean");
      expect(typeof data.config.prOutOfDateFixEnabled).toBe("boolean");
      expect(typeof data.config.prUseMergeForUpdates).toBe("boolean");
      expect(typeof data.config.prUseRebaseForUpdates).toBe("boolean");

      // Verify config was created in database
      const dbConfig = await db.janitorConfig.findUnique({
        where: { workspaceId: testWorkspace.id },
      });
      expect(dbConfig).toBeDefined();
      expect(dbConfig?.workspaceId).toBe(testWorkspace.id);
    });

    it("should return existing janitor config if already created", async () => {
      // Create config first
      await db.janitorConfig.create({
        data: {
          workspaceId: testWorkspace.id,
          unitTestsEnabled: true,
          prMonitorEnabled: true,
        },
      });

      const request = createAuthenticatedGetRequest(
        `/api/admin/workspaces/${testWorkspace.id}/janitors`,
        superAdminUser
      );
      const { GET } = await import(
        "@/app/api/admin/workspaces/[id]/janitors/route"
      );
      const response = await GET(request, {
        params: Promise.resolve({ id: testWorkspace.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.config.unitTestsEnabled).toBe(true);
      expect(data.config.prMonitorEnabled).toBe(true);
    });
  });

  describe("PUT /api/admin/workspaces/[id]/janitors", () => {
    beforeEach(async () => {
      // Ensure config exists for PUT tests
      await db.janitorConfig.create({
        data: {
          workspaceId: testWorkspace.id,
        },
      });
    });

    it("should return 403 for non-superadmin", async () => {
      const request = createAuthenticatedPutRequest(
        `/api/admin/workspaces/${testWorkspace.id}/janitors`,
        regularUser,
        { unitTestsEnabled: true }
      );
      const { PUT } = await import(
        "@/app/api/admin/workspaces/[id]/janitors/route"
      );
      const response = await PUT(request, {
        params: Promise.resolve({ id: testWorkspace.id }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Forbidden");
    });

    it("should update and return modified config field", async () => {
      const request = createAuthenticatedPutRequest(
        `/api/admin/workspaces/${testWorkspace.id}/janitors`,
        superAdminUser,
        { unitTestsEnabled: true }
      );
      const { PUT } = await import(
        "@/app/api/admin/workspaces/[id]/janitors/route"
      );
      const response = await PUT(request, {
        params: Promise.resolve({ id: testWorkspace.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.config).toBeDefined();
      expect(data.config.unitTestsEnabled).toBe(true);

      // Verify database was updated
      const dbConfig = await db.janitorConfig.findUnique({
        where: { workspaceId: testWorkspace.id },
      });
      expect(dbConfig?.unitTestsEnabled).toBe(true);
    });

    it("should update multiple fields at once", async () => {
      const request = createAuthenticatedPutRequest(
        `/api/admin/workspaces/${testWorkspace.id}/janitors`,
        superAdminUser,
        {
          unitTestsEnabled: true,
          integrationTestsEnabled: true,
          prMonitorEnabled: false,
        }
      );
      const { PUT } = await import(
        "@/app/api/admin/workspaces/[id]/janitors/route"
      );
      const response = await PUT(request, {
        params: Promise.resolve({ id: testWorkspace.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.config.unitTestsEnabled).toBe(true);
      expect(data.config.integrationTestsEnabled).toBe(true);
      expect(data.config.prMonitorEnabled).toBe(false);

      // Verify database was updated
      const dbConfig = await db.janitorConfig.findUnique({
        where: { workspaceId: testWorkspace.id },
      });
      expect(dbConfig?.unitTestsEnabled).toBe(true);
      expect(dbConfig?.integrationTestsEnabled).toBe(true);
      expect(dbConfig?.prMonitorEnabled).toBe(false);
    });

    it("should update all 15 boolean fields", async () => {
      const allFields = {
        unitTestsEnabled: true,
        integrationTestsEnabled: true,
        e2eTestsEnabled: true,
        securityReviewEnabled: true,
        mockGenerationEnabled: true,
        generalRefactoringEnabled: true,
        taskCoordinatorEnabled: true,
        recommendationSweepEnabled: true,
        ticketSweepEnabled: true,
        prMonitorEnabled: true,
        prConflictFixEnabled: true,
        prCiFailureFixEnabled: true,
        prOutOfDateFixEnabled: true,
        prUseMergeForUpdates: true,
        prUseRebaseForUpdates: false,
      };

      const request = createAuthenticatedPutRequest(
        `/api/admin/workspaces/${testWorkspace.id}/janitors`,
        superAdminUser,
        allFields
      );
      const { PUT } = await import(
        "@/app/api/admin/workspaces/[id]/janitors/route"
      );
      const response = await PUT(request, {
        params: Promise.resolve({ id: testWorkspace.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify all fields were updated
      Object.entries(allFields).forEach(([key, value]) => {
        expect(data.config[key]).toBe(value);
      });

      // Verify database was updated
      const dbConfig = await db.janitorConfig.findUnique({
        where: { workspaceId: testWorkspace.id },
      });
      Object.entries(allFields).forEach(([key, value]) => {
        expect(dbConfig?.[key as keyof typeof dbConfig]).toBe(value);
      });
    });

    it("should return 400 for invalid field types", async () => {
      const request = createAuthenticatedPutRequest(
        `/api/admin/workspaces/${testWorkspace.id}/janitors`,
        superAdminUser,
        { unitTestsEnabled: "invalid" } // Should be boolean
      );
      const { PUT } = await import(
        "@/app/api/admin/workspaces/[id]/janitors/route"
      );
      const response = await PUT(request, {
        params: Promise.resolve({ id: testWorkspace.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Validation failed");
    });
  });
});
