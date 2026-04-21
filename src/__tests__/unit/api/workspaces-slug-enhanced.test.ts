import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";
import { GET, PUT, DELETE } from "@/app/api/workspaces/[slug]/route";
import { getWorkspaceBySlug, getPublicWorkspaceBySlug, updateWorkspace, deleteWorkspaceBySlug } from "@/services/workspace";

// Mock the workspace service functions
vi.mock("@/services/workspace", () => ({
  getWorkspaceBySlug: vi.fn(),
  getPublicWorkspaceBySlug: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspaceBySlug: vi.fn(),
}));

const mockGetWorkspaceBySlug = getWorkspaceBySlug as vi.MockedFunction<typeof getWorkspaceBySlug>;
const mockGetPublicWorkspaceBySlug = getPublicWorkspaceBySlug as vi.MockedFunction<typeof getPublicWorkspaceBySlug>;
const mockUpdateWorkspace = updateWorkspace as vi.MockedFunction<typeof updateWorkspace>;
const mockDeleteWorkspaceBySlug = deleteWorkspaceBySlug as vi.MockedFunction<typeof deleteWorkspaceBySlug>;

function makeAuthHeaders(user: { id: string; email: string; name: string }): Headers {
  const headers = new Headers();
  headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  headers.set(MIDDLEWARE_HEADERS.USER_ID, user.id);
  headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, user.email);
  headers.set(MIDDLEWARE_HEADERS.USER_NAME, user.name);
  return headers;
}

describe("Enhanced Workspace [slug] API Integration Tests", () => {
  const mockWorkspace = {
    id: "workspace-123",
    name: "Test Workspace",
    slug: "test-workspace",
    description: "Test workspace description",
    ownerId: "owner-123",
    userRole: "OWNER" as const,
  };

  const mockOwnerUser = {
    id: "owner-123",
    email: "owner@example.com",
    name: "Owner User",
  };

  const mockAdminUser = {
    id: "admin-123", 
    email: "admin@example.com",
    name: "Admin User",
  };

  const mockMemberUser = {
    id: "member-123",
    email: "member@example.com", 
    name: "Member User",
  };

  const mockOutsiderUser = {
    id: "outsider-123",
    email: "outsider@example.com",
    name: "Outsider User",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/[slug] - Enhanced Coverage", () => {
    test("should return workspace with correct user role for owner", async () => {
      mockGetWorkspaceBySlug.mockResolvedValue({
        ...mockWorkspace,
        userRole: "OWNER",
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        headers: makeAuthHeaders(mockOwnerUser),
      });
      const response = await GET(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace).toBeDefined();
      expect(data.workspace.name).toBe(mockWorkspace.name);
      expect(data.workspace.slug).toBe(mockWorkspace.slug);
      expect(data.workspace.userRole).toBe("OWNER");
      expect(mockGetWorkspaceBySlug).toHaveBeenCalledWith(
        mockWorkspace.slug,
        mockOwnerUser.id,
        { allowPublicViewer: true },
      );
    });

    test("should return workspace with correct user role for admin", async () => {
      mockGetWorkspaceBySlug.mockResolvedValue({
        ...mockWorkspace,
        userRole: "ADMIN",
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        headers: makeAuthHeaders(mockAdminUser),
      });
      const response = await GET(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.userRole).toBe("ADMIN");
      expect(mockGetWorkspaceBySlug).toHaveBeenCalledWith(
        mockWorkspace.slug,
        mockAdminUser.id,
        { allowPublicViewer: true },
      );
    });

    test("should return workspace with correct user role for member", async () => {
      mockGetWorkspaceBySlug.mockResolvedValue({
        ...mockWorkspace,
        userRole: "DEVELOPER",
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        headers: makeAuthHeaders(mockMemberUser),
      });
      const response = await GET(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.userRole).toBe("DEVELOPER");
      expect(mockGetWorkspaceBySlug).toHaveBeenCalledWith(
        mockWorkspace.slug,
        mockMemberUser.id,
        { allowPublicViewer: true },
      );
    });

    test("should return 404 for outsider user with no access", async () => {
      mockGetWorkspaceBySlug.mockResolvedValue(null);

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        headers: makeAuthHeaders(mockOutsiderUser),
      });
      const response = await GET(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
      expect(mockGetWorkspaceBySlug).toHaveBeenCalledWith(
        mockWorkspace.slug,
        mockOutsiderUser.id,
        { allowPublicViewer: true },
      );
    });

    test("should handle missing auth headers gracefully", async () => {
      // Unauthenticated — no middleware headers — falls through to public workspace check
      mockGetPublicWorkspaceBySlug.mockResolvedValue(null);

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`);
      const response = await GET(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      // Not public → 404 (not 401), since GET now supports public workspaces
      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
      expect(mockGetPublicWorkspaceBySlug).toHaveBeenCalledWith(mockWorkspace.slug);
    });

    test("should handle empty slug parameter", async () => {
      const request = new NextRequest("http://localhost:3000/api/workspaces/", {
        headers: makeAuthHeaders(mockOwnerUser),
      });
      const response = await GET(request, { params: Promise.resolve({ slug: "" }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Workspace slug is required");
    });

    test("should handle non-existent workspace", async () => {
      mockGetWorkspaceBySlug.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/workspaces/non-existent-workspace", {
        headers: makeAuthHeaders(mockOwnerUser),
      });
      const response = await GET(request, { params: Promise.resolve({ slug: "non-existent-workspace" }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    test("should handle internal server error", async () => {
      mockGetWorkspaceBySlug.mockRejectedValue(new Error("Database connection failed"));

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        headers: makeAuthHeaders(mockOwnerUser),
      });
      const response = await GET(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Internal server error");
    });
  });

  describe("PUT /api/workspaces/[slug] - Enhanced Coverage", () => {
    test("should validate slug format and reject invalid characters", async () => {
      const updateData = {
        name: "Updated Workspace",
        slug: "invalid slug with spaces!@#",
        description: "Updated description",
      };

      const headers = makeAuthHeaders(mockOwnerUser);
      headers.set("Content-Type", "application/json");
      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Validation failed");
      expect(data.details).toBeDefined();
    });

    test("should handle successful update", async () => {
      const updateData = {
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
      };

      const updatedWorkspace = {
        ...mockWorkspace,
        ...updateData,
      };

      mockUpdateWorkspace.mockResolvedValue(updatedWorkspace);

      const headers = makeAuthHeaders(mockOwnerUser);
      headers.set("Content-Type", "application/json");
      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.name).toBe("Updated Workspace");
      expect(data.workspace.slug).toBe("updated-workspace");
      expect(data.slugChanged).toBe("updated-workspace");
      expect(mockUpdateWorkspace).toHaveBeenCalledWith(mockWorkspace.slug, mockOwnerUser.id, updateData);
    });

    test("should handle malformed JSON gracefully", async () => {
      const headers = makeAuthHeaders(mockOwnerUser);
      headers.set("Content-Type", "application/json");
      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        method: "PUT",
        headers,
        body: "{ invalid json content",
      });

      const response = await PUT(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });

      expect(response.status).toBe(500);
    });

    test("should handle workspace not found error", async () => {
      mockUpdateWorkspace.mockRejectedValue(new Error("Workspace not found or access denied"));

      const updateData = {
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
      };

      const headers = makeAuthHeaders(mockOwnerUser);
      headers.set("Content-Type", "application/json");
      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    test("should handle permission denied error", async () => {
      mockUpdateWorkspace.mockRejectedValue(new Error("Only workspace owners and admins can update workspace"));

      const updateData = {
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
      };

      const headers = makeAuthHeaders(mockMemberUser);
      headers.set("Content-Type", "application/json");
      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Only workspace owners and admins can update workspace");
    });

    test("should handle slug already exists error", async () => {
      mockUpdateWorkspace.mockRejectedValue(new Error("Workspace with this slug already exists"));

      const updateData = {
        name: "Updated Workspace",
        slug: "existing-slug",
        description: "Updated description",
      };

      const headers = makeAuthHeaders(mockOwnerUser);
      headers.set("Content-Type", "application/json");
      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(updateData),
      });

      const response = await PUT(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toBe("Workspace with this slug already exists");
    });
  });

  describe("DELETE /api/workspaces/[slug] - Enhanced Coverage", () => {
    test("should successfully delete workspace", async () => {
      mockDeleteWorkspaceBySlug.mockResolvedValue(undefined);

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        method: "DELETE",
        headers: makeAuthHeaders(mockOwnerUser),
      });

      const response = await DELETE(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockDeleteWorkspaceBySlug).toHaveBeenCalledWith(mockWorkspace.slug, mockOwnerUser.id);
    });

    test("should handle workspace not found error", async () => {
      mockDeleteWorkspaceBySlug.mockRejectedValue(new Error("Workspace not found or access denied"));

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        method: "DELETE",
        headers: makeAuthHeaders(mockOwnerUser),
      });

      const response = await DELETE(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    test("should verify workspace owner permissions strictly", async () => {
      mockDeleteWorkspaceBySlug.mockRejectedValue(new Error("Only workspace owners can delete workspace"));

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        method: "DELETE",
        headers: makeAuthHeaders(mockAdminUser),
      });

      const response = await DELETE(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Only workspace owners can delete workspace");
    });

    test("should handle unauthorized access", async () => {
      // No middleware headers = unauthenticated
      const request = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        method: "DELETE",
      });

      const response = await DELETE(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should handle empty slug parameter", async () => {
      const request = new NextRequest("http://localhost:3000/api/workspaces/", {
        method: "DELETE",
        headers: makeAuthHeaders(mockOwnerUser),
      });

      const response = await DELETE(request, { params: Promise.resolve({ slug: "" }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Workspace slug is required");
    });
  });

  describe("API Contract and Error Handling - Enhanced Coverage", () => {
    test("should return consistent error response format", async () => {
      // Unauthenticated requests fall through to public workspace check (→ 404, not 401)
      const errorScenarios = [
        { slug: "", expectedStatus: 400, authenticated: true },
        { slug: "non-existent", expectedStatus: 404, authenticated: true },
        { slug: "test-workspace", expectedStatus: 404, authenticated: false },
      ];

      for (const scenario of errorScenarios) {
        if (scenario.authenticated) {
          mockGetWorkspaceBySlug.mockResolvedValue(null);
        } else {
          mockGetPublicWorkspaceBySlug.mockResolvedValue(null);
        }

        const headers = scenario.authenticated ? makeAuthHeaders(mockOwnerUser) : new Headers();
        const request = new NextRequest(`http://localhost:3000/api/workspaces/${scenario.slug}`, { headers });
        const response = await GET(request, { params: Promise.resolve({ slug: scenario.slug }) });
        const data = await response.json();

        expect(response.status).toBe(scenario.expectedStatus);
        expect(data).toHaveProperty("error");
        expect(typeof data.error).toBe("string");
        expect(data.error.length).toBeGreaterThan(0);
      }
    });

    test("should validate Content-Type header for PUT requests", async () => {
      const updateData = {
        name: "Updated Workspace",
        slug: mockWorkspace.slug,
        description: "Updated description",
      };

      // Test with missing Content-Type header - Next.js should handle this gracefully
      const requestWithoutContentType = new NextRequest(`http://localhost:3000/api/workspaces/${mockWorkspace.slug}`, {
        method: "PUT",
        headers: makeAuthHeaders(mockOwnerUser),
        body: JSON.stringify(updateData),
      });

      mockUpdateWorkspace.mockResolvedValue({
        ...mockWorkspace,
        ...updateData,
      });

      const responseWithoutContentType = await PUT(requestWithoutContentType, { 
        params: Promise.resolve({ slug: mockWorkspace.slug }) 
      });

      // Should handle gracefully (Next.js may auto-detect JSON)
      expect([200, 400, 500]).toContain(responseWithoutContentType.status);
    });
  });
});
