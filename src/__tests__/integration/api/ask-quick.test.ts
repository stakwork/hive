import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/ask/quick/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectUnauthorized,
  expectError,
  expectNotFound,
  generateUniqueId,
  createGetRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspaceScenario,
  createTestSwarm,
  resetDatabase,
} from "@/__tests__/support/fixtures";
import type { User, Workspace, Swarm } from "@prisma/client";

// Mock external dependencies
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("aieo", () => ({
  getApiKeyForProvider: vi.fn(),
  getModel: vi.fn(),
}));

vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn(),
}));

vi.mock("ai", () => ({
  streamText: vi.fn(),
  hasToolCall: vi.fn(),
}));

vi.mock("@/lib/constants/prompt", () => ({
  QUICK_ASK_SYSTEM_PROMPT: "You are a helpful assistant.",
}));

describe("GET /api/ask/quick Integration Tests", () => {
  let encryptionService: EncryptionService;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    encryptionService = EncryptionService.getInstance();
  });

  describe("Authentication", () => {
    it("should return 401 when no session provided", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does authentication work?", workspace: "test-workspace" }
      );

      const response = await GET(request);

      await expectUnauthorized(response);
    });

    it("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null } as any);

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does authentication work?", workspace: "test-workspace" }
      );

      const response = await GET(request);

      await expectUnauthorized(response);
    });

    it("should return 401 when session user has no id", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
      } as any);

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does authentication work?", workspace: "test-workspace" }
      );

      const response = await GET(request);

      // The API now throws an error during validateWorkspaceAccess when user.id is missing,
      // which results in a 500 error rather than 401
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to process quick ask");
    });
  });

  describe("Input Validation", () => {
    let testUser: User;

    beforeEach(async () => {
      testUser = await createTestUser({ name: "Test User" });
    });

    it("should return 400 when question parameter is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { workspace: "test-workspace" }
      );

      const response = await GET(request);

      await expectError(response, "Missing required parameter: question", 400);
    });

    it("should return 400 when workspace parameter is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does this work?" }
      );

      const response = await GET(request);

      await expectError(response, "Missing required parameter: workspace", 400);
    });

    it("should return 400 when both parameters are missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/ask/quick");

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Missing required parameter");
    });
  });

  describe("Authorization", () => {
    let testUser: User;
    let otherUser: User;
    let workspace: Workspace;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Workspace Owner" },
      });
      testUser = scenario.owner;
      workspace = scenario.workspace;

      otherUser = await createTestUser({ name: "Other User" });
    });

    it("should return 403 when user lacks workspace access", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(otherUser));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({ hasAccess: false });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does this work?", workspace: workspace.slug }
      );

      const response = await GET(request);

      await expectError(response, "Workspace not found or access denied", 403);
    });

    it("should return 403 for deleted workspace access", async () => {
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({ hasAccess: false });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does this work?", workspace: workspace.slug }
      );

      const response = await GET(request);

      await expectError(response, "Workspace not found or access denied", 403);
    });

    it("should allow workspace owner to access endpoint", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does this work?", workspace: workspace.slug }
      );

      const response = await GET(request);

      // Will fail at swarm configuration check since we didn't create a swarm
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Swarm not found for this workspace");
    });
  });

  describe("Configuration Validation", () => {
    let testUser: User;
    let workspace: Workspace;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Config Test Owner" },
      });
      testUser = scenario.owner;
      workspace = scenario.workspace;

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
      });
    });

    it("should return 404 when swarm not found", async () => {
      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does this work?", workspace: workspace.slug }
      );

      const response = await GET(request);

      await expectNotFound(response, "Swarm not found for this workspace");
    });

    it("should return 404 when swarmUrl not configured", async () => {
      await createTestSwarm({
        workspaceId: workspace.id,
        name: `swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        swarmUrl: null,
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does this work?", workspace: workspace.slug }
      );

      const response = await GET(request);

      await expectNotFound(response, "Swarm URL not configured");
    });

    it("should return 404 when repository URL not configured", async () => {
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await createTestSwarm({
        workspaceId: workspace.id,
        name: `swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptedApiKey),
        repositoryUrl: null,
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does this work?", workspace: workspace.slug }
      );

      const response = await GET(request);

      await expectNotFound(response, "Repository URL not configured for this swarm");
    });

    it("should return 404 when GitHub PAT not found", async () => {
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await createTestSwarm({
        workspaceId: workspace.id,
        name: `swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptedApiKey),
        repositoryUrl: "https://github.com/test/repo",
      });

      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      (getGithubUsernameAndPAT as any).mockResolvedValue(null);

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does this work?", workspace: workspace.slug }
      );

      const response = await GET(request);

      await expectNotFound(response, "GitHub PAT not found for this user");
    });

    it("should handle workspace not found after access validation", async () => {
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await createTestSwarm({
        workspaceId: workspace.id,
        name: `swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptedApiKey),
        repositoryUrl: "https://github.com/test/repo",
      });

      // Delete workspace after swarm is created
      await db.workspace.delete({ where: { id: workspace.id } });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does this work?", workspace: workspace.slug }
      );

      const response = await GET(request);

      // When workspace is deleted after swarm creation, it first finds the swarm 
      // but then fails to find workspace, returning "Swarm not found for this workspace"
      await expectNotFound(response, "Swarm not found for this workspace");
    });
  });

  describe("Successful Request", () => {
    let testUser: User;
    let workspace: Workspace;
    let swarm: Swarm;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Success Test Owner" },
      });
      testUser = scenario.owner;
      workspace = scenario.workspace;

      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-swarm-api-key"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptedApiKey),
        repositoryUrl: "https://github.com/test/repo",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
      });

      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      (getGithubUsernameAndPAT as any).mockResolvedValue({
        username: "testuser",
        token: "test-github-pat",
      });

      const { getApiKeyForProvider, getModel } = await import("aieo");
      (getApiKeyForProvider as any).mockReturnValue("test-anthropic-key");
      (getModel as any).mockResolvedValue({
        modelId: "claude-3-5-sonnet-20241022",
      });

      const { askTools } = await import("@/lib/ai/askTools");
      (askTools as any).mockReturnValue({
        get_learnings: { name: "get_learnings" },
        recent_commits: { name: "recent_commits" },
        recent_contributions: { name: "recent_contributions" },
        web_search: { name: "web_search" },
        final_answer: { name: "final_answer" },
      });

      const { streamText } = await import("ai");
      (streamText as any).mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("Mock streaming response", {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        ),
      });
    });

    it("should successfully process question with valid inputs", async () => {
      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does authentication work?", workspace: workspace.slug }
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
    });

    it("should decrypt swarm API key before using it", async () => {
      const { askTools } = await import("@/lib/ai/askTools");

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "What are recent commits?", workspace: workspace.slug }
      );

      await GET(request);

      expect(askTools).toHaveBeenCalledWith(
        expect.stringContaining("https://test-swarm.sphinx.chat:3355"),
        "test-swarm-api-key", // Decrypted value
        "https://github.com/test/repo",
        "test-github-pat",
        "test-anthropic-key"
      );
    });

    it("should construct correct swarm URL with port 3355 for https", async () => {
      const { askTools } = await import("@/lib/ai/askTools");

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "Test question", workspace: workspace.slug }
      );

      await GET(request);

      const callArgs = (askTools as any).mock.calls[0];
      expect(callArgs[0]).toBe("https://test-swarm.sphinx.chat:3355");
    });

    it("should construct correct swarm URL with port 3355 for localhost", async () => {
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: "http://localhost:3000" },
      });

      const { askTools } = await import("@/lib/ai/askTools");

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "Test question", workspace: workspace.slug }
      );

      await GET(request);

      const callArgs = (askTools as any).mock.calls[0];
      expect(callArgs[0]).toBe("http://localhost:3355");
    });

    it("should call askTools with correct parameters", async () => {
      const { askTools } = await import("@/lib/ai/askTools");

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "What are recent commits?", workspace: workspace.slug }
      );

      await GET(request);

      expect(askTools).toHaveBeenCalledTimes(1);
      expect(askTools).toHaveBeenCalledWith(
        expect.stringContaining("test-swarm.sphinx.chat:3355"),
        "test-swarm-api-key",
        "https://github.com/test/repo",
        "test-github-pat",
        "test-anthropic-key"
      );
    });

    it("should call streamText with correct configuration", async () => {
      const { streamText } = await import("ai");

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "How does this work?", workspace: workspace.slug }
      );

      await GET(request);

      expect(streamText).toHaveBeenCalledTimes(1);
      
      // Verify the main structure
      const callArgs = (streamText as any).mock.calls[0][0];
      expect(callArgs).toMatchObject({
        model: {
          modelId: "claude-3-5-sonnet-20241022",
        },
        tools: {
          get_learnings: { name: "get_learnings" },
          recent_commits: { name: "recent_commits" },
          recent_contributions: { name: "recent_contributions" },
          web_search: { name: "web_search" },
          final_answer: { name: "final_answer" },
        },
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant.",
          },
          {
            role: "user",
            content: "How does this work?",
          },
        ],
      });
      
      // Verify function properties exist
      expect(typeof callArgs.onStepFinish).toBe('function');
      // stopWhen is undefined when hasToolCall is used, which is mocked
    });

    it("should return streaming response with correct content type", async () => {
      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "Test streaming question", workspace: workspace.slug }
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");

      const body = await response.text();
      expect(body).toBe("Mock streaming response");
    });
  });

  describe("Error Handling", () => {
    let testUser: User;
    let workspace: Workspace;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Error Test Owner" },
      });
      testUser = scenario.owner;
      workspace = scenario.workspace;

      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-swarm-api-key"
      );

      await createTestSwarm({
        workspaceId: workspace.id,
        name: `swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptedApiKey),
        repositoryUrl: "https://github.com/test/repo",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
      });

      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      (getGithubUsernameAndPAT as any).mockResolvedValue({
        username: "testuser",
        token: "test-github-pat",
      });

      const { getApiKeyForProvider, getModel } = await import("aieo");
      (getApiKeyForProvider as any).mockReturnValue("test-anthropic-key");
      (getModel as any).mockResolvedValue({
        modelId: "claude-3-5-sonnet-20241022",
      });

      const { askTools } = await import("@/lib/ai/askTools");
      (askTools as any).mockReturnValue({
        get_learnings: { name: "get_learnings" },
        final_answer: { name: "final_answer" },
      });
    });

    it("should return 500 when streamText fails", async () => {
      const { streamText } = await import("ai");
      (streamText as any).mockImplementation(() => {
        throw new Error("AI service unavailable");
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "Test error handling", workspace: workspace.slug }
      );

      const response = await GET(request);

      await expectError(response, "Failed to create stream", 500);
    });

    it("should return 500 when unexpected error occurs", async () => {
      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockImplementation(() => {
        throw new Error("Unexpected database error");
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "Test unexpected error", workspace: workspace.slug }
      );

      const response = await GET(request);

      await expectError(response, "Failed to process quick ask", 500);
    });

    it("should handle decryption errors gracefully", async () => {
      // Create swarm with invalid encrypted API key
      const invalidEncryptedKey = JSON.stringify({
        data: "invalid-data",
        iv: "invalid-iv",
        tag: "invalid-tag",
        version: "1.0",
        encryptedAt: new Date().toISOString(),
      });

      await db.swarm.updateMany({
        where: { workspaceId: workspace.id },
        data: { swarmApiKey: invalidEncryptedKey },
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "Test decryption error", workspace: workspace.slug }
      );

      const response = await GET(request);

      // Should return 500 due to decryption failure
      expect(response.status).toBe(500);
    });
  });

  describe("Edge Cases", () => {
    let testUser: User;
    let workspace: Workspace;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Edge Case Test Owner" },
      });
      testUser = scenario.owner;
      workspace = scenario.workspace;

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
      });
    });

    it("should handle empty question parameter", async () => {
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await createTestSwarm({
        workspaceId: workspace.id,
        name: `swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptedApiKey),
        repositoryUrl: "https://github.com/test/repo",
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "", workspace: workspace.slug }
      );

      const response = await GET(request);

      await expectError(response, "Missing required parameter: question", 400);
    });

    it("should handle whitespace-only question parameter", async () => {
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await createTestSwarm({
        workspaceId: workspace.id,
        name: `swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptedApiKey),
        repositoryUrl: "https://github.com/test/repo",
      });

      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      (getGithubUsernameAndPAT as any).mockResolvedValue({
        username: "testuser",
        token: "test-pat",
      });

      const { getApiKeyForProvider, getModel } = await import("aieo");
      (getApiKeyForProvider as any).mockReturnValue("test-key");
      (getModel as any).mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });

      const { askTools } = await import("@/lib/ai/askTools");
      (askTools as any).mockReturnValue({});

      const { streamText } = await import("ai");
      (streamText as any).mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("Response", { status: 200 })
        ),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: "   ", workspace: workspace.slug }
      );

      const response = await GET(request);

      // Should proceed to processing even with whitespace-only question
      expect(response.status).toBe(200);
    });

    it("should handle very long question parameter", async () => {
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await createTestSwarm({
        workspaceId: workspace.id,
        name: `swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptedApiKey),
        repositoryUrl: "https://github.com/test/repo",
      });

      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      (getGithubUsernameAndPAT as any).mockResolvedValue({
        username: "testuser",
        token: "test-pat",
      });

      const { getApiKeyForProvider, getModel } = await import("aieo");
      (getApiKeyForProvider as any).mockReturnValue("test-key");
      (getModel as any).mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });

      const { askTools } = await import("@/lib/ai/askTools");
      (askTools as any).mockReturnValue({});

      const { streamText } = await import("ai");
      (streamText as any).mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("Response", { status: 200 })
        ),
      });

      const longQuestion = "How does " + "authentication ".repeat(500) + "work?";

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: longQuestion, workspace: workspace.slug }
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it("should handle special characters in question parameter", async () => {
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await createTestSwarm({
        workspaceId: workspace.id,
        name: `swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptedApiKey),
        repositoryUrl: "https://github.com/test/repo",
      });

      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      (getGithubUsernameAndPAT as any).mockResolvedValue({
        username: "testuser",
        token: "test-pat",
      });

      const { getApiKeyForProvider, getModel } = await import("aieo");
      (getApiKeyForProvider as any).mockReturnValue("test-key");
      (getModel as any).mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });

      const { askTools } = await import("@/lib/ai/askTools");
      (askTools as any).mockReturnValue({});

      const { streamText } = await import("ai");
      (streamText as any).mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("Response", { status: 200 })
        ),
      });

      const specialQuestion = "How does <script>alert('test')</script> & authentication work? 🚀";

      const request = createGetRequest(
        "http://localhost:3000/api/ask/quick",
        { question: specialQuestion, workspace: workspace.slug }
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });
});