import { describe, it, expect, beforeEach, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/factories";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers/request-builders";
import * as workspaceService from "@/services/workspace";

describe("DELETE /api/admin/workspaces/[id]", () => {
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let regularUser: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeEach(async () => {
    // Create test users
    superAdminUser = await createTestUser({
      email: "superadmin@test.com",
      role: UserRole.SUPER_ADMIN,
    });
    regularUser = await createTestUser({
      email: "regular@test.com",
    });

    // Create test workspace
    workspace = await createTestWorkspace({
      name: "Test Workspace",
      ownerId: regularUser.id,
    });
  });

  it("returns 401 when no user session is present", async () => {
    const request = new Request(
      `http://localhost/api/admin/workspaces/${workspace.id}`,
      { method: "DELETE" }
    );
    const { DELETE } = await import(
      "@/app/api/admin/workspaces/[id]/route"
    );
    const response = await DELETE(request as any, {
      params: Promise.resolve({ id: workspace.id }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 403 when authenticated user is not a superadmin", async () => {
    const request = new Request(
      `http://localhost/api/admin/workspaces/${workspace.id}`,
      { method: "DELETE", headers: createAuthenticatedGetRequest(
        `/api/admin/workspaces/${workspace.id}`,
        regularUser
      ).headers }
    );
    const { DELETE } = await import(
      "@/app/api/admin/workspaces/[id]/route"
    );
    const response = await DELETE(request, {
      params: Promise.resolve({ id: workspace.id }),
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Forbidden");
  });

  it("returns 404 when workspace ID does not exist", async () => {
    const nonExistentId = "00000000-0000-0000-0000-000000000000";
    const request = new Request(
      `http://localhost/api/admin/workspaces/${nonExistentId}`,
      { method: "DELETE", headers: createAuthenticatedGetRequest(
        `/api/admin/workspaces/${nonExistentId}`,
        superAdminUser
      ).headers }
    );
    const { DELETE } = await import(
      "@/app/api/admin/workspaces/[id]/route"
    );
    const response = await DELETE(request, {
      params: Promise.resolve({ id: nonExistentId }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain("not found");
  });

  it("returns 200 and calls deleteWorkspaceById when a valid superadmin makes the request", async () => {
    const deleteWorkspaceByIdSpy = vi.spyOn(workspaceService, "deleteWorkspaceById");
    
    const request = new Request(
      `http://localhost/api/admin/workspaces/${workspace.id}`,
      { method: "DELETE", headers: createAuthenticatedGetRequest(
        `/api/admin/workspaces/${workspace.id}`,
        superAdminUser
      ).headers }
    );
    const { DELETE } = await import(
      "@/app/api/admin/workspaces/[id]/route"
    );
    const response = await DELETE(request, {
      params: Promise.resolve({ id: workspace.id }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(deleteWorkspaceByIdSpy).toHaveBeenCalledWith(workspace.id);
    
    deleteWorkspaceByIdSpy.mockRestore();
  });

  it("confirms deleteWorkspaceById is called (not deleteWorkspaceBySlug)", async () => {
    const deleteWorkspaceByIdSpy = vi.spyOn(workspaceService, "deleteWorkspaceById");
    const deleteWorkspaceBySlugSpy = vi.spyOn(workspaceService, "deleteWorkspaceBySlug");
    
    const request = new Request(
      `http://localhost/api/admin/workspaces/${workspace.id}`,
      { method: "DELETE", headers: createAuthenticatedGetRequest(
        `/api/admin/workspaces/${workspace.id}`,
        superAdminUser
      ).headers }
    );
    const { DELETE } = await import(
      "@/app/api/admin/workspaces/[id]/route"
    );
    await DELETE(request, {
      params: Promise.resolve({ id: workspace.id }),
    });

    expect(deleteWorkspaceByIdSpy).toHaveBeenCalledWith(workspace.id);
    expect(deleteWorkspaceBySlugSpy).not.toHaveBeenCalled();
    
    deleteWorkspaceByIdSpy.mockRestore();
    deleteWorkspaceBySlugSpy.mockRestore();
  });
});
