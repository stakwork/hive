import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/lib/env";

// Mock external dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://mock-pool-manager.com",
  },
}));

// Mock fetch for external API calls
global.fetch = vi.fn();

describe("POST /api/pool-manager/claim-pod/[workspaceId]", () => {
  let testUser: any;
  let testWorkspace: any;
  let testSwarm: any;
  let encryptionService: EncryptionService;

  beforeAll(async () => {
    encryptionService = EncryptionService.getInstance();
  });

  beforeEach(async () => {
    // Clean up existing test data
    await db.swarm.deleteMany({
      where: { name: { contains: "test-integration" } },
    });
    await db.workspace.deleteMany({
      where: { name: { contains: "Test Integration" } },
    });
    await db.user.deleteMany({
      where: { email: { contains: "test-integration" } },
    });

    // Create test user
    testUser = await db.user.create({
      data: {
        email: "test-integration@example.com",
        name: "Test Integration User",
      },
    });

    // Create test workspace with swarm
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Integration Workspace",
        description: "Test workspace for integration testing",
        slug: "test-integration-workspace",
        ownerId: testUser.id,
        stakworkApiKey: "test-api-key",
        swarm: {
          create: {
            swarmId: "test-swarm-123",
            name: "test-integration-swarm",
            status: "ACTIVE",
            instanceType: "XL",
            repositoryName: "test-repo",
            repositoryUrl: "https://github.com/test/repo",
            defaultBranch: "main",
            poolName: "test-pool",
            poolApiKey: JSON.stringify(
              encryptionService.encryptField("poolApiKey", "test-pool-api-key")
            ),
            swarmApiKey: "test-swarm-api-key",
            environmentVariables: [],
            services: [],
            wizardStep: "COMPLETION",
            stepStatus: "COMPLETED",
            wizardData: {},
          },
        },
      },
      include: {
        swarm: true,
      },
    });

    testSwarm = testWorkspace.swarm;

    // Reset mocks
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Clean up test data
    await db.swarm.deleteMany({
      where: { name: { contains: "test-integration" } },
    });
    await db.workspace.deleteMany({
      where: { name: { contains: "Test Integration" } },
    });
    await db.user.deleteMany({
      where: { email: { contains: "test-integration" } },
    });
  });

  describe("Authentication and Authorization", () => {
    test("should return 401 when user is not authenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: testWorkspace.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 when user session is invalid", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: undefined },
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: testWorkspace.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });

    test("should return 403 when user does not have access to workspace", async () => {
      // Create another user without access
      const otherUser = await db.user.create({
        data: {
          email: "other-test@example.com",
          name: "Other Test User",
        },
      });

      (getServerSession as any).mockResolvedValue({
        user: { id: otherUser.id },
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: testWorkspace.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");

      // Clean up
      await db.user.delete({ where: { id: otherUser.id } });
    });
  });

  describe("Workspace Validation", () => {
    test("should return 400 when workspaceId is missing", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id },
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: "" });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required field: workspaceId");
    });

    test("should return 404 when workspace does not exist", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id },
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: "non-existent-workspace-id" });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
    });

    test("should return 404 when workspace has no swarm", async () => {
      // Create workspace without swarm
      const workspaceWithoutSwarm = await db.workspace.create({
        data: {
          name: "Workspace Without Swarm",
          description: "Test workspace without swarm",
          slug: "workspace-without-swarm",
          ownerId: testUser.id,
          stakworkApiKey: "test-api-key-2",
        },
      });

      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id },
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: workspaceWithoutSwarm.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("No swarm found for this workspace");

      // Clean up
      await db.workspace.delete({ where: { id: workspaceWithoutSwarm.id } });
    });

    test("should return 400 when swarm is not properly configured", async () => {
      // Update swarm to remove pool configuration
      await db.swarm.update({
        where: { id: testSwarm.id },
        data: { poolName: null, poolApiKey: null },
      });

      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id },
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: testWorkspace.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Swarm not properly configured with pool information");
    });
  });

  describe("External API Integration", () => {
    test("should successfully claim pod and return frontend URL", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id },
      });

      // Mock successful Pool Manager API response
      const mockPoolManagerResponse = {
        success: true,
        workspace: {
          id: "pod-workspace-123",
          fqdn: "test-pod.example.com",
          url: "https://test-pod.example.com",
          portMappings: {
            "3000": "https://frontend.example.com",
            "15552": "https://internal1.example.com",
            "15553": "https://internal2.example.com",
          },
          branches: ["main"],
          created: "2024-01-01T00:00:00Z",
          customImage: false,
          flagged_for_recreation: false,
          image: "node:18",
          marked_at: "2024-01-01T00:00:00Z",
          password: "secure-password",
          primaryRepo: "test/repo",
          repoName: "test-repo",
          repositories: ["test/repo"],
          state: "running",
          subdomain: "test-pod",
          usage_status: "active",
          useDevContainer: false,
        },
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPoolManagerResponse),
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: testWorkspace.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod claimed successfully");
      expect(data.frontend).toBe("https://frontend.example.com");

      // Verify external API was called correctly
      expect(global.fetch).toHaveBeenCalledWith(
        `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent("test-pool")}/workspace`,
        {
          method: "GET",
          headers: {
            Authorization: "Bearer test-pool-api-key",
            "Content-Type": "application/json",
          },
        }
      );
    });

    test("should handle single port mapping correctly", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id },
      });

      // Mock Pool Manager response with single port mapping
      const mockPoolManagerResponse = {
        success: true,
        workspace: {
          id: "pod-workspace-123",
          portMappings: {
            "8080": "https://single-frontend.example.com",
          },
          // ... other required fields
          fqdn: "test-pod.example.com",
          url: "https://test-pod.example.com",
          branches: ["main"],
          created: "2024-01-01T00:00:00Z",
          customImage: false,
          flagged_for_recreation: false,
          image: "node:18",
          marked_at: "2024-01-01T00:00:00Z",
          password: "secure-password",
          primaryRepo: "test/repo",
          repoName: "test-repo",
          repositories: ["test/repo"],
          state: "running",
          subdomain: "test-pod",
          usage_status: "active",
          useDevContainer: false,
        },
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPoolManagerResponse),
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: testWorkspace.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.frontend).toBe("https://single-frontend.example.com");
    });

    test("should return 500 when Pool Manager API fails", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id },
      });

      // Mock failed Pool Manager API response
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: testWorkspace.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to claim pod");
    });

    test("should return 500 when no frontend URL is found", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id },
      });

      // Mock Pool Manager response with no suitable port mappings
      const mockPoolManagerResponse = {
        success: true,
        workspace: {
          id: "pod-workspace-123",
          portMappings: {
            "15552": "https://internal1.example.com",
            "15553": "https://internal2.example.com",
          },
          // ... other required fields
          fqdn: "test-pod.example.com",
          url: "https://test-pod.example.com",
          branches: ["main"],
          created: "2024-01-01T00:00:00Z",
          customImage: false,
          flagged_for_recreation: false,
          image: "node:18",
          marked_at: "2024-01-01T00:00:00Z",
          password: "secure-password",
          primaryRepo: "test/repo",
          repoName: "test-repo",
          repositories: ["test/repo"],
          state: "running",
          subdomain: "test-pod",
          usage_status: "active",
          useDevContainer: false,
        },
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPoolManagerResponse),
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: testWorkspace.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to claim pod");
    });
  });

  describe("Workspace Member Access", () => {
    test("should allow workspace member to claim pod", async () => {
      // Create another user and add them as workspace member
      const memberUser = await db.user.create({
        data: {
          email: "member-test@example.com",
          name: "Member Test User",
        },
      });

      await db.workspaceMember.create({
        data: {
          userId: memberUser.id,
          workspaceId: testWorkspace.id,
          role: "DEVELOPER",
        },
      });

      (getServerSession as any).mockResolvedValue({
        user: { id: memberUser.id },
      });

      // Mock successful Pool Manager API response
      const mockPoolManagerResponse = {
        success: true,
        workspace: {
          id: "pod-workspace-123",
          portMappings: {
            "3000": "https://frontend.example.com",
          },
          // ... other required fields
          fqdn: "test-pod.example.com",
          url: "https://test-pod.example.com",
          branches: ["main"],
          created: "2024-01-01T00:00:00Z",
          customImage: false,
          flagged_for_recreation: false,
          image: "node:18",
          marked_at: "2024-01-01T00:00:00Z",
          password: "secure-password",
          primaryRepo: "test/repo",
          repoName: "test-repo",
          repositories: ["test/repo"],
          state: "running",
          subdomain: "test-pod",
          usage_status: "active",
          useDevContainer: false,
        },
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPoolManagerResponse),
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: testWorkspace.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.frontend).toBe("https://frontend.example.com");

      // Clean up
      await db.workspaceMember.deleteMany({
        where: { userId: memberUser.id },
      });
      await db.user.delete({ where: { id: memberUser.id } });
    });
  });

  describe("Error Handling", () => {
    test("should handle network errors gracefully", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id },
      });

      // Mock network error
      (global.fetch as any).mockRejectedValue(new Error("Network error"));

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: testWorkspace.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to claim pod");
    });

    test("should handle invalid JSON response from Pool Manager API", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id },
      });

      // Mock invalid JSON response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/workspace-id", {
        method: "POST",
      });

      const params = Promise.resolve({ workspaceId: testWorkspace.id });
      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to claim pod");
    });
  });
});