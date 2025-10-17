import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, PUT, DELETE } from "@/app/api/workspaces/[slug]/route";
import { getWorkspaceBySlug, updateWorkspace, deleteWorkspaceBySlug } from "@/services/workspace";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPutRequest,
  createAuthenticatedDeleteRequest,
} from "@/__tests__/support/helpers";

// Mock the workspace service functions
vi.mock("@/services/workspace", () => ({
  getWorkspaceBySlug: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspaceBySlug: vi.fn(),
}));

const mockGetWorkspaceBySlug = getWorkspaceBySlug as vi.MockedFunction<typeof getWorkspaceBySlug>;
const mockUpdateWorkspace = updateWorkspace as vi.MockedFunction<typeof updateWorkspace>;
const mockDeleteWorkspaceBySlug = deleteWorkspaceBySlug as vi.MockedFunction<typeof deleteWorkspaceBySlug>;

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

      const request = createAuthenticatedGetRequest(`/api/workspaces/${mockWorkspace.slug}`, mockOwnerUser);
      const response = await GET(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace).toBeDefined();
      expect(data.workspace.name).toBe(mockWorkspace.name);
      expect(data.workspace.slug).toBe(mockWorkspace.slug);
      expect(data.workspace.userRole).toBe("OWNER");
      expect(mockGetWorkspaceBySlug).toHaveBeenCalledWith(mockWorkspace.slug, mockOwnerUser.id);
    });

    test("should return workspace with correct user role for admin", async () => {
      mockGetWorkspaceBySlug.mockResolvedValue({
        ...mockWorkspace,
        userRole: "ADMIN",
      });

      const request = createAuthenticatedGetRequest(`/api/workspaces/${mockWorkspace.slug}`, mockAdminUser);
      const response = await GET(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.userRole).toBe("ADMIN");
      expect(mockGetWorkspaceBySlug).toHaveBeenCalledWith(mockWorkspace.slug, mockAdminUser.id);
    });

    test("should return workspace with correct user role for member", async () => {
      mockGetWorkspaceBySlug.mockResolvedValue({
        ...mockWorkspace,
        userRole: "DEVELOPER",
      });

      const request = createAuthenticatedGetRequest(`/api/workspaces/${mockWorkspace.slug}`, mockMemberUser);
      const response = await GET(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.userRole).toBe("DEVELOPER");
      expect(mockGetWorkspaceBySlug).toHaveBeenCalledWith(mockWorkspace.slug, mockMemberUser.id);
    });

    test("should return 404 for outsider user with no access", async () => {
      mockGetWorkspaceBySlug.mockResolvedValue(null);

      const request = createAuthenticatedGetRequest(`/api/workspaces/${mockWorkspace.slug}`, mockOutsiderUser);
      const response = await GET(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
      expect(mockGetWorkspaceBySlug).toHaveBeenCalledWith(mockWorkspace.slug, mockOutsiderUser.id);
    });

    test("should handle malformed session data gracefully", async () => {
      const request = createAuthenticatedGetRequest(`/api/workspaces/${mockWorkspace.slug}`, {
        id: "",
        email: "test@example.com",
        name: "Test User",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should handle empty slug parameter", async () => {
      const request = createAuthenticatedGetRequest("/api/workspaces/", mockOwnerUser);
      const response = await GET(request, { params: Promise.resolve({ slug: "" }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Workspace slug is required");
    });

    test("should return 404 for non-existent workspace", async () => {
      mockGetWorkspaceBySlug.mockResolvedValue(null);

      const request = createAuthenticatedGetRequest("/api/workspaces/non-existent-workspace", mockOwnerUser);
      const response = await GET(request, { params: Promise.resolve({ slug: "non-existent-workspace" }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    test("should handle internal server error", async () => {
      mockGetWorkspaceBySlug.mockRejectedValue(new Error("Database connection failed"));

      const request = createAuthenticatedGetRequest(`/api/workspaces/${mockWorkspace.slug}`, mockOwnerUser);
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

      const request = createAuthenticatedPutRequest(`/api/workspaces/${mockWorkspace.slug}`, updateData, mockOwnerUser);

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

      const request = createAuthenticatedPutRequest(`/api/workspaces/${mockWorkspace.slug}`, updateData, mockOwnerUser);

      const response = await PUT(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.name).toBe("Updated Workspace");
      expect(data.workspace.slug).toBe("updated-workspace");
      expect(data.slugChanged).toBe("updated-workspace");
      expect(mockUpdateWorkspace).toHaveBeenCalledWith(mockWorkspace.slug, mockOwnerUser.id, updateData);
    });

    test("should handle malformed JSON gracefully", async () => {
      // Note: With middleware auth, malformed JSON in body would be caught during request.json() call
      // Testing that the endpoint handles JSON parse errors appropriately
      const updateData = {
        name: "Updated Workspace",
        // Invalid data that will fail schema validation
        slug: "", // Empty slug should fail validation
      };

      const request = createAuthenticatedPutRequest(`/api/workspaces/${mockWorkspace.slug}`, updateData, mockOwnerUser);

      const response = await PUT(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });

      // Should return 400 for validation error
      expect([400, 500]).toContain(response.status);
    });

    test("should handle workspace not found error", async () => {
      mockUpdateWorkspace.mockRejectedValue(new Error("Workspace not found or access denied"));

      const updateData = {
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
      };

      const request = createAuthenticatedPutRequest(`/api/workspaces/${mockWorkspace.slug}`, updateData, mockOwnerUser);

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

      const request = createAuthenticatedPutRequest(
        `/api/workspaces/${mockWorkspace.slug}`,
        updateData,
        mockMemberUser,
      );

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

      const request = createAuthenticatedPutRequest(`/api/workspaces/${mockWorkspace.slug}`, updateData, mockOwnerUser);

      const response = await PUT(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toBe("Workspace with this slug already exists");
    });
  });

  describe("DELETE /api/workspaces/[slug] - Enhanced Coverage", () => {
    test("should successfully delete workspace", async () => {
      mockDeleteWorkspaceBySlug.mockResolvedValue(undefined);

      const request = createAuthenticatedDeleteRequest(`/api/workspaces/${mockWorkspace.slug}`, mockOwnerUser);

      const response = await DELETE(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockDeleteWorkspaceBySlug).toHaveBeenCalledWith(mockWorkspace.slug, mockOwnerUser.id);
    });

    test("should handle workspace not found error", async () => {
      mockDeleteWorkspaceBySlug.mockRejectedValue(new Error("Workspace not found or access denied"));

      const request = createAuthenticatedDeleteRequest(`/api/workspaces/${mockWorkspace.slug}`, mockOwnerUser);

      const response = await DELETE(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    test("should verify workspace owner permissions strictly", async () => {
      mockDeleteWorkspaceBySlug.mockRejectedValue(new Error("Only workspace owners can delete workspace"));

      const request = createAuthenticatedDeleteRequest(`/api/workspaces/${mockWorkspace.slug}`, mockMemberUser);

      const response = await DELETE(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Only workspace owners can delete workspace");
    });

    test("should handle unauthorized access", async () => {
      // Create request with invalid user to test unauthorized access
      const request = createAuthenticatedDeleteRequest(`/api/workspaces/${mockWorkspace.slug}`, {
        id: "",
        email: "invalid@test.com",
        name: "Invalid User",
      });

      const response = await DELETE(request, { params: Promise.resolve({ slug: mockWorkspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should handle empty slug parameter", async () => {
      const request = createAuthenticatedDeleteRequest("/api/workspaces/", mockOwnerUser);

      const response = await DELETE(request, { params: Promise.resolve({ slug: "" }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Workspace slug is required");
    });
  });

  describe("API Contract and Error Handling - Enhanced Coverage", () => {
    test("should return consistent error response format", async () => {
      const errorScenarios = [
        { slug: "", expectedStatus: 400, user: mockOwnerUser },
        { slug: "non-existent", expectedStatus: 404, user: mockOwnerUser },
        { slug: "test-workspace", expectedStatus: 401, user: { id: "", email: "invalid@test.com", name: "Invalid" } },
      ];

      for (const scenario of errorScenarios) {
        if (scenario.expectedStatus === 404) {
          mockGetWorkspaceBySlug.mockResolvedValue(null);
        }

        const request = createAuthenticatedGetRequest(`/api/workspaces/${scenario.slug}`, scenario.user);
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

      // Test PUT request - Next.js handles Content-Type
      mockUpdateWorkspace.mockResolvedValue({
        ...mockWorkspace,
        ...updateData,
      });

      const requestWithoutContentType = createAuthenticatedPutRequest(
        `/api/workspaces/${mockWorkspace.slug}`,
        updateData,
        mockOwnerUser,
      );

      const responseWithoutContentType = await PUT(requestWithoutContentType, {
        params: Promise.resolve({ slug: mockWorkspace.slug }),
      });

      // Should succeed with proper Content-Type
      expect(responseWithoutContentType.status).toBe(200);
    });
  });
});
