import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { GET, PUT, DELETE } from "@/app/api/workspaces/[slug]/route";
import { WorkspaceRole } from "@prisma/client";
import { db } from "@/lib/db";

// Mock NextAuth - only external dependency
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;

describe("Workspace Update API Integration Tests", () => {
  async function createTestWorkspace() {
    // Create workspace owner with real database operations
    const ownerUser = await db.user.create({
      data: {
        id: `owner-${Date.now()}-${Math.random()}`,
        email: `owner-${Date.now()}@example.com`,
        name: "Owner User",
      },
    });

    // Create workspace owned by owner
    const workspace = await db.workspace.create({
      data: {
        name: `Test Workspace ${Date.now()}`,
        slug: `test-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        description: "Original description",
        ownerId: ownerUser.id,
      },
    });

    // Create admin user
    const adminUser = await db.user.create({
      data: {
        id: `admin-${Date.now()}-${Math.random()}`,
        email: `admin-${Date.now()}@example.com`,
        name: "Admin User",
      },
    });

    // Add admin as workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: adminUser.id,
        role: WorkspaceRole.ADMIN,
      },
    });

    // Create regular member
    const memberUser = await db.user.create({
      data: {
        id: `member-${Date.now()}-${Math.random()}`,
        email: `member-${Date.now()}@example.com`,
        name: "Member User",
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: memberUser.id,
        role: WorkspaceRole.DEVELOPER,
      },
    });

    return { ownerUser, adminUser, memberUser, workspace };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/[slug]", () => {
    test("should get workspace successfully with real database operations", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`);
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace).toBeDefined();
      expect(data.workspace.name).toBe(workspace.name);
      expect(data.workspace.slug).toBe(workspace.slug);
      expect(data.workspace.description).toBe("Original description");

      // Verify data comes from real database
      const workspaceInDb = await db.workspace.findUnique({
        where: { slug: workspace.slug },
      });
      expect(workspaceInDb?.name).toBe(workspace.name);
    });

    test("should return 401 for unauthenticated request", async () => {
      const { workspace } = await createTestWorkspace();
      
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`);
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
    });

    test("should return 404 for non-existent workspace", async () => {
      const { ownerUser } = await createTestWorkspace();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/workspaces/nonexistent");
      const response = await GET(request, { params: Promise.resolve({ slug: "nonexistent" }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });
  });

  describe("PUT /api/workspaces/[slug]", () => {
    test("should update workspace successfully as owner with real database operations", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const updateData = {
        name: "Updated Workspace Name",
        slug: `updated-slug-${Date.now()}`,
        description: "Updated description",
      };

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: adminUser.id, email: adminUser.email },
      });

      const updateData = {
        name: "Admin Updated Name",
        slug: workspace.slug, // Keep same slug
        description: "Admin updated description",
      };

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: memberUser.id, email: memberUser.email },
      });

      const updateData = {
        name: "Unauthorized Update",
        slug: workspace.slug,
        description: "Should not work",
      };

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("owners and admins");

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { slug: workspace.slug },
      });
      expect(unchangedWorkspaceInDb?.name).toBe(workspace.name); // Original name
      expect(unchangedWorkspaceInDb?.description).toBe("Original description");
    });

    test("should validate required fields with real schema validation", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const invalidData = {
        name: "", // Empty name should fail validation
        slug: workspace.slug,
      };

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalidData),
      });

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Validation failed");
      expect(data.details).toBeDefined();

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { slug: workspace.slug },
      });
      expect(unchangedWorkspaceInDb?.name).toBe(workspace.name);
    });


    test("should prevent duplicate slug with real database constraint", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();
      
      // Create another workspace to conflict with
      const conflictWorkspace = await db.workspace.create({
        data: {
          name: "Conflict Workspace",
          slug: "conflict-slug",
          ownerId: ownerUser.id,
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const duplicateData = {
        name: "Updated Name",
        slug: conflictWorkspace.slug, // Try to use existing slug
      };

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(duplicateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toContain("already exists");

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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, {
        method: "DELETE",
      });

      const response = await DELETE(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify workspace was soft-deleted in database (use ID since slug changes)
      const deletedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(deletedWorkspaceInDb?.deleted).toBe(true);
      expect(deletedWorkspaceInDb?.deletedAt).toBeTruthy();
      expect(deletedWorkspaceInDb?.originalSlug).toBe(workspace.slug);
      expect(deletedWorkspaceInDb?.slug).toMatch(/^.+-deleted-\d+$/);
    });

    test("should return 403 for non-owner attempting deletion", async () => {
      const { adminUser, workspace } = await createTestWorkspace();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: adminUser.id, email: adminUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, {
        method: "DELETE",
      });

      const response = await DELETE(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("Only workspace owners");

      // Verify workspace was not deleted
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(unchangedWorkspaceInDb?.deleted).toBeFalsy();
      expect(unchangedWorkspaceInDb?.slug).toBe(workspace.slug); // Slug should remain unchanged
    });

    test("should return 404 for non-existent workspace", async () => {
      const { ownerUser } = await createTestWorkspace();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/workspaces/nonexistent", {
        method: "DELETE",
      });

      const response = await DELETE(request, { params: Promise.resolve({ slug: "nonexistent" }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("not found");
    });

    test("should return 401 for unauthenticated deletion", async () => {
      const { workspace } = await createTestWorkspace();
      
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}`, {
        method: "DELETE",
      });

      const response = await DELETE(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });

      // Verify workspace was not deleted
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(unchangedWorkspaceInDb?.deleted).toBeFalsy();
      expect(unchangedWorkspaceInDb?.slug).toBe(workspace.slug); // Slug should remain unchanged
    });
  });
});