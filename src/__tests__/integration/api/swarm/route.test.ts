import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { POST, PUT } from "@/app/api/swarm/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock fetch for external API calls
global.fetch = vi.fn();

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockFetch = fetch as vi.MockedFunction<typeof fetch>;

describe("Swarm API Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestUserWithWorkspace() {
    return await db.$transaction(async (tx) => {
      // Create test user
      const testUser = await tx.user.create({
        data: {
          id: `test-user-${Date.now()}-${Math.random()}`,
          email: `test-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace
      const testWorkspace = await tx.workspace.create({
        data: {
          id: `test-workspace-${Date.now()}-${Math.random()}`,
          name: "Test Workspace",
          slug: `test-workspace-${Date.now()}`,
          description: "Test workspace for integration tests",
          ownerId: testUser.id,
          stakworkApiKey: "test-stakwork-key",
        },
      });

      // Create repository
      const testRepository = await tx.repository.create({
        data: {
          id: `test-repo-${Date.now()}-${Math.random()}`,
          name: "test-repo",
          repositoryUrl: "https://github.com/test-user/test-repo",
          branch: "main",
          status: "SYNCED",
          workspaceId: testWorkspace.id,
        },
      });

      return { testUser, testWorkspace, testRepository };
    });
  }

  async function createTestUserWithWorkspaceAndSwarm() {
    return await db.$transaction(async (tx) => {
      const { testUser, testWorkspace, testRepository } = await createTestUserWithWorkspace();

      // Create swarm
      const testSwarm = await tx.swarm.create({
        data: {
          id: `test-swarm-${Date.now()}-${Math.random()}`,
          swarmId: `swarm-${Date.now()}`,
          name: "Test Swarm",
          status: "ACTIVE",
          instanceType: "L",
          repositoryName: testRepository.name,
          repositoryUrl: testRepository.repositoryUrl,
          defaultBranch: testRepository.branch,
          swarmApiKey: "test-swarm-api-key",
          environmentVariables: [
            { name: "NODE_ENV", value: "test" },
            { name: "API_URL", value: "http://localhost:3000" },
          ],
          services: [
            {
              name: "web",
              port: 3000,
              env: { NODE_ENV: "test" },
              scripts: { start: "npm start", install: "npm install" },
            },
          ],
          wizardStep: "COMPLETION",
          stepStatus: "COMPLETED",
          workspaceId: testWorkspace.id,
        },
      });

      return { testUser, testWorkspace, testRepository, testSwarm };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("POST /api/swarm", () => {
    test("should create swarm successfully with valid data", async () => {
      const { testUser, testWorkspace, testRepository } = await createTestUserWithWorkspace();

      // Mock session
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock Stakwork API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            swarmId: "new-swarm-123",
            status: "ACTIVE",
          },
        }),
      } as Response);

      const requestBody = {
        name: "New Test Swarm",
        repositoryUrl: testRepository.repositoryUrl,
        instanceType: "L",
        environmentVariables: [
          { name: "NODE_ENV", value: "development" },
          { name: "PORT", value: "3000" },
        ],
        services: [
          {
            name: "web",
            port: 3000,
            env: { NODE_ENV: "development" },
            scripts: { start: "npm run dev", install: "npm install" },
          },
        ],
        workspaceId: testWorkspace.id,
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.swarm).toBeDefined();
      expect(data.swarm.name).toBe("New Test Swarm");
      expect(data.swarm.repositoryUrl).toBe(testRepository.repositoryUrl);
      expect(data.swarm.instanceType).toBe("L");

      // Verify swarm was created in database
      const createdSwarm = await db.swarm.findUnique({
        where: { id: data.swarm.id },
      });
      expect(createdSwarm).toBeTruthy();
      expect(createdSwarm?.name).toBe("New Test Swarm");
      expect(createdSwarm?.workspaceId).toBe(testWorkspace.id);

      // Verify Stakwork API was called
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("api.stakwork.com"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Bearer"),
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("should return 401 for unauthenticated user", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const requestBody = {
        name: "Test Swarm",
        repositoryUrl: "https://github.com/test/repo",
        instanceType: "L",
        environmentVariables: [],
        services: [],
        workspaceId: "workspace-id",
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    test("should return 400 for missing required fields", async () => {
      const { testUser } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const requestBody = {
        name: "Test Swarm",
        // Missing repositoryUrl and other required fields
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Missing required fields");
    });

    test("should return 403 when user lacks workspace access", async () => {
      // Create user without workspace access
      const unauthorizedUser = await db.user.create({
        data: {
          id: `unauthorized-${Date.now()}`,
          email: "unauthorized@example.com",
          name: "Unauthorized User",
        },
      });

      const { testWorkspace, testRepository } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: unauthorizedUser.id, email: unauthorizedUser.email },
      });

      const requestBody = {
        name: "Test Swarm",
        repositoryUrl: testRepository.repositoryUrl,
        instanceType: "L",
        environmentVariables: [],
        services: [],
        workspaceId: testWorkspace.id,
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await POST(request);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Access denied" });
    });

    test("should return 400 for invalid repository URL format", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const requestBody = {
        name: "Test Swarm",
        repositoryUrl: "not-a-valid-url",
        instanceType: "L",
        environmentVariables: [],
        services: [],
        workspaceId: testWorkspace.id,
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid repository URL");
    });

    test("should return 500 when Stakwork API fails", async () => {
      const { testUser, testWorkspace, testRepository } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock Stakwork API failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as Response);

      const requestBody = {
        name: "Test Swarm",
        repositoryUrl: testRepository.repositoryUrl,
        instanceType: "L",
        environmentVariables: [],
        services: [],
        workspaceId: testWorkspace.id,
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Failed to create swarm",
      });
    });
  });

  describe("PUT /api/swarm", () => {
    test("should update swarm successfully with valid data", async () => {
      const { testUser, testWorkspace, testSwarm } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const updatedEnvironmentVariables = [
        { name: "NODE_ENV", value: "production" },
        { name: "API_URL", value: "https://api.example.com" },
        { name: "DATABASE_URL", value: "postgres://localhost/prod" },
      ];

      const updatedServices = [
        {
          name: "web",
          port: 3000,
          env: { NODE_ENV: "production" },
          scripts: { start: "npm run start:prod", install: "npm ci" },
        },
        {
          name: "worker",
          port: 3001,
          env: { NODE_ENV: "production" },
          scripts: { start: "npm run worker", install: "npm ci" },
        },
      ];

      const requestBody = {
        swarmId: testSwarm.id,
        environmentVariables: updatedEnvironmentVariables,
        services: updatedServices,
        workspaceId: testWorkspace.id,
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.swarm).toBeDefined();
      expect(data.swarm.environmentVariables).toEqual(updatedEnvironmentVariables);
      expect(data.swarm.services).toEqual(updatedServices);

      // Verify swarm was updated in database
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: testSwarm.id },
      });
      expect(updatedSwarm).toBeTruthy();
      expect(updatedSwarm?.environmentVariables).toEqual(updatedEnvironmentVariables);
      expect(updatedSwarm?.services).toEqual(updatedServices);
    });

    test("should return 401 for unauthenticated user", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const requestBody = {
        swarmId: "swarm-id",
        environmentVariables: [],
        services: [],
        workspaceId: "workspace-id",
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await PUT(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    test("should return 400 for missing required fields", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const requestBody = {
        // Missing swarmId and other required fields
        environmentVariables: [],
        services: [],
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await PUT(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Missing required fields");
    });

    test("should return 404 when swarm does not exist", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const requestBody = {
        swarmId: "non-existent-swarm-id",
        environmentVariables: [],
        services: [],
        workspaceId: testWorkspace.id,
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await PUT(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Swarm not found" });
    });

    test("should return 403 when user lacks workspace access", async () => {
      const { testSwarm } = await createTestUserWithWorkspaceAndSwarm();

      // Create unauthorized user
      const unauthorizedUser = await db.user.create({
        data: {
          id: `unauthorized-${Date.now()}`,
          email: "unauthorized@example.com",
          name: "Unauthorized User",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: unauthorizedUser.id, email: unauthorizedUser.email },
      });

      const requestBody = {
        swarmId: testSwarm.id,
        environmentVariables: [],
        services: [],
        workspaceId: testSwarm.workspaceId,
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await PUT(request);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Access denied" });
    });

    test("should handle empty environment variables and services", async () => {
      const { testUser, testWorkspace, testSwarm } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const requestBody = {
        swarmId: testSwarm.id,
        environmentVariables: [],
        services: [],
        workspaceId: testWorkspace.id,
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.swarm.environmentVariables).toEqual([]);
      expect(data.swarm.services).toEqual([]);

      // Verify database was updated
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: testSwarm.id },
      });
      expect(updatedSwarm?.environmentVariables).toEqual([]);
      expect(updatedSwarm?.services).toEqual([]);
    });

    test("should validate environment variable format", async () => {
      const { testUser, testWorkspace, testSwarm } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const requestBody = {
        swarmId: testSwarm.id,
        environmentVariables: [
          { name: "", value: "invalid" }, // Empty name
          { name: "VALID_VAR", value: "valid_value" },
        ],
        services: [],
        workspaceId: testWorkspace.id,
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await PUT(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid environment variable");
    });

    test("should validate service configuration format", async () => {
      const { testUser, testWorkspace, testSwarm } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const requestBody = {
        swarmId: testSwarm.id,
        environmentVariables: [],
        services: [
          { name: "", port: 3000 }, // Empty name
          { name: "valid-service", port: "invalid" }, // Invalid port type
        ],
        workspaceId: testWorkspace.id,
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await PUT(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid service configuration");
    });
  });

  describe("Database cleanup", () => {
    test("should properly handle database transactions", async () => {
      const { testUser, testWorkspace, testRepository } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock Stakwork API to fail after database operations begin
      mockFetch.mockImplementation(async () => {
        throw new Error("Network error");
      });

      const requestBody = {
        name: "Test Swarm",
        repositoryUrl: testRepository.repositoryUrl,
        instanceType: "L",
        environmentVariables: [],
        services: [],
        workspaceId: testWorkspace.id,
      };

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);

      // Verify no partial swarm was created in database due to transaction rollback
      const swarms = await db.swarm.findMany({
        where: { workspaceId: testWorkspace.id },
      });
      expect(swarms.length).toBe(0);
    });
  });
});