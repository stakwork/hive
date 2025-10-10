import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/ask/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
  expectForbidden,
  generateUniqueId,
  createGetRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace, createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import { resetDatabase } from "@/__tests__/support/fixtures/database";

// Mock external swarm server
global.fetch = vi.fn();

describe("GET /api/ask Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestUserWithWorkspaceAndSwarm() {
    return await db.$transaction(async (tx) => {
      // Create test user
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId("test-user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace
      const testWorkspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: generateUniqueId("test-workspace"),
          description: "Test workspace description",
          ownerId: testUser.id,
        },
      });

      // Create swarm linked to workspace
      const testSwarm = await tx.swarm.create({
        data: {
          swarmId: `swarm-${Date.now()}`,
          name: `test-swarm-${Date.now()}`,
          status: "ACTIVE",
          instanceType: "XL",
          repositoryName: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          defaultBranch: "main",
          swarmApiKey: JSON.stringify(
            encryptionService.encryptField("swarmApiKey", "test-api-key-12345")
          ),
          swarmUrl: "https://test-swarm.com",
          swarmSecretAlias: "test-secret",
          poolName: "test-pool",
          environmentVariables: [],
          services: [],
          workspaceId: testWorkspace.id,
        },
      });

      return { testUser, testWorkspace, testSwarm };
    });
  }

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "test question",
        workspace: "test-workspace",
      });

      const response = await GET(request);

      await expectUnauthorized(response);
    });

    test("accepts requests with valid session", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock successful swarm response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "Test answer", confidence: 0.95 }),
      });

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "test question",
        workspace: testWorkspace.slug,
      });

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when question param missing", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/ask", {
        workspace: testWorkspace.slug,
        // question missing
      });

      const response = await GET(request);

      await expectError(response, "Missing required parameter: question", 400);
    });

    test("returns 400 when workspace param missing", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "test question",
        // workspace missing
      });

      const response = await GET(request);

      await expectError(response, "Missing required parameter: workspace", 400);
    });

    test("returns 400 when both params missing", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/ask", {});

      const response = await GET(request);

      // Should fail on first missing param check (question)
      await expectError(response, "Missing required parameter: question", 400);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 403 when user not member of workspace", async () => {
      const { testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      // Create different user who doesn't have access
      const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "test question",
        workspace: testWorkspace.slug,
      });

      const response = await GET(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });

    test("allows workspace owner to ask questions", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock successful swarm response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "Owner answer" }),
      });

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "owner question",
        workspace: testWorkspace.slug,
      });

      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.answer).toBe("Owner answer");
    });

    test("allows workspace members to ask questions", async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Owner User" },
        members: [
          {
            user: { name: "Member User" },
            role: "DEVELOPER",
          },
        ],
      });

      // Create swarm for the workspace
      await db.swarm.create({
        data: {
          swarmId: `swarm-${Date.now()}`,
          name: `test-swarm-${Date.now()}`,
          status: "ACTIVE",
          instanceType: "XL",
          repositoryName: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          defaultBranch: "main",
          swarmApiKey: JSON.stringify(
            encryptionService.encryptField("swarmApiKey", "test-api-key-12345")
          ),
          swarmUrl: "https://test-swarm.com",
          swarmSecretAlias: "test-secret",
          poolName: "test-pool",
          environmentVariables: [],
          services: [],
          workspaceId: scenario.workspace.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.members[0]));

      // Mock successful swarm response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "Member answer" }),
      });

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "member question",
        workspace: scenario.workspace.slug,
      });

      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.answer).toBe("Member answer");
    });
  });

  describe("Configuration Tests", () => {
    test("returns 403 for non-existent workspace", async () => {
      const testUser = await createTestUser();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "test question",
        workspace: "nonexistent-workspace",
      });

      const response = await GET(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });

    test("returns 404 when swarm configuration missing", async () => {
      const testUser = await createTestUser();
      const testWorkspace = await createTestWorkspace({
        ownerId: testUser.id,
        name: "Test Workspace",
        slug: generateUniqueId("test-workspace"),
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "test question",
        workspace: testWorkspace.slug,
      });

      const response = await GET(request);

      await expectNotFound(response, "Swarm not found for this workspace");
    });

    test("returns 404 when swarm URL not configured", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      // Update swarm to remove URL
      await db.swarm.updateMany({
        where: { workspaceId: testWorkspace.id },
        data: { swarmUrl: null },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "test question",
        workspace: testWorkspace.slug,
      });

      const response = await GET(request);

      await expectNotFound(response, "Swarm URL not configured");
    });
  });

  describe("Encryption Tests", () => {
    test("successfully decrypts swarm API key", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "Decrypted answer" }),
      });
      global.fetch = mockFetch;

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "test question",
        workspace: testWorkspace.slug,
      });

      await GET(request);

      // Verify fetch was called with decrypted API key in header
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/ask?question="),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": "test-api-key-12345",
          }),
        })
      );
    });

    test("handles missing API key gracefully", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      // Update swarm to have null API key
      await db.swarm.updateMany({
        where: { workspaceId: testWorkspace.id },
        data: { swarmApiKey: null },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock fetch to return undefined (network error scenario)
      (global.fetch as any).mockResolvedValue(undefined);

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "test question",
        workspace: testWorkspace.slug,
      });

      const response = await GET(request);

      // Should fail with 500 due to fetch error when API key is empty
      expect(response.status).toBe(500);
      
      // Verify fetch was called with empty API key
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/ask?question="),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": "",
          }),
        })
      );
    });
  });

  describe("Proxy Tests", () => {
    test("makes correct GET request to swarm server", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "Proxy answer" }),
      });
      global.fetch = mockFetch;

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "What is the meaning of life?",
        workspace: testWorkspace.slug,
      });

      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("https://test-swarm.com:3355/ask?question=What%20is%20the%20meaning%20of%20life%3F"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-token": "test-api-key-12345",
          }),
        })
      );
    });

    test("passes question parameter correctly with special characters", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "Special answer" }),
      });
      global.fetch = mockFetch;

      const specialQuestion = "What is 2+2? & how about 3<5?";

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: specialQuestion,
        workspace: testWorkspace.slug,
      });

      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(specialQuestion)),
        expect.any(Object)
      );
    });

    test("returns swarm server response as-is", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const swarmResponse = {
        answer: "Complex answer",
        confidence: 0.95,
        sources: ["file1.ts", "file2.ts"],
        metadata: { processingTime: 123 },
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => swarmResponse,
      });

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "complex question",
        workspace: testWorkspace.slug,
      });

      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual(swarmResponse);
    });

    test("handles swarm server 500 error", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "test question",
        workspace: testWorkspace.slug,
      });

      const response = await GET(request);

      await expectError(response, "Failed to process question", 500);
    });

    test("handles swarm server network error", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (global.fetch as any).mockRejectedValue(new Error("Network error"));

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "test question",
        workspace: testWorkspace.slug,
      });

      const response = await GET(request);

      await expectError(response, "Failed to process question", 500);
    });

    test("handles localhost swarm URL correctly", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      // Update swarm to use localhost URL
      await db.swarm.updateMany({
        where: { workspaceId: testWorkspace.id },
        data: { swarmUrl: "http://localhost:3355" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "Localhost answer" }),
      });
      global.fetch = mockFetch;

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "localhost question",
        workspace: testWorkspace.slug,
      });

      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("http://localhost:3355/ask"),
        expect.any(Object)
      );
    });
  });

  describe("End-to-End Integration Tests", () => {
    test("successfully processes question through entire flow", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          answer: "The meaning of life is 42",
          confidence: 0.99,
          sources: ["file1.ts", "file2.ts"],
        }),
      });

      const request = createGetRequest("http://localhost:3000/api/ask", {
        question: "What is the meaning of life?",
        workspace: testWorkspace.slug,
      });

      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.answer).toBe("The meaning of life is 42");
      expect(data.confidence).toBe(0.99);
      expect(data.sources).toEqual(["file1.ts", "file2.ts"]);

      // Verify fetch was called correctly
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/ask?question="),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "x-api-token": "test-api-key-12345",
          }),
        })
      );
    });

    test("handles multiple sequential requests", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // First request
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ answer: "First answer" }),
      });

      const request1 = createGetRequest("http://localhost:3000/api/ask", {
        question: "First question",
        workspace: testWorkspace.slug,
      });

      const response1 = await GET(request1);
      const data1 = await expectSuccess(response1, 200);
      expect(data1.answer).toBe("First answer");

      // Second request
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ answer: "Second answer" }),
      });

      const request2 = createGetRequest("http://localhost:3000/api/ask", {
        question: "Second question",
        workspace: testWorkspace.slug,
      });

      const response2 = await GET(request2);
      const data2 = await expectSuccess(response2, 200);
      expect(data2.answer).toBe("Second answer");

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});