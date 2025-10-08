import { describe, test, beforeEach, vi, expect } from "vitest";
import { GET } from "@/app/api/ask/quick/route";
import {
  createAuthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
  expectForbidden,
  createGetRequest,
} from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspaceScenario,
  resetDatabase,
} from "@/__tests__/support/fixtures";
import { 
  createSwarmWithEncryptedApiKey, 
  DEFAULT_TEST_API_KEY 
} from "@/__tests__/support/helpers/swarm-encryption";

// Mock external dependencies at module level
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/encryption", async () => {
  const actual = await vi.importActual("@/lib/encryption");
  return {
    ...actual,
    EncryptionService: {
      getInstance: vi.fn().mockReturnValue({
        encryptField: vi.fn().mockReturnValue({
          data: "encrypted_data",
          iv: "mock_iv", 
          tag: "mock_tag",
          keyId: "test",
          version: "1",
          encryptedAt: new Date().toISOString(),
        }),
        decryptField: vi.fn().mockReturnValue("decrypted-api-key"),
      }),
    },
  };
});

vi.mock("@/lib/auth/nextauth", async () => {
  const actual = await vi.importActual("@/lib/auth/nextauth");
  return {
    ...actual,
    getGithubUsernameAndPAT: vi.fn().mockResolvedValue({
      username: "testuser",
      token: "test-pat-token",
    }),
  };
});

vi.mock("aieo", () => ({
  getApiKeyForProvider: vi.fn().mockReturnValue("anthropic-key"),
  getModel: vi.fn().mockResolvedValue({
    modelId: "claude-3-5-sonnet-20241022",
  }),
}));

vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn().mockReturnValue({
    get_learnings: { name: "get_learnings" },
    recent_commits: { name: "recent_commits" },
    recent_contributions: { name: "recent_contributions" },
    web_search: { name: "web_search" },
    final_answer: { name: "final_answer" },
  }),
}));

vi.mock("ai", () => ({
  streamText: vi.fn().mockResolvedValue({
    toUIMessageStreamResponse: vi.fn().mockReturnValue(
      new Response("Mock AI stream response", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    ),
  }),
  hasToolCall: vi.fn().mockReturnValue(() => false),
}));

describe("GET /api/ask/quick", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does this work?",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does this work?",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectUnauthorized(response);
    });
  });

  describe("Parameter Validation", () => {
    test("returns 400 when question parameter is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost/api/ask/quick", {
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectError(response, "Missing required parameter: question", 400);
    });

    test("returns 400 when workspace parameter is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does this work?",
      });

      const response = await GET(request);
      await expectError(response, "Missing required parameter: workspace", 400);
    });
  });

  describe("Authorization", () => {
    test("returns 403 when user lacks workspace access", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: false,
      });

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does this work?",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectForbidden(response, "access denied");
    });
  });

  describe("Configuration Validation", () => {
    test("returns 404 when swarm configuration not found", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        workspaceOptions: { slug: "test-workspace" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      });

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does authentication work?",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectNotFound(response, "Swarm not found");
    });

    test("returns 404 when swarm URL not configured", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        workspaceOptions: { slug: "test-workspace" },
      });

      // Create swarm without swarmUrl using helper
      const { db } = await import("@/lib/db");
      const swarmData = createSwarmWithEncryptedApiKey({
        workspaceId: workspace.id,
        swarmUrl: "https://swarm.example.com",
        swarmApiKey: DEFAULT_TEST_API_KEY,
        repositoryUrl: "https://github.com/test/repo",
        name: "Test Swarm",
      });

      await db.swarm.create({
        data: {
          ...swarmData,
          swarmUrl: null, // Override to test the null case
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      });

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does authentication work?",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectNotFound(response, "Swarm URL not configured");
    });

    test("returns 404 when repository URL not configured", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        workspaceOptions: { slug: "test-workspace" },
      });

      // Create swarm without repositoryUrl using helper
      const { db } = await import("@/lib/db");
      const swarmData = createSwarmWithEncryptedApiKey({
        workspaceId: workspace.id,
        swarmUrl: "https://swarm.example.com",
        swarmApiKey: DEFAULT_TEST_API_KEY,
        repositoryUrl: "https://github.com/test/repo",
        name: "Test Swarm",
      });

      await db.swarm.create({
        data: {
          ...swarmData,
          repositoryUrl: null, // Override to test null case
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      });

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does authentication work?",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectNotFound(response, "Repository URL not configured");
    });

    test("returns 404 when GitHub PAT not found", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        workspaceOptions: { slug: "test-workspace" },
      });

      // Create swarm with all required fields using helper
      const { db } = await import("@/lib/db");
      const swarmData = createSwarmWithEncryptedApiKey({
        workspaceId: workspace.id,
        swarmUrl: "https://swarm.example.com", 
        swarmApiKey: DEFAULT_TEST_API_KEY,
        repositoryUrl: "https://github.com/test/repo",
        name: "Test Swarm",
      });

      await db.swarm.create({
        data: swarmData,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      });

      // Mock getGithubUsernameAndPAT to return null (no PAT)
      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      (getGithubUsernameAndPAT as any).mockResolvedValue(null);

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does authentication work?",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectNotFound(response, "GitHub PAT not found");
    });
  });

  describe("Successful AI Processing", () => {
    test("successfully processes question with valid inputs", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        workspaceOptions: { slug: "test-workspace" },
      });

      // Create swarm with all required configuration using helper
      const { db } = await import("@/lib/db");
      const swarmData = createSwarmWithEncryptedApiKey({
        workspaceId: workspace.id,
        swarmUrl: "https://swarm.example.com",
        swarmApiKey: DEFAULT_TEST_API_KEY,
        repositoryUrl: "https://github.com/test/repo",
        name: "Test Swarm",
      });

      await db.swarm.create({
        data: swarmData,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      });

      // Restore default mock for getGithubUsernameAndPAT
      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      (getGithubUsernameAndPAT as any).mockResolvedValue({
        username: "testuser",
        token: "test-pat-token",
      });

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does authentication work?",
        workspace: "test-workspace",
      });

      const response = await GET(request);

      // Verify streaming response
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
    });

    test("handles localhost swarm URL correctly", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        workspaceOptions: { slug: "test-workspace" },
      });

      const { db } = await import("@/lib/db");
      const swarmData = createSwarmWithEncryptedApiKey({
        workspaceId: workspace.id,
        swarmUrl: "http://localhost:3355",
        swarmApiKey: DEFAULT_TEST_API_KEY,
        repositoryUrl: "https://github.com/test/repo",
        name: "Test Swarm",
      });

      await db.swarm.create({
        data: swarmData,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      });

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "What are recent commits?",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
    });
  });

  describe("Tool Setup Verification", () => {
    test("calls AI tools with correct parameters", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        workspaceOptions: { slug: "test-workspace" },
      });

      const { db } = await import("@/lib/db");
      const swarmData = createSwarmWithEncryptedApiKey({
        workspaceId: workspace.id,
        swarmUrl: "https://swarm.example.com",
        swarmApiKey: DEFAULT_TEST_API_KEY,
        repositoryUrl: "https://github.com/test/repo",
        name: "Test Swarm",
      });

      await db.swarm.create({
        data: swarmData,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      });

      const { askTools } = await import("@/lib/ai/askTools");
      const { streamText } = await import("ai");

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "What are recent commits?",
        workspace: "test-workspace",
      });

      await GET(request);

      // Verify askTools was called with correct parameters
      expect(askTools).toHaveBeenCalledWith(
        expect.stringContaining("swarm.example.com"),
        "decrypted-api-key",
        "https://github.com/test/repo",
        "test-pat-token",
        "anthropic-key"
      );

      // Verify streamText was called with correct configuration
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            modelId: "claude-3-5-sonnet-20241022",
          }),
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "system",
              content: expect.stringContaining("learning assistant"),
            }),
            expect.objectContaining({
              role: "user",
              content: "What are recent commits?",
            }),
          ]),
          tools: expect.objectContaining({
            get_learnings: expect.any(Object),
            recent_commits: expect.any(Object),
            recent_contributions: expect.any(Object),
            web_search: expect.any(Object),
            final_answer: expect.any(Object),
          }),
        })
      );
    });

    test("verifies encryption service decrypts swarm API key", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        workspaceOptions: { slug: "test-workspace" },
      });

      const { db } = await import("@/lib/db");
      const swarmData = createSwarmWithEncryptedApiKey({
        workspaceId: workspace.id,
        swarmUrl: "https://swarm.example.com",
        swarmApiKey: DEFAULT_TEST_API_KEY,
        repositoryUrl: "https://github.com/test/repo",
        name: "Test Swarm",
      });

      await db.swarm.create({
        data: swarmData,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      });

      const mockEncryptionInstance = {
        decryptField: vi.fn().mockReturnValue("decrypted-api-key"),
      };
      const { EncryptionService: MockedEncryptionService } = await import("@/lib/encryption");
      (MockedEncryptionService.getInstance as any).mockReturnValue(mockEncryptionInstance);

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does authentication work?",
        workspace: "test-workspace",
      });

      await GET(request);

      expect(mockEncryptionInstance.decryptField).toHaveBeenCalledWith(
        "swarmApiKey",
        expect.any(String)
      );
    });
  });

  describe("Error Handling", () => {
    test("returns 500 when streamText fails", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        workspaceOptions: { slug: "test-workspace" },
      });

      const { db } = await import("@/lib/db");
      const swarmData = createSwarmWithEncryptedApiKey({
        workspaceId: workspace.id,
        swarmUrl: "https://swarm.example.com",
        swarmApiKey: DEFAULT_TEST_API_KEY,
        repositoryUrl: "https://github.com/test/repo",
        name: "Test Swarm",
      });

      await db.swarm.create({
        data: swarmData,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      });

      // Mock streamText to throw an error
      const { streamText } = await import("ai");
      (streamText as any).mockRejectedValueOnce(new Error("AI service unavailable"));

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does authentication work?",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectError(response, "Failed to create stream", 500);
    });

    test("handles general errors gracefully", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockRejectedValueOnce(new Error("Database connection error"));

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "How does this work?",
        workspace: "test-workspace",
      });

      const response = await GET(request);
      await expectError(response, "Failed to process quick ask", 500);
    });
  });

  describe("GitHub Integration", () => {
    test("retrieves GitHub credentials for workspace", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        workspaceOptions: { slug: "test-workspace" },
      });

      const { db } = await import("@/lib/db");
      const swarmData = createSwarmWithEncryptedApiKey({
        workspaceId: workspace.id,
        swarmUrl: "https://swarm.example.com",
        swarmApiKey: DEFAULT_TEST_API_KEY,
        repositoryUrl: "https://github.com/test/repo",
        name: "Test Swarm",
      });

      await db.swarm.create({
        data: swarmData,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { validateWorkspaceAccess } = await import("@/services/workspace");
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      });

      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      const mockGetGithubPAT = getGithubUsernameAndPAT as any;
      mockGetGithubPAT.mockResolvedValue({
        username: "testuser",
        token: "test-pat-token",
      });

      const request = createGetRequest("http://localhost/api/ask/quick", {
        question: "What are recent commits?",
        workspace: "test-workspace",
      });

      await GET(request);

      expect(mockGetGithubPAT).toHaveBeenCalledWith(owner.id, workspace.slug);
    });
  });
});