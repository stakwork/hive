import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/ask/quick/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectUnauthorized,
  expectError,
  generateUniqueId,
  generateUniqueSlug,
  createGetRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock NextAuth
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));

// Mock AI SDK
vi.mock("ai", () => ({
  streamText: vi.fn(),
  hasToolCall: vi.fn(),
}));

// Mock aieo package
vi.mock("aieo", () => ({
  getModel: vi.fn(),
  getApiKeyForProvider: vi.fn(),
}));

// Mock askTools
vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn(),
}));

// Mock workspace validation
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { streamText } from "ai";
import { getModel, getApiKeyForProvider } from "aieo";
import { askTools } from "@/lib/ai/askTools";
import { validateWorkspaceAccess } from "@/services/workspace";

const mockGetGithubUsernameAndPAT = getGithubUsernameAndPAT as vi.MockedFunction<
  typeof getGithubUsernameAndPAT
>;
const mockStreamText = streamText as vi.MockedFunction<typeof streamText>;
const mockGetModel = getModel as vi.MockedFunction<typeof getModel>;
const mockGetApiKeyForProvider = getApiKeyForProvider as vi.MockedFunction<
  typeof getApiKeyForProvider
>;
const mockAskTools = askTools as vi.MockedFunction<typeof askTools>;
const mockValidateWorkspaceAccess = validateWorkspaceAccess as vi.MockedFunction<
  typeof validateWorkspaceAccess
>;

describe("GET /api/ask/quick Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestWorkspaceWithSwarm() {
    return await db.$transaction(async (tx) => {
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId("test-user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const testWorkspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          description: "Test workspace description",
          ownerId: testUser.id,
        },
      });

      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-swarm-api-key"
      );

      const testSwarm = await tx.swarm.create({
        data: {
          swarmId: generateUniqueId("swarm"),
          name: "test-swarm",
          status: "ACTIVE",
          instanceType: "XL",
          repositoryName: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          defaultBranch: "main",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          swarmUrl: "https://test-swarm.sphinx.chat/api",
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
    vi.clearAllMocks();

    // Setup default mocks
    mockGetApiKeyForProvider.mockReturnValue("test-api-key");
    mockGetModel.mockResolvedValue({
      modelId: "claude-3-5-sonnet-20241022",
    } as any);
    mockAskTools.mockReturnValue({
      get_learnings: { execute: vi.fn() },
      recent_commits: { execute: vi.fn() },
      recent_contributions: { execute: vi.fn() },
      web_search: { execute: vi.fn() },
      final_answer: { execute: vi.fn() },
    } as any);
  });

  describe("Authentication Tests", () => {
    test("should return 401 for unauthenticated request", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: "test-workspace",
        }
      );

      const response = await GET(request);

      await expectUnauthorized(response);
    });

    test("should return 401 for session without user", async () => {
      getMockedSession().mockResolvedValue({
        user: null,
      } as any);

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: "test-workspace",
        }
      );

      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });
  });

  describe("Request Validation Tests", () => {
    test("should return 400 for missing question parameter", async () => {
      const { testUser } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          workspace: "test-workspace",
        }
      );

      const response = await GET(request);

      await expectError(
        response,
        "Missing required parameter: question",
        400
      );
    });

    test("should return 400 for missing workspace parameter", async () => {
      const { testUser } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
        }
      );

      const response = await GET(request);

      await expectError(
        response,
        "Missing required parameter: workspace",
        400
      );
    });

    test("should return 400 for empty question parameter", async () => {
      const { testUser } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "",
          workspace: "test-workspace",
        }
      );

      const response = await GET(request);

      await expectError(
        response,
        "Missing required parameter: question",
        400
      );
    });
  });

  describe("Authorization Tests", () => {
    test("should return 403 for user without workspace access", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: testWorkspace.slug,
        }
      );

      const response = await GET(request);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "Workspace not found or access denied",
      });
    });

    test("should return 403 for non-existent workspace", async () => {
      const { testUser } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: "non-existent-workspace",
        }
      );

      const response = await GET(request);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "Workspace not found or access denied",
      });
    });
  });

  describe("Resource Validation Tests", () => {
    test("should return 404 when swarm not found", async () => {
      const { testUser } = await createTestWorkspaceWithSwarm();

      // Create workspace without swarm
      const workspaceWithoutSwarm = await db.workspace.create({
        data: {
          name: "Workspace Without Swarm",
          slug: generateUniqueSlug("no-swarm"),
          ownerId: testUser.id,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspaceWithoutSwarm.id,
          name: workspaceWithoutSwarm.name,
          description: workspaceWithoutSwarm.description,
          slug: workspaceWithoutSwarm.slug,
          ownerId: workspaceWithoutSwarm.ownerId,
          createdAt: workspaceWithoutSwarm.createdAt.toISOString(),
          updatedAt: workspaceWithoutSwarm.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: workspaceWithoutSwarm.slug,
        }
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Swarm not found for this workspace",
      });
    });

    test("should return 404 when swarm URL not configured", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      // Update swarm to have null URL
      await db.swarm.update({
        where: { workspaceId: testWorkspace.id },
        data: { swarmUrl: null },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: testWorkspace.slug,
        }
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Swarm URL not configured",
      });
    });

    test("should return 404 when repository URL not configured", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      // Update swarm to have null repository URL
      await db.swarm.update({
        where: { workspaceId: testWorkspace.id },
        data: { repositoryUrl: null },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: testWorkspace.slug,
        }
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Repository URL not configured for this swarm",
      });
    });

    test("should return 404 when GitHub PAT not found", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue(null);

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: testWorkspace.slug,
        }
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "GitHub PAT not found for this user",
      });
    });
  });

  describe("Credential Decryption Tests", () => {
    test("should successfully decrypt swarm API key", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "github_pat_test_token",
      });

      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("test stream", {
            headers: { "content-type": "text/plain" },
          })
        ),
      } as any);

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: testWorkspace.slug,
        }
      );

      const response = await GET(request);

      // Should not return error about decryption
      expect(response.status).not.toBe(500);

      // Verify swarm API key was read from database
      const swarm = await db.swarm.findFirst({
        where: { workspaceId: testWorkspace.id },
      });
      expect(swarm?.swarmApiKey).toBeDefined();
      expect(typeof swarm?.swarmApiKey).toBe("string");

      // Verify stored key is encrypted (not plaintext)
      expect(swarm?.swarmApiKey).not.toContain("test-swarm-api-key");
    });

    test("should handle decryption of malformed encrypted data", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      // Update swarm with malformed encrypted data
      await db.swarm.update({
        where: { workspaceId: testWorkspace.id },
        data: { swarmApiKey: "invalid-encrypted-data" },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "github_pat_test_token",
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: testWorkspace.slug,
        }
      );

      const response = await GET(request);

      // Should handle gracefully - decryptField returns original string on parse failure
      expect(response.status).toBeLessThan(500);
    });
  });

  describe("AI Tool Integration Tests", () => {
    test("should successfully invoke AI tools", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "github_pat_test_token",
      });

      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("test stream", {
            headers: { "content-type": "text/plain" },
          })
        ),
      } as any);

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "What are the recent commits?",
          workspace: testWorkspace.slug,
        }
      );

      const response = await GET(request);

      // Verify askTools was called with correct parameters
      expect(mockAskTools).toHaveBeenCalledWith(
        expect.stringContaining("3355"), // baseSwarmUrl
        "test-swarm-api-key", // decryptedSwarmApiKey
        "https://github.com/test/repo", // repoUrl
        "github_pat_test_token", // pat
        "test-api-key" // apiKey
      );

      // Verify streamText was called
      expect(mockStreamText).toHaveBeenCalled();
    });

    test("should handle AI provider configuration", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "github_pat_test_token",
      });

      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("test stream", {
            headers: { "content-type": "text/plain" },
          })
        ),
      } as any);

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: testWorkspace.slug,
        }
      );

      await GET(request);

      // Verify AI provider was configured
      expect(mockGetApiKeyForProvider).toHaveBeenCalledWith("anthropic");
      expect(mockGetModel).toHaveBeenCalledWith(
        "anthropic",
        "test-api-key",
        testWorkspace.slug
      );
    });
  });

  describe("Streaming Response Tests", () => {
    test("should return streaming response on success", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "github_pat_test_token",
      });

      const mockStreamResponse = new Response("test stream", {
        headers: { "content-type": "text/plain" },
      });

      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(mockStreamResponse),
      } as any);

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: testWorkspace.slug,
        }
      );

      const response = await GET(request);

      // Verify streaming response was returned
      expect(response).toBeDefined();
      expect(mockStreamText).toHaveBeenCalled();
    });

    test("should return 500 when stream creation fails", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "github_pat_test_token",
      });

      // Mock streamText to throw error
      mockStreamText.mockImplementation(() => {
        throw new Error("Stream creation failed");
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: testWorkspace.slug,
        }
      );

      const response = await GET(request);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Failed to create stream",
      });
    });
  });

  describe("Error Handling Tests", () => {
    test("should return 500 for unexpected errors", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Mock validateWorkspaceAccess to throw unexpected error
      mockValidateWorkspaceAccess.mockRejectedValue(
        new Error("Unexpected database error")
      );

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: testWorkspace.slug,
        }
      );

      const response = await GET(request);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Failed to process quick ask",
      });
    });

    test("should handle database query failures gracefully", async () => {
      const { testUser } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: "invalid-workspace-id",
          name: "Test",
          description: null,
          slug: "test",
          ownerId: testUser.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: "invalid-workspace",
        }
      );

      const response = await GET(request);

      // Should return 404 for missing swarm
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Swarm not found for this workspace",
      });
    });
  });

  describe("Integration Flow Tests", () => {
    test("should successfully process complete request flow", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "github_pat_test_token",
      });

      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("test stream", {
            headers: { "content-type": "text/plain" },
          })
        ),
      } as any);

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "What are the recent commits in the repository?",
          workspace: testWorkspace.slug,
        }
      );

      const response = await GET(request);

      // Verify complete flow
      expect(response).toBeDefined();
      expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith(
        testWorkspace.slug,
        testUser.id
      );
      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledWith(
        testUser.id,
        testWorkspace.slug
      );
      expect(mockGetApiKeyForProvider).toHaveBeenCalledWith("anthropic");
      expect(mockGetModel).toHaveBeenCalled();
      expect(mockAskTools).toHaveBeenCalled();
      expect(mockStreamText).toHaveBeenCalled();
    });

    test("should handle localhost swarm URL correctly", async () => {
      const { testUser, testWorkspace } = await createTestWorkspaceWithSwarm();

      // Update swarm to use localhost URL
      await db.swarm.update({
        where: { workspaceId: testWorkspace.id },
        data: { swarmUrl: "http://localhost:3000/api" },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          description: testWorkspace.description,
          slug: testWorkspace.slug,
          ownerId: testWorkspace.ownerId,
          createdAt: testWorkspace.createdAt.toISOString(),
          updatedAt: testWorkspace.updatedAt.toISOString(),
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "github_pat_test_token",
      });

      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("test stream", {
            headers: { "content-type": "text/plain" },
          })
        ),
      } as any);

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        {
          question: "Test question",
          workspace: testWorkspace.slug,
        }
      );

      await GET(request);

      // Verify askTools was called with localhost URL (http, not https)
      expect(mockAskTools).toHaveBeenCalledWith(
        "http://localhost:3355", // baseSwarmUrl for localhost
        expect.any(String), // decryptedSwarmApiKey
        expect.any(String), // repoUrl
        expect.any(String), // pat
        expect.any(String) // apiKey
      );
    });
  });
});