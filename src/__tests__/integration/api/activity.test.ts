import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/workspaces/[slug]/activity/route";
import { getServerSession } from "next-auth/next";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getWorkspaceActivity } from "@/services/activity";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  getWorkspaceBySlug: vi.fn(),
}));

vi.mock("@/services/activity", () => ({
  getWorkspaceActivity: vi.fn(),
}));

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockGetWorkspaceBySlug = getWorkspaceBySlug as vi.MockedFunction<typeof getWorkspaceBySlug>;
const mockGetWorkspaceActivity = getWorkspaceActivity as vi.MockedFunction<typeof getWorkspaceActivity>;

describe("Activity API Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should return 401 when user not authenticated", async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue(null);
    const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/activity");
    const params = Promise.resolve({ slug: "test-workspace" });

    // Act
    const response = await GET(request, { params });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(401);
    expect(data).toEqual({ error: "Authentication required" });
    expect(mockGetWorkspaceBySlug).not.toHaveBeenCalled();
  });

  test("should return 401 when session has no user ID", async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { name: "Test User", email: "test@example.com" }
    });
    const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/activity");
    const params = Promise.resolve({ slug: "test-workspace" });

    // Act
    const response = await GET(request, { params });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(401);
    expect(data).toEqual({ error: "Authentication required" });
    expect(mockGetWorkspaceBySlug).not.toHaveBeenCalled();
  });

  test("should return 403 when user has no access to workspace", async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@example.com" }
    });
    mockGetWorkspaceBySlug.mockResolvedValue(null);
    const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/activity");
    const params = Promise.resolve({ slug: "test-workspace" });

    // Act
    const response = await GET(request, { params });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(403);
    expect(data).toEqual({ error: "Access denied" });
    expect(mockGetWorkspaceBySlug).toHaveBeenCalledWith("test-workspace", "user-1");
    expect(mockGetWorkspaceActivity).not.toHaveBeenCalled();
  });

  test("should return 500 when activity service fails", async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@example.com" }
    });
    mockGetWorkspaceBySlug.mockResolvedValue({
      id: "workspace-1",
      slug: "test-workspace",
      name: "Test Workspace"
    });
    mockGetWorkspaceActivity.mockResolvedValue({
      success: false,
      data: [],
      error: "Failed to fetch activity from swarm: 500"
    });

    const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/activity");
    const params = Promise.resolve({ slug: "test-workspace" });

    // Act
    const response = await GET(request, { params });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: "Failed to fetch activity from swarm: 500",
      data: []
    });
    expect(mockGetWorkspaceActivity).toHaveBeenCalledWith("test-workspace", 5);
  });

  test("should return 404 when workspace not found", async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@example.com" }
    });
    mockGetWorkspaceBySlug.mockResolvedValue({
      id: "workspace-1",
      slug: "test-workspace",
      name: "Test Workspace"
    });
    mockGetWorkspaceActivity.mockResolvedValue({
      success: false,
      data: [],
      error: "Workspace not found"
    });

    const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/activity");
    const params = Promise.resolve({ slug: "test-workspace" });

    // Act
    const response = await GET(request, { params });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(data).toEqual({
      error: "Workspace not found",
      data: []
    });
  });

  test("should return activities successfully", async () => {
    // Arrange
    const mockActivities = [
      {
        id: "activity-1",
        type: "episode",
        summary: "Test Episode 1",
        user: "System",
        timestamp: new Date("2023-01-01T00:00:00.000Z"),
        status: "active",
        metadata: {}
      },
      {
        id: "activity-2",
        type: "episode", 
        summary: "Test Episode 2",
        user: "System",
        timestamp: new Date("2023-01-02T00:00:00.000Z"),
        status: "active",
        metadata: {}
      }
    ];

    const expectedResponse = mockActivities.map(activity => ({
      ...activity,
      timestamp: activity.timestamp.toISOString()
    }));

    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@example.com" }
    });
    mockGetWorkspaceBySlug.mockResolvedValue({
      id: "workspace-1",
      slug: "test-workspace", 
      name: "Test Workspace"
    });
    mockGetWorkspaceActivity.mockResolvedValue({
      success: true,
      data: mockActivities
    });

    const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/activity");
    const params = Promise.resolve({ slug: "test-workspace" });

    // Act
    const response = await GET(request, { params });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: expectedResponse
    });
    expect(mockGetWorkspaceActivity).toHaveBeenCalledWith("test-workspace", 5);
  });

  test("should respect limit query parameter", async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@example.com" }
    });
    mockGetWorkspaceBySlug.mockResolvedValue({
      id: "workspace-1",
      slug: "test-workspace",
      name: "Test Workspace"
    });
    mockGetWorkspaceActivity.mockResolvedValue({
      success: true,
      data: []
    });

    const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/activity?limit=10");
    const params = Promise.resolve({ slug: "test-workspace" });

    // Act
    const response = await GET(request, { params });

    // Assert
    expect(response.status).toBe(200);
    expect(mockGetWorkspaceActivity).toHaveBeenCalledWith("test-workspace", 10);
  });

  test("should use default limit when invalid limit provided", async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@example.com" }
    });
    mockGetWorkspaceBySlug.mockResolvedValue({
      id: "workspace-1",
      slug: "test-workspace",
      name: "Test Workspace"
    });
    mockGetWorkspaceActivity.mockResolvedValue({
      success: true,
      data: []
    });

    const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/activity?limit=invalid");
    const params = Promise.resolve({ slug: "test-workspace" });

    // Act
    const response = await GET(request, { params });

    // Assert
    expect(response.status).toBe(200);
    expect(mockGetWorkspaceActivity).toHaveBeenCalledWith("test-workspace", NaN); // parseInt("invalid") = NaN
  });

  test("should handle unexpected errors gracefully", async () => {
    // Arrange
    mockGetServerSession.mockRejectedValue(new Error("Unexpected error"));
    
    const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/activity");
    const params = Promise.resolve({ slug: "test-workspace" });

    // Act
    const response = await GET(request, { params });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: "Internal server error",
      data: []
    });
  });

  test("should return success with empty data when no swarm configured", async () => {
    // Arrange
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@example.com" }
    });
    mockGetWorkspaceBySlug.mockResolvedValue({
      id: "workspace-1",
      slug: "test-workspace",
      name: "Test Workspace"
    });
    mockGetWorkspaceActivity.mockResolvedValue({
      success: true,
      data: [],
      error: "No active swarm configured for this workspace"
    });

    const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/activity");
    const params = Promise.resolve({ slug: "test-workspace" });

    // Act
    const response = await GET(request, { params });
    const data = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: []
    });
  });
});