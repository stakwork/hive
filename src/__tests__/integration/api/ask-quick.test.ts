import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/ask/quick/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  generateUniqueId,
  createGetRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock external services only
vi.mock("ai", () => ({
  streamText: vi.fn(),
  hasToolCall: vi.fn(() => vi.fn()),
}));

vi.mock("aieo", () => ({
  getApiKeyForProvider: vi.fn(() => "test-anthropic-key"),
  getModel: vi.fn(() => Promise.resolve({ modelId: "claude-3-5-sonnet-20241022" })),
  getProviderTool: vi.fn(() => ({ /* mock tool */ })),
}));

// Mock RepoAnalyzer from gitsee/server (used in askTools)
vi.mock("gitsee/server", () => ({
  RepoAnalyzer: vi.fn().mockImplementation(() => ({
    getRecentCommitsWithFiles: vi.fn().mockResolvedValue([]),
    getContributorPRs: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock external API calls in askTools
global.fetch = vi.fn();

const { streamText: mockStreamText } = await import("ai");
const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

// Test Data Factories
const IntegrationTestFactories = {
  createTestWorkspaceWithSwarm: async (userId: string) => {
    return await db.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: generateUniqueId("test-workspace"),
          description: "Test workspace description",
          ownerId: userId,
          stakworkApiKey: "test-stakwork-key",
        },
      });

      const encryptionService = EncryptionService.getInstance();
      const encryptedSwarmApiKey = JSON.stringify(
        encryptionService.encryptField("swarmApiKey", "test-swarm-api-key")
      );

      const swarm = await tx.swarm.create({
        data: {
          swarmId: `swarm-${Date.now()}`,
          name: `test-swarm-${Date.now()}`,
          status: "ACTIVE",
          instanceType: "XL",
          repositoryName: "test-repo",
          repositoryUrl: "https://github.com/test-owner/test-repo",
          defaultBranch: "main",
          swarmApiKey: encryptedSwarmApiKey,
          swarmUrl: "https://test-swarm.example.com/api",
          swarmSecretAlias: "test-secret",
          poolName: "test-pool",
          environmentVariables: [],
          services: [],
          workspaceId: workspace.id,
        },
      });

      return { workspace, swarm };
    });
  },

  createWorkspaceMember: async (workspaceId: string, role = "DEVELOPER") => {
    const memberUser = await createTestUser({ name: "Member User" });

    await db.workspaceMember.create({
      data: {
        userId: memberUser.id,
        workspaceId,
        role,
      },
    });

    return memberUser;
  },

  mockStreamTextSuccess: () => {
    mockStreamText.mockReturnValue({
      toUIMessageStreamResponse: vi.fn(() => new Response("AI streaming response")),
    } as any);
  },

  mockFetchLearningsSuccess: () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { question: "Previous question", answer: "Previous answer" },
      ],
    } as Response);
  },
};

describe("GET /api/ask/quick Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  beforeEach(async () => {
    vi.clearAllMocks();
    IntegrationTestFactories.mockStreamTextSuccess();
  });

  describe("Authentication Tests", () => {
    test("should return 401 for unauthenticated request", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    test("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });
  });

  describe("Request Validation Tests", () => {
    test("should return 400 for missing question parameter", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick?workspace=test-workspace"
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Missing required parameter: question" });
    });

    test("should return 400 for missing workspace parameter", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test"
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Missing required parameter: workspace" });
    });
  });

  describe("Authorization Tests", () => {
    test("should return 403 for non-existent workspace", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=non-existent-workspace"
      );

      const response = await GET(request);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Workspace not found or access denied" });
    });

    test("should return 403 for workspace without user access", async () => {
      const ownerUser = await createTestUser({ name: "Owner User" });
      const { workspace } = await IntegrationTestFactories.createTestWorkspaceWithSwarm(ownerUser.id);

      const otherUser = await createTestUser({ name: "Other User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(otherUser));

      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=test&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Workspace not found or access denied" });
    });

    test("should allow access for workspace owner", async () => {
      const ownerUser = await createTestUser({ name: "Owner User" });
      const { workspace } = await IntegrationTestFactories.createTestWorkspaceWithSwarm(ownerUser.id);

      // Create GitHub auth record with token
      await db.gitHubAuth.create({
        data: {
          userId: ownerUser.id,
          githubUserId: "github-123",
          githubUsername: "owneruser",
          githubNodeId: "node-123",
          accountType: "User",
        },
      });

      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("access_token", "github_pat_test_token")
      );

      await db.account.create({
        data: {
          userId: ownerUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github-123",
          access_token: encryptedToken,
          token_type: "bearer",
          scope: "repo,user",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=test&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test("should allow access for workspace member", async () => {
      const ownerUser = await createTestUser({ name: "Owner User" });
      const { workspace } = await IntegrationTestFactories.createTestWorkspaceWithSwarm(ownerUser.id);

      const memberUser = await IntegrationTestFactories.createWorkspaceMember(workspace.id);

      // Create GitHub auth for member
      await db.gitHubAuth.create({
        data: {
          userId: memberUser.id,
          githubUserId: "github-456",
          githubUsername: "memberuser",
          githubNodeId: "node-456",
          accountType: "User",
        },
      });

      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("access_token", "github_pat_member_token")
      );

      await db.account.create({
        data: {
          userId: memberUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github-456",
          access_token: encryptedToken,
          token_type: "bearer",
          scope: "repo,user",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=test&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Configuration & Credentials Tests", () => {
    test("should return 404 when swarm not found for workspace", async () => {
      const testUser = await createTestUser({ name: "Test User" });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueId("test-workspace"),
          ownerId: testUser.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=test&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Swarm not found for this workspace" });
    });

    test("should return 404 when repository URL not configured", async () => {
      const testUser = await createTestUser({ name: "Test User" });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueId("test-workspace"),
          ownerId: testUser.id,
        },
      });

      const encryptedSwarmApiKey = JSON.stringify(
        encryptionService.encryptField("swarmApiKey", "test-key")
      );

      await db.swarm.create({
        data: {
          swarmId: `swarm-${Date.now()}`,
          name: "test-swarm",
          status: "ACTIVE",
          instanceType: "XL",
          repositoryName: "test-repo",
          repositoryUrl: null, // No repository URL
          defaultBranch: "main",
          swarmApiKey: encryptedSwarmApiKey,
          swarmUrl: "https://test-swarm.example.com/api",
          swarmSecretAlias: "test-secret",
          poolName: "test-pool",
          environmentVariables: [],
          services: [],
          workspaceId: workspace.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=test&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Repository URL not configured for this swarm",
      });
    });

    test("should return 404 when GitHub PAT not found", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const { workspace } = await IntegrationTestFactories.createTestWorkspaceWithSwarm(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=test&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "GitHub PAT not found for this user" });
    });

    test("should decrypt swarm API key correctly", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const { workspace, swarm } = await IntegrationTestFactories.createTestWorkspaceWithSwarm(testUser.id);

      await db.gitHubAuth.create({
        data: {
          userId: testUser.id,
          githubUserId: "github-789",
          githubUsername: "testuser",
          githubNodeId: "node-789",
          accountType: "User",
        },
      });

      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("access_token", "github_pat_test")
      );

      await db.account.create({
        data: {
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github-789",
          access_token: encryptedToken,
          token_type: "bearer",
          scope: "repo",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=test&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);

      // Verify swarm API key was decrypted (by checking endpoint didn't error)
      const decryptedKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey!);
      expect(decryptedKey).toBe("test-swarm-api-key");
    });
  });

  describe("Successful Request Tests", () => {
    test("should successfully process quick ask request", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const { workspace } = await IntegrationTestFactories.createTestWorkspaceWithSwarm(testUser.id);

      await db.gitHubAuth.create({
        data: {
          userId: testUser.id,
          githubUserId: "github-101",
          githubUsername: "testuser101",
          githubNodeId: "node-101",
          accountType: "User",
        },
      });

      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("access_token", "github_pat_101")
      );

      await db.account.create({
        data: {
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github-101",
          access_token: encryptedToken,
          token_type: "bearer",
          scope: "repo",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=How does this work?&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockStreamText).toHaveBeenCalled();
    });

    test("should pass correct parameters to streamText", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const { workspace } = await IntegrationTestFactories.createTestWorkspaceWithSwarm(testUser.id);

      await db.gitHubAuth.create({
        data: {
          userId: testUser.id,
          githubUserId: "github-202",
          githubUsername: "testuser202",
          githubNodeId: "node-202",
          accountType: "User",
        },
      });

      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("access_token", "github_pat_202")
      );

      await db.account.create({
        data: {
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github-202",
          access_token: encryptedToken,
          token_type: "bearer",
          scope: "repo",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const testQuestion = "What is the purpose of this repository?";
      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(testQuestion)}&workspace=${workspace.slug}`
      );

      await GET(request);

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ modelId: "claude-3-5-sonnet-20241022" }),
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({ role: "user", content: testQuestion }),
          ]),
        })
      );
    });
  });

  describe("Error Handling Tests", () => {
    test("should handle streaming errors gracefully", async () => {
      mockStreamText.mockImplementation(() => {
        throw new Error("AI service unavailable");
      });

      const testUser = await createTestUser({ name: "Test User" });
      const { workspace } = await IntegrationTestFactories.createTestWorkspaceWithSwarm(testUser.id);

      await db.gitHubAuth.create({
        data: {
          userId: testUser.id,
          githubUserId: "github-303",
          githubUsername: "testuser303",
          githubNodeId: "node-303",
          accountType: "User",
        },
      });

      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("access_token", "github_pat_303")
      );

      await db.account.create({
        data: {
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github-303",
          access_token: encryptedToken,
          token_type: "bearer",
          scope: "repo",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=test&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to create stream" });
    });
  });

  describe("Edge Cases Tests", () => {
    test("should handle very long questions", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const { workspace } = await IntegrationTestFactories.createTestWorkspaceWithSwarm(testUser.id);

      await db.gitHubAuth.create({
        data: {
          userId: testUser.id,
          githubUserId: "github-404",
          githubUsername: "testuser404",
          githubNodeId: "node-404",
          accountType: "User",
        },
      });

      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("access_token", "github_pat_404")
      );

      await db.account.create({
        data: {
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github-404",
          access_token: encryptedToken,
          token_type: "bearer",
          scope: "repo",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const longQuestion = "a".repeat(5000);
      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(longQuestion)}&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: longQuestion }),
          ]),
        })
      );
    });

    test("should handle special characters in question", async () => {
      const testUser = await createTestUser({ name: "Test User" });
      const { workspace } = await IntegrationTestFactories.createTestWorkspaceWithSwarm(testUser.id);

      await db.gitHubAuth.create({
        data: {
          userId: testUser.id,
          githubUserId: "github-505",
          githubUsername: "testuser505",
          githubNodeId: "node-505",
          accountType: "User",
        },
      });

      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("access_token", "github_pat_505")
      );

      await db.account.create({
        data: {
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github-505",
          access_token: encryptedToken,
          token_type: "bearer",
          scope: "repo",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const specialQuestion = "What about this? & that < > \" ' 日本語";
      const request = createGetRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(specialQuestion)}&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });
});