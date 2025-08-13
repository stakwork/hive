import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { PUT } from "@/app/api/workspaces/[slug]/route";
import { updateWorkspace } from "@/services/workspace";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  updateWorkspace: vi.fn(),
}));

vi.mock("@/lib/schemas/workspace", () => ({
  updateWorkspaceSchema: {
    parse: vi.fn(),
  },
}));

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockUpdateWorkspace = updateWorkspace as vi.MockedFunction<typeof updateWorkspace>;

// Import the schema mock after mocking the module
import { updateWorkspaceSchema } from "@/lib/schemas/workspace";
const mockUpdateWorkspaceSchema = updateWorkspaceSchema as { parse: vi.MockedFunction<any> };

describe("Workspace Update API Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PUT /api/workspaces/[slug]", () => {
    test("should return 401 when user not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const requestBody = {
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
      };

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace", {
        method: "PUT",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 400 when slug is missing", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", name: "Test User", email: "test@example.com" },
      });

      const requestBody = {
        name: "Updated Workspace",
        slug: "updated-workspace", 
        description: "Updated description",
      };

      const request = new NextRequest("http://localhost:3000/api/workspaces/", {
        method: "PUT",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });
      const params = Promise.resolve({ slug: "" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Workspace slug is required");
    });

    test("should return 400 when validation fails", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", name: "Test User", email: "test@example.com" },
      });

      const requestBody = {
        name: "", // invalid name
        slug: "updated-workspace",
        description: "Updated description",
      };

      const validationError = {
        issues: [{ message: "Workspace name is required" }],
      };

      mockUpdateWorkspaceSchema.parse.mockImplementation(() => {
        throw validationError;
      });

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace", {
        method: "PUT",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Validation failed");
      expect(data.details).toEqual(validationError.issues);
    });

    test("should successfully update workspace", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", name: "Test User", email: "test@example.com" },
      });

      const requestBody = {
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
      };

      const updatedWorkspace = {
        id: "workspace1",
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
        ownerId: "user1",
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-02T00:00:00.000Z",
      };

      mockUpdateWorkspaceSchema.parse.mockReturnValue(requestBody);
      mockUpdateWorkspace.mockResolvedValue(updatedWorkspace);

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace", {
        method: "PUT",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace).toEqual(updatedWorkspace);
      expect(data.slugChanged).toBe("updated-workspace"); // slug changed
      expect(mockUpdateWorkspace).toHaveBeenCalledWith("test-workspace", "user1", requestBody);
    });

    test("should return slugChanged as null when slug doesn't change", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", name: "Test User", email: "test@example.com" },
      });

      const requestBody = {
        name: "Updated Workspace",
        slug: "test-workspace", // same slug
        description: "Updated description",
      };

      const updatedWorkspace = {
        id: "workspace1",
        name: "Updated Workspace",
        slug: "test-workspace",
        description: "Updated description",
        ownerId: "user1",
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-02T00:00:00.000Z",
      };

      mockUpdateWorkspaceSchema.parse.mockReturnValue(requestBody);
      mockUpdateWorkspace.mockResolvedValue(updatedWorkspace);

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace", {
        method: "PUT",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace).toEqual(updatedWorkspace);
      expect(data.slugChanged).toBe(null); // no slug change
    });

    test("should return 404 when workspace not found", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", name: "Test User", email: "test@example.com" },
      });

      const requestBody = {
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
      };

      mockUpdateWorkspaceSchema.parse.mockReturnValue(requestBody);
      mockUpdateWorkspace.mockRejectedValue(new Error("Workspace not found or access denied"));

      const request = new NextRequest("http://localhost:3000/api/workspaces/nonexistent", {
        method: "PUT",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });
      const params = Promise.resolve({ slug: "nonexistent" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    test("should return 403 when user lacks permissions", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", name: "Test User", email: "test@example.com" },
      });

      const requestBody = {
        name: "Updated Workspace", 
        slug: "updated-workspace",
        description: "Updated description",
      };

      mockUpdateWorkspaceSchema.parse.mockReturnValue(requestBody);
      mockUpdateWorkspace.mockRejectedValue(new Error("Only workspace owners and admins can update workspace settings"));

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace", {
        method: "PUT",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Only workspace owners and admins can update workspace settings");
    });

    test("should return 409 when slug already exists", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", name: "Test User", email: "test@example.com" },
      });

      const requestBody = {
        name: "Updated Workspace",
        slug: "existing-slug",
        description: "Updated description",
      };

      mockUpdateWorkspaceSchema.parse.mockReturnValue(requestBody);
      mockUpdateWorkspace.mockRejectedValue(new Error("A workspace with this name already exists. Please choose a different name."));

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace", {
        method: "PUT",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toBe("A workspace with this name already exists. Please choose a different name.");
    });

    test("should return 500 for unexpected errors", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", name: "Test User", email: "test@example.com" },
      });

      const requestBody = {
        name: "Updated Workspace",
        slug: "updated-workspace", 
        description: "Updated description",
      };

      mockUpdateWorkspaceSchema.parse.mockReturnValue(requestBody);
      mockUpdateWorkspace.mockRejectedValue(new Error("Unexpected database error"));

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace", {
        method: "PUT",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Unexpected database error");
    });

    test("should handle malformed JSON request body", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", name: "Test User", email: "test@example.com" },
      });

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace", {
        method: "PUT",
        body: "invalid json",
        headers: { "Content-Type": "application/json" },
      });
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Unexpected token");
    });
  });
});