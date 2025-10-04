import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/ask/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  expectError,
  generateUniqueId,
  getMockedSession,
  createGetRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";

// Mock validateWorkspaceAccess
vi.mock("@/services/workspace", async () => {
  const actual = await vi.importActual("@/services/workspace");
  return {
    ...actual,
    validateWorkspaceAccess: vi.fn(),
  };
});

import { validateWorkspaceAccess } from "@/services/workspace";

const mockedValidateWorkspaceAccess = vi.mocked(validateWorkspaceAccess);

describe("Ask API Integration Tests", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspaceScenario>>["workspace"];
  let mockSwarm: {
    id: string;
    workspaceId: string;
    swarmUrl: string;
    swarmApiKey: string;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test user and workspace
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Test Owner" },
    });

    testUser = scenario.owner;
    testWorkspace = scenario.workspace;

    // Create mock swarm data
    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField("swarmApiKey", "test-api-key-123");

    mockSwarm = {
      id: generateUniqueId("swarm"),
      workspaceId: testWorkspace.id,
      swarmUrl: "https://test-swarm.example.com",
      swarmApiKey: JSON.stringify(encryptedApiKey),
    };

    // Insert swarm into database for integration tests
    await db.swarm.create({
      data: {
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        name: "Test Swarm",
        instanceType: "t2.micro",
        environmentVariables: [],
        status: "ACTIVE",
        swarmUrl: mockSwarm.swarmUrl,
        repositoryName: "test-repo",
        repositoryDescription: "Test repository",
        repositoryUrl: "https://github.com/test/repo",
        swarmApiKey: mockSwarm.swarmApiKey,
        poolName: "test-pool",
        poolCpu: "2",
        poolMemory: "4Gi",
        services: [],
        swarmSecretAlias: "test-secret",
        defaultBranch: "main",
        poolState: "NOT_STARTED",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/ask - Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        `http://localhost:3000/api/ask?question=test&workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);

      await expectUnauthorized(response);
    });

    test("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({
        user: null,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/ask?question=test&workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);

      await expectUnauthorized(response);
    });
  });

  describe("GET /api/ask - Query Parameter Validation", () => {
    test("should return 400 when question parameter is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/ask?workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);

      await expectError(response, "Missing required parameter: question", 400);
    });

    test("should return 400 when workspace parameter is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/ask?question=test");
      const response = await GET(request);

      await expectError(response, "Missing required parameter: workspace", 400);
    });

    test("should return 400 when both parameters are missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/ask");
      const response = await GET(request);

      await expectError(response, "Missing required parameter: question", 400);
    });
  });

  describe("GET /api/ask - Authorization", () => {
    test("should return 403 when user lacks workspace access", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock validateWorkspaceAccess to deny access
      mockedValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/ask?question=test&workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });

    test("should return 403 when workspace does not exist", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock validateWorkspaceAccess to deny access
      mockedValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask?question=test&workspace=nonexistent-workspace"
      );
      const response = await GET(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });
  });

  describe("GET /api/ask - Swarm Configuration", () => {
    test("should return 404 when swarm is not found for workspace", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Create a workspace without swarm
      const workspaceWithoutSwarm = await createTestWorkspaceScenario({
        owner: { name: "Owner Without Swarm" },
      });

      mockedValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: workspaceWithoutSwarm.workspace.id,
          name: workspaceWithoutSwarm.workspace.name,
          description: workspaceWithoutSwarm.workspace.description,
          slug: workspaceWithoutSwarm.workspace.slug,
          ownerId: workspaceWithoutSwarm.workspace.ownerId,
          createdAt: workspaceWithoutSwarm.workspace.createdAt.toISOString(),
          updatedAt: workspaceWithoutSwarm.workspace.updatedAt.toISOString(),
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/ask?question=test&workspace=${workspaceWithoutSwarm.workspace.slug}`
      );
      const response = await GET(request);

      await expectNotFound(response, "Swarm not found for this workspace");
    });

    test("should return 404 when swarm URL is not configured", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Update swarm to have null swarmUrl
      await db.swarm.update({
        where: { id: mockSwarm.id },
        data: { swarmUrl: null },
      });

      mockedValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/ask?question=test&workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);

      await expectNotFound(response, "Swarm URL not configured");
    });
  });

  describe("GET /api/ask - External API Integration", () => {
    test("should return 500 when external swarm API returns error status", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockedValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
      });

      // Mock fetch to return error status
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "Service unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createGetRequest(
        `http://localhost:3000/api/ask?question=test&workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);

      await expectError(response, "Failed to process question", 500);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/ask?question=test"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-token": "test-api-key-123",
          }),
        })
      );

      fetchSpy.mockRestore();
    });

    test("should return 500 when external swarm API network request fails", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockedValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
      });

      // Mock fetch to throw network error
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Network error"));

      const request = createGetRequest(
        `http://localhost:3000/api/ask?question=test&workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);

      await expectError(response, "Failed to process question", 500);

      fetchSpy.mockRestore();
    });
  });

  describe("GET /api/ask - Success Path", () => {
    test("should successfully proxy request to swarm and return data", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockedValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
      });

      const mockSwarmResponse = {
        answer: "This is the answer to your question",
        sources: ["source1.ts", "source2.ts"],
        confidence: 0.95,
      };

      // Mock successful fetch
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockSwarmResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createGetRequest(
        `http://localhost:3000/api/ask?question=What is TypeScript?&workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data).toEqual(mockSwarmResponse);
      expect(data.answer).toBe("This is the answer to your question");
      expect(data.sources).toHaveLength(2);
      expect(data.confidence).toBe(0.95);

      // Verify fetch was called with correct URL and headers
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/ask?question=What%20is%20TypeScript%3F"),
        expect.objectContaining({
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": "test-api-key-123",
          },
        })
      );

      fetchSpy.mockRestore();
    });

    test("should handle localhost swarm URL correctly", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Update swarm to use localhost URL
      await db.swarm.update({
        where: { id: mockSwarm.id },
        data: { swarmUrl: "http://localhost:3355" },
      });

      mockedValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
      });

      const mockSwarmResponse = { answer: "Test answer", sources: [] };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockSwarmResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createGetRequest(
        `http://localhost:3000/api/ask?question=test&workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);

      await expectSuccess(response);

      // Verify fetch was called with localhost URL
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("http://localhost:3355/ask"),
        expect.any(Object)
      );

      fetchSpy.mockRestore();
    });

    test("should properly URL-encode question parameter", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockedValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
      });

      const mockSwarmResponse = { answer: "Encoded answer", sources: [] };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockSwarmResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const complexQuestion = "What is the difference between 'var' & 'let'?";
      const request = createGetRequest(
        `http://localhost:3000/api/ask?question=${encodeURIComponent(complexQuestion)}&workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);

      await expectSuccess(response);

      // Verify question was properly encoded in fetch URL
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `/ask?question=${encodeURIComponent(complexQuestion)}`
        ),
        expect.any(Object)
      );

      fetchSpy.mockRestore();
    });

    test("should decrypt swarm API key correctly", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockedValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
      });

      const mockSwarmResponse = { answer: "Decrypted key test", sources: [] };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockSwarmResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createGetRequest(
        `http://localhost:3000/api/ask?question=test&workspace=${testWorkspace.slug}`
      );
      await GET(request);

      // Verify fetch was called with decrypted API key
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": "test-api-key-123",
          }),
        })
      );

      // Verify the stored API key in database is still encrypted
      const storedSwarm = await db.swarm.findUnique({
        where: { id: mockSwarm.id },
      });
      expect(storedSwarm?.swarmApiKey).toBe(mockSwarm.swarmApiKey);
      expect(storedSwarm?.swarmApiKey).not.toContain("test-api-key-123");

      fetchSpy.mockRestore();
    });
  });
});