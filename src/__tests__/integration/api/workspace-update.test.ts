import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, PUT, DELETE } from "@/app/api/workspaces/[slug]/route";
import { db } from "@/lib/db";
import { createTestWorkspaceScenario } from "@/__tests__/fixtures/workspace";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
  expectForbidden,
  expectConflict,
  expectValidationError,
  expectWorkspaceExists,
  expectWorkspaceDeleted,
  generateUniqueSlug,
  getMockedSession,
  createGetRequest,
  createPutRequest,
  createDeleteRequest,
} from "@/__tests__/helpers";

describe("Workspace Update API Integration Tests", () => {
  async function createTestWorkspace() {
    const scenario = await createTestWorkspaceScenario({
      workspace: {
        description: "Original description",
      },
      members: [
        { role: "ADMIN" },
        { role: "DEVELOPER" },
      ],
    });

    return {
      ownerUser: scenario.owner,
      adminUser: scenario.members[0],
      memberUser: scenario.members[1],
      workspace: scenario.workspace,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/[slug]", () => {
    test("should get workspace successfully with real database operations", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`);
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.workspace).toBeDefined();
      expect(data.workspace.name).toBe(workspace.name);
      expect(data.workspace.slug).toBe(workspace.slug);
      expect(data.workspace.description).toBe("Original description");

      // Verify data comes from real database
      await expectWorkspaceExists(workspace.id);
    });

    test("should return 401 for unauthenticated request", async () => {
      const { workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`);
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectUnauthorized(response);
    });

    test("should return 404 for non-existent workspace", async () => {
      const { ownerUser } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest("http://localhost:3000/api/workspaces/nonexistent");
      const response = await GET(request, { params: Promise.resolve({ slug: "nonexistent" }) });

      await expectNotFound(response, "Workspace not found or access denied");
    });
  });

  describe("PUT /api/workspaces/[slug]", () => {
    test("should update workspace successfully as owner with real database operations", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const updateData = {
        name: "Updated Workspace Name",
        slug: generateUniqueSlug("updated"),
        description: "Updated description",
      };

      const request = createPutRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, updateData);

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.workspace.name).toBe("Updated Workspace Name");
      expect(data.workspace.slug).toBe(updateData.slug);
      expect(data.workspace.description).toBe("Updated description");
      expect(data.slugChanged).toBe(updateData.slug);

      // Verify changes were persisted in database
      const updatedWorkspaceInDb = await db.workspace.findUnique({
        where: { slug: updateData.slug },
      });
      expect(updatedWorkspaceInDb?.name).toBe("Updated Workspace Name");
      expect(updatedWorkspaceInDb?.description).toBe("Updated description");

      // Verify old slug no longer exists
      const oldWorkspaceInDb = await db.workspace.findUnique({
        where: { slug: workspace.slug },
      });
      expect(oldWorkspaceInDb).toBeNull();
    });

    test("should update workspace successfully as admin with real database operations", async () => {
      const { adminUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const updateData = {
        name: "Admin Updated Name",
        slug: workspace.slug, // Keep same slug
        description: "Admin updated description",
      };

      const request = createPutRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, updateData);

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.workspace.name).toBe("Admin Updated Name");
      expect(data.slugChanged).toBeNull(); // Slug didn't change

      // Verify changes were persisted in database
      const updatedWorkspaceInDb = await db.workspace.findUnique({
        where: { slug: workspace.slug },
      });
      expect(updatedWorkspaceInDb?.name).toBe("Admin Updated Name");
      expect(updatedWorkspaceInDb?.description).toBe("Admin updated description");
    });

    test("should return 403 for insufficient permissions", async () => {
      const { memberUser, workspace } = await createTestWorkspace();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const updateData = {
        name: "Unauthorized Update",
        slug: workspace.slug,
        description: "Should not work",
      };

      const request = createPutRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, updateData);

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectForbidden(response, "owners and admins");

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { slug: workspace.slug },
      });
      expect(unchangedWorkspaceInDb?.name).toBe(workspace.name); // Original name
      expect(unchangedWorkspaceInDb?.description).toBe("Original description");
    });

    test("should validate required fields with real schema validation", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const invalidData = {
        name: "", // Empty name should fail validation
        slug: workspace.slug,
      };

      const request = createPutRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, invalidData);

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectValidationError(response);

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { slug: workspace.slug },
      });
      expect(unchangedWorkspaceInDb?.name).toBe(workspace.name);
    });


    test("should prevent duplicate slug with real database constraint", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      // Create another workspace to conflict with
      const conflictWorkspace = await createTestWorkspaceScenario({
        owner: { name: "Conflict Owner" },
        workspace: { slug: "conflict-slug", name: "Conflict Workspace" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const duplicateData = {
        name: "Updated Name",
        slug: conflictWorkspace.workspace.slug, // Try to use existing slug
      };

      const request = createPutRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, duplicateData);

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectConflict(response, "already exists");

      // Verify original workspace slug unchanged
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { slug: workspace.slug },
      });
      expect(unchangedWorkspaceInDb?.slug).toBe(workspace.slug);
    });
  });

  describe("DELETE /api/workspaces/[slug]", () => {
    test("should delete workspace successfully as owner with real database operations", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`);

      const response = await DELETE(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);

      // Verify workspace was soft-deleted in database
      await expectWorkspaceDeleted(workspace.id);

      const deletedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(deletedWorkspaceInDb?.originalSlug).toBe(workspace.slug);
      expect(deletedWorkspaceInDb?.slug).toMatch(/^.+-deleted-\d+$/);
    });

    test("should return 403 for non-owner attempting deletion", async () => {
      const { adminUser, workspace } = await createTestWorkspace();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`);

      const response = await DELETE(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectForbidden(response, "Only workspace owners");

      // Verify workspace was not deleted
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(unchangedWorkspaceInDb?.deleted).toBeFalsy();
      expect(unchangedWorkspaceInDb?.slug).toBe(workspace.slug); // Slug should remain unchanged
    });

    test("should return 404 for non-existent workspace", async () => {
      const { ownerUser } = await createTestWorkspace();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createDeleteRequest("http://localhost:3000/api/workspaces/nonexistent");

      const response = await DELETE(request, { params: Promise.resolve({ slug: "nonexistent" }) });

      await expectNotFound(response, "not found");
    });

    test("should return 401 for unauthenticated deletion", async () => {
      const { workspace } = await createTestWorkspace();
      
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`);

      const response = await DELETE(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectUnauthorized(response);

      // Verify workspace was not deleted
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(unchangedWorkspaceInDb?.deleted).toBeFalsy();
      expect(unchangedWorkspaceInDb?.slug).toBe(workspace.slug); // Slug should remain unchanged
    });
  });
});