import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/ask/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createGetRequest,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectForbidden,
  createAuthenticatedSession,
  getMockedSession,
  mockUnauthenticatedSession,
  generateUniqueId,
} from "@/__tests__/support/helpers";

// Mock fetch for external swarm API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GET /api/ask Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdSwarmIds: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(async () => {
    // Cleanup created resources
    if (createdSwarmIds.length > 0) {
      await db.swarm.deleteMany({
        where: { id: { in: createdSwarmIds } },
      });
      createdSwarmIds.length = 0;
    }

    if (createdWorkspaceIds.length > 0) {
      await db.workspaceMember.deleteMany({
        where: { workspaceId: { in: createdWorkspaceIds } },
      });
      await db.workspace.deleteMany({
        where: { id: { in: createdWorkspaceIds } },
      });
      createdWorkspaceIds.length = 0;
    }

    if (createdUserIds.length > 0) {
      await db.session.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await db.account.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await db.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }
  });

  /**
   * Helper to create test fixtures inline
   */
  async function createTestFixtures(options?: {
    includeSwarm?: boolean;
    swarmApiKey?: string;
    swarmUrl?: string;
    userRole?: "OWNER" | "ADMIN" | "DEVELOPER" | "VIEWER";
  }) {
    const {
      includeSwarm = true,
      swarmApiKey = "test-swarm-api-key-123",
      swarmUrl = "https://test-swarm.example.com",
      userRole = "OWNER",
    } = options || {};

    return await db.$transaction(async (tx) => {
      // Create test user
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });
      createdUserIds.push(user.id);

      // Create test workspace
      const workspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: `test-workspace-${generateUniqueId()}`,
          ownerId: user.id,
        },
      });
      createdWorkspaceIds.push(workspace.id);

      // Create workspace membership
      await tx.workspaceMember.create({
        data: {
          id: generateUniqueId("member"),
          workspaceId: workspace.id,
          userId: user.id,
          role: userRole,
        },
      });

      let swarm = null;
      if (includeSwarm) {
        // Encrypt API key
        const encryptedApiKey = encryptionService.encryptField("swarmApiKey", swarmApiKey);

        swarm = await tx.swarm.create({
          data: {
            id: generateUniqueId("swarm"),
            name: `test-swarm-${generateUniqueId()}`,
            workspaceId: workspace.id,
            swarmUrl: swarmUrl,
            swarmApiKey: JSON.stringify(encryptedApiKey),
          },
        });
        createdSwarmIds.push(swarm.id);
      }

      return { user, workspace, swarm };
    });
  }

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest("http://localhost/api/ask", {
        question: "What is the meaning of life?",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectUnauthorized(response);

      // Verify no external calls were made
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({
        user: null,
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectUnauthorized(response);
    });

    test("should accept request with valid authenticated session", async () => {
      const { user, workspace } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock successful swarm response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "42", confidence: 0.95 }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      expect(data).toHaveProperty("answer");
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("should return 400 when 'question' parameter is missing", async () => {
      const { user, workspace } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost/api/ask", {
        workspace: workspace.slug,
        // question is missing
      });

      const response = await GET(request);
      await expectError(response, "Missing required parameter: question", 400);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 400 when 'workspace' parameter is missing", async () => {
      const { user } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost/api/ask", {
        question: "What is the answer?",
        // workspace is missing
      });

      const response = await GET(request);
      await expectError(response, "Missing required parameter: workspace", 400);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 400 when both parameters are missing", async () => {
      const { user } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost/api/ask", {});

      const response = await GET(request);

      // Should fail on first missing param check (question)
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain("Missing required parameter");
    });

    test("should accept request with all required parameters", async () => {
      const { user, workspace } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "valid" }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "valid question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      await expectSuccess(response, 200);
    });
  });

  describe("Authorization", () => {
    test("should return 403 when user is not a member of workspace", async () => {
      // Create workspace with owner
      const { workspace } = await createTestFixtures();

      // Create different user (not a member)
      const nonMember = await db.user.create({
        data: {
          id: generateUniqueId("non-member"),
          email: `non-member-${generateUniqueId()}@example.com`,
          name: "Non Member",
        },
      });
      createdUserIds.push(nonMember.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      await expectForbidden(response, "Workspace not found or access denied");

      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should allow workspace owner to ask questions", async () => {
      const { user, workspace } = await createTestFixtures({ userRole: "OWNER" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "owner access granted" }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "owner question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      await expectSuccess(response, 200);
    });

    test("should allow workspace admin to ask questions", async () => {
      const { user, workspace } = await createTestFixtures({ userRole: "ADMIN" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "admin access granted" }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "admin question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      await expectSuccess(response, 200);
    });

    test("should allow workspace developer to ask questions", async () => {
      const { user, workspace } = await createTestFixtures({ userRole: "DEVELOPER" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "developer access granted" }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "developer question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      await expectSuccess(response, 200);
    });

    test("should allow workspace viewer to ask questions", async () => {
      const { user, workspace } = await createTestFixtures({ userRole: "VIEWER" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "viewer access granted" }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "viewer question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      await expectSuccess(response, 200);
    });

    test("should return 403 when workspace slug does not exist", async () => {
      const { user } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: "non-existent-workspace-slug",
      });

      const response = await GET(request);
      await expectForbidden(response);
    });
  });

  describe("Swarm Configuration", () => {
    test("should return 404 when swarm configuration is missing", async () => {
      const { user, workspace } = await createTestFixtures({ includeSwarm: false });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found for this workspace");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 404 when swarm URL is not configured", async () => {
      const { user, workspace } = await createTestFixtures();

      // Update swarm to remove URL
      await db.swarm.updateMany({
        where: { workspaceId: workspace.id },
        data: { swarmUrl: null },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm URL not configured");
    });

    test("should successfully use swarm configuration when present", async () => {
      const { user, workspace } = await createTestFixtures({
        swarmUrl: "https://production-swarm.example.com",
        swarmApiKey: "production-api-key",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "configured correctly" }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      await expectSuccess(response, 200);

      // Verify swarm URL was used correctly
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("production-swarm.example.com"),
        expect.any(Object),
      );
    });

    test("should construct localhost URL for local swarm instances", async () => {
      const { user, workspace } = await createTestFixtures({
        swarmUrl: "http://localhost:8080",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "localhost" }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      await expectSuccess(response, 200);

      // Verify localhost URL was constructed
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("http://localhost:3355"), expect.any(Object));
    });
  });

  describe("Encryption and Decryption", () => {
    test("should successfully decrypt swarm API key", async () => {
      const originalApiKey = "secret-swarm-api-key-456";
      const { user, workspace } = await createTestFixtures({
        swarmApiKey: originalApiKey,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "decryption success" }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      await expectSuccess(response, 200);

      // Verify decrypted API key was used in request header
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": originalApiKey,
          }),
        }),
      );
    });

    test("should handle encrypted API key with explicit key ID", async () => {
      const activeKeyId = encryptionService.getActiveKeyId() || "default";
      const apiKey = "key-with-explicit-id";

      const encryptedApiKey = encryptionService.encryptFieldWithKeyId("swarmApiKey", apiKey, activeKeyId);

      const { user, workspace } = await createTestFixtures({ includeSwarm: false });

      // Create swarm with explicitly encrypted key
      const swarm = await db.swarm.create({
        data: {
          id: generateUniqueId("swarm"),
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
          swarmUrl: "https://test-swarm.example.com",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });
      createdSwarmIds.push(swarm.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "explicit key id" }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      await expectSuccess(response, 200);

      // Verify correct API key was decrypted and used
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": apiKey,
          }),
        }),
      );
    });

    test("should handle malformed encrypted data gracefully", async () => {
      const { user, workspace } = await createTestFixtures({ includeSwarm: false });

      // Create swarm with malformed encryption
      const swarm = await db.swarm.create({
        data: {
          id: generateUniqueId("swarm"),
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
          swarmUrl: "https://test-swarm.example.com",
          swarmApiKey: "invalid-encryption-format",
        },
      });
      createdSwarmIds.push(swarm.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "fallback to plaintext" }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);

      // EncryptionService returns plaintext for malformed data
      await expectSuccess(response, 200);
    });
  });

  describe("HTTP Proxy Behavior", () => {
    test("should proxy question to swarm server with correct parameters", async () => {
      const { user, workspace } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "42", confidence: 0.95 }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "What is the meaning of life?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      expect(data.answer).toBe("42");
      expect(data.confidence).toBe(0.95);

      // Verify fetch was called with correct URL and headers
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/ask?question=What%20is%20the%20meaning%20of%20life%3F"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should properly encode special characters in question parameter", async () => {
      const { user, workspace } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "encoded" }),
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "What about spaces & special chars?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      await expectSuccess(response, 200);

      // Verify URL encoding
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("What%20about%20spaces%20%26%20special%20chars%3F"),
        expect.any(Object),
      );
    });

    test("should return swarm server response as-is", async () => {
      const { user, workspace } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const swarmResponse = {
        answer: "Complex answer",
        confidence: 0.87,
        sources: ["doc1.md", "doc2.md"],
        metadata: { tokens: 150, model: "gpt-4" },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => swarmResponse,
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "complex question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      // Verify entire response is proxied
      expect(data).toEqual(swarmResponse);
    });

    test("should handle swarm server returning 500 error", async () => {
      const { user, workspace } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process question");
    });

    test("should handle network timeout to swarm server", async () => {
      const { user, workspace } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockRejectedValue(new Error("Network timeout"));

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process question");
    });

    test("should handle swarm server connection refused", async () => {
      const { user, workspace } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const request = createGetRequest("http://localhost/api/ask", {
        question: "test question",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process question");
    });

    test("should handle various swarm server error status codes", async () => {
      const errorScenarios = [
        { status: 400, statusText: "Bad Request" },
        { status: 404, statusText: "Not Found" },
        { status: 503, statusText: "Service Unavailable" },
      ];

      for (const scenario of errorScenarios) {
        const { user, workspace } = await createTestFixtures();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        mockFetch.mockResolvedValue({
          ok: false,
          status: scenario.status,
          statusText: scenario.statusText,
        });

        const request = createGetRequest("http://localhost/api/ask", {
          question: "test question",
          workspace: workspace.slug,
        });

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to process question");

        // Reset for next iteration
        mockFetch.mockClear();
      }
    });
  });

  describe("End-to-End Integration", () => {
    test("should complete full request flow successfully", async () => {
      const apiKey = "e2e-test-api-key";
      const { user, workspace } = await createTestFixtures({
        swarmUrl: "https://e2e-swarm.example.com",
        swarmApiKey: apiKey,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const swarmResponse = {
        answer: "The answer is 42",
        confidence: 0.99,
        sources: ["hitchhikers-guide.md"],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => swarmResponse,
      });

      const request = createGetRequest("http://localhost/api/ask", {
        question: "What is the answer to life, universe, and everything?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      // Verify complete response
      expect(data).toEqual(swarmResponse);

      // Verify complete request chain
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("e2e-swarm.example.com:3355/ask"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-token": apiKey,
          }),
        }),
      );
    });

    test("should handle multiple sequential requests to same workspace", async () => {
      const { user, workspace } = await createTestFixtures();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const questions = ["First question", "Second question", "Third question"];

      for (const question of questions) {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ answer: `Answer to: ${question}` }),
        });

        const request = createGetRequest("http://localhost/api/ask", {
          question,
          workspace: workspace.slug,
        });

        const response = await GET(request);
        const data = await expectSuccess(response, 200);

        expect(data.answer).toBe(`Answer to: ${question}`);
      }

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    test("should handle requests from different workspaces", async () => {
      const { user: user1, workspace: workspace1 } = await createTestFixtures();
      const { user: user2, workspace: workspace2 } = await createTestFixtures();

      // User 1 asks question in workspace 1
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user1));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "workspace1 answer" }),
      });

      const request1 = createGetRequest("http://localhost/api/ask", {
        question: "workspace1 question",
        workspace: workspace1.slug,
      });

      const response1 = await GET(request1);
      const data1 = await expectSuccess(response1, 200);
      expect(data1.answer).toBe("workspace1 answer");

      // User 2 asks question in workspace 2
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user2));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "workspace2 answer" }),
      });

      const request2 = createGetRequest("http://localhost/api/ask", {
        question: "workspace2 question",
        workspace: workspace2.slug,
      });

      const response2 = await GET(request2);
      const data2 = await expectSuccess(response2, 200);
      expect(data2.answer).toBe("workspace2 answer");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("should maintain isolation between concurrent requests", async () => {
      const { user: user1, workspace: workspace1 } = await createTestFixtures();
      const { user: user2, workspace: workspace2 } = await createTestFixtures();

      // Setup different responses for each workspace
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ answer: "concurrent1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ answer: "concurrent2" }),
        });

      // Execute request1 with user1 session
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user1));

      const request1 = createGetRequest("http://localhost/api/ask", {
        question: "concurrent question 1",
        workspace: workspace1.slug,
      });

      const response1 = await GET(request1);
      const data1 = await expectSuccess(response1, 200);
      expect(data1.answer).toBe("concurrent1");

      // Execute request2 with user2 session
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user2));

      const request2 = createGetRequest("http://localhost/api/ask", {
        question: "concurrent question 2",
        workspace: workspace2.slug,
      });

      const response2 = await GET(request2);
      const data2 = await expectSuccess(response2, 200);
      expect(data2.answer).toBe("concurrent2");

      // Verify both requests were made
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
