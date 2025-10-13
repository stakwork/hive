import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/ask/quick/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { RepositoryStatus } from "@prisma/client";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import type { User, Workspace, Swarm, Repository } from "@prisma/client";

// Mock external AI services
vi.mock("ai", () => ({
  streamText: vi.fn(),
  hasToolCall: vi.fn(),
}));

vi.mock("aieo", () => ({
  getModel: vi.fn(),
  getApiKeyForProvider: vi.fn(),
}));

vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn(),
}));

// Import mocked modules
import { streamText, hasToolCall } from "ai";
import { getModel, getApiKeyForProvider } from "aieo";
import { askTools } from "@/lib/ai/askTools";

const mockStreamText = vi.mocked(streamText);
const mockHasToolCall = vi.mocked(hasToolCall);
const mockGetModel = vi.mocked(getModel);
const mockGetApiKeyForProvider = vi.mocked(getApiKeyForProvider);
const mockAskTools = vi.mocked(askTools);

// Helper to create GET request with middleware headers
function createGetRequest(params: Record<string, string>, user?: User) {
  const url = new URL("http://localhost:3000/api/ask/quick");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  
  const headers: Record<string, string> = {
    [MIDDLEWARE_HEADERS.REQUEST_ID]: `req-${Date.now()}`,
  };
  
  if (user) {
    headers[MIDDLEWARE_HEADERS.AUTH_STATUS] = "authenticated";
    headers[MIDDLEWARE_HEADERS.USER_ID] = user.id;
    headers[MIDDLEWARE_HEADERS.USER_EMAIL] = user.email || "";
    headers[MIDDLEWARE_HEADERS.USER_NAME] = user.name || "";
  } else {
    headers[MIDDLEWARE_HEADERS.AUTH_STATUS] = "unauthenticated";
  }
  
  return new Request(url.toString(), { 
    method: "GET",
    headers: new Headers(headers)
  }) as any;
}

describe("GET /api/ask/quick - Integration Tests", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "swarm_api_key_test_integration";
  const PLAINTEXT_GITHUB_PAT = "github_pat_integration_test";

  let ownerUser: User;
  let developerUser: User;
  let viewerUser: User;
  let unauthorizedUser: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test scenario with users, workspace, swarm, and repository
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Owner User" },
      members: [
        { role: "DEVELOPER", user: { name: "Developer User" } },
        { role: "VIEWER", user: { name: "Viewer User" } },
      ],
      withSwarm: true,
      swarm: {
        name: "test-swarm",
        status: "ACTIVE",
      },
    });

    ownerUser = scenario.owner;
    workspace = scenario.workspace;
    swarm = scenario.swarm!;
    developerUser = scenario.members[0];
    viewerUser = scenario.members[1];

    // Create unauthorized user not in workspace
    unauthorizedUser = await db.user.create({
      data: {
        id: generateUniqueId("unauth"),
        email: `unauth-${generateUniqueId()}@example.com`,
        name: "Unauthorized User",
      },
    });

    // Update swarm with required fields
    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmUrl: "https://test-swarm.sphinx.chat/api",
        swarmApiKey: JSON.stringify(
          enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY),
        ),
      },
    });

    // Refresh swarm reference
    swarm = (await db.swarm.findUnique({ where: { id: swarm.id } }))!;

    // Create source control org and token for GitHub PAT
    const sourceControlOrg = await db.sourceControlOrg.create({
      data: {
        githubLogin: `test-org-${generateUniqueId()}`,
        githubInstallationId: Math.floor(Math.random() * 1000000),
        type: "ORG",
      },
    });

    await db.sourceControlToken.create({
      data: {
        userId: ownerUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        token: JSON.stringify(enc.encryptField("source_control_token", PLAINTEXT_GITHUB_PAT)),
        scopes: ["repo", "read:org"],
      },
    });

    await db.workspace.update({
      where: { id: workspace.id },
      data: { sourceControlOrgId: sourceControlOrg.id },
    });

    await db.gitHubAuth.create({
      data: {
        userId: ownerUser.id,
        githubUserId: "123456",
        githubUsername: "testuser",
      },
    });

    // Create repository for the workspace
    repository = await db.repository.create({
      data: {
        name: "test-repo",
        repositoryUrl: "https://github.com/test-org/test-repo",
        workspaceId: workspace.id,
        status: RepositoryStatus.SYNCED,
        branch: "main",
      },
    });

    // Setup AI service mocks with default behavior
    mockGetApiKeyForProvider.mockReturnValue("sk_test_anthropic_key");
    mockGetModel.mockResolvedValue({
      modelId: "claude-3-5-sonnet-20241022",
      provider: "anthropic",
    } as any);
    mockAskTools.mockReturnValue({
      get_learnings: {} as any,
      recent_commits: {} as any,
      recent_contributions: {} as any,
      web_search: {} as any,
      final_answer: {} as any,
    });
    mockHasToolCall.mockReturnValue(() => false);
    mockStreamText.mockReturnValue({
      toUIMessageStreamResponse: vi.fn().mockReturnValue(
        new Response("data: test\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    } as any);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 when session exists but user is missing", async () => {
      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should proceed with valid authenticated session", async () => {
      const request = createGetRequest({
        question: "How to test AI tools?",
        workspace: workspace.slug,
      }, ownerUser);

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Authorization", () => {
    test("should allow workspace owner to ask questions", async () => {
      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      }, ownerUser);

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test("should allow workspace developer to ask questions", async () => {
      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      }, developerUser);

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test("should allow workspace viewer to ask questions", async () => {
      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      }, viewerUser);

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test("should reject unauthorized user not in workspace", async () => {
      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      }, unauthorizedUser);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    test("should reject access to non-existent workspace", async () => {
      const request = createGetRequest({
        question: "How to test?",
        workspace: "non-existent-workspace",
      }, ownerUser);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Workspace not found or access denied");
    });
  });

  describe("Parameter Validation", () => {
    test("should return 400 when question parameter is missing", async () => {
      const request = createGetRequest({
        workspace: workspace.slug,
      }, ownerUser);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required parameter: question");
    });

    test("should return 400 when workspace parameter is missing", async () => {
      const request = createGetRequest({
        question: "How to test?",
      }, ownerUser);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required parameter: workspace");
    });

    test("should accept valid question and workspace parameters", async () => {
      const request = createGetRequest({
        question: "How to write unit tests?",
        workspace: workspace.slug,
      }, ownerUser);

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test("should handle URL-encoded question parameters", async () => {
      const request = createGetRequest({
        question: "How to test <script>alert('xss')</script>?",
        workspace: workspace.slug,
      }, ownerUser);

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Resource Validation", () => {
    test("should return 404 when workspace has no swarm", async () => {
      await db.swarm.delete({ where: { id: swarm.id } });

      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      }, ownerUser);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found for this workspace");
    });

    test("should return 404 when swarm URL is not configured", async () => {
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: null },
      });

      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm URL not configured");
    });

    test("should return 404 when repository URL is not configured", async () => {
      await db.repository.delete({ where: { id: repository.id } });

      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Repository URL not configured for this swarm");
    });

    test("should return 404 when GitHub PAT is not found", async () => {
      await db.sourceControlToken.deleteMany({
        where: { userId: ownerUser.id },
      });

      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("GitHub PAT not found for this user");
    });
  });

  describe("AI Orchestration", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));
    });

    test("should call askTools with correct parameters", async () => {
      const request = createGetRequest({
        question: "How to write tests?",
        workspace: workspace.slug,
      });

      await GET(request);

      expect(mockAskTools).toHaveBeenCalledWith(
        expect.stringContaining("test-swarm.sphinx.chat"),
        PLAINTEXT_SWARM_API_KEY,
        "https://github.com/test-org/test-repo",
        PLAINTEXT_GITHUB_PAT,
        "sk_test_anthropic_key",
      );
    });

    test("should call getModel with anthropic provider", async () => {
      const request = createGetRequest({
        question: "How to write tests?",
        workspace: workspace.slug,
      });

      await GET(request);

      expect(mockGetApiKeyForProvider).toHaveBeenCalledWith("anthropic");
      expect(mockGetModel).toHaveBeenCalledWith(
        "anthropic",
        "sk_test_anthropic_key",
        workspace.slug,
      );
    });

    test("should call streamText with correct configuration", async () => {
      const question = "How to write integration tests?";
      const request = createGetRequest({
        question,
        workspace: workspace.slug,
      });

      await GET(request);

      expect(mockStreamText).toHaveBeenCalledWith({
        model: expect.objectContaining({ modelId: "claude-3-5-sonnet-20241022" }),
        tools: expect.any(Object),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({ role: "user", content: question }),
        ]),
        stopWhen: expect.any(Function),
        onStepFinish: expect.any(Function),
      });
    });

    test("should return streaming response", async () => {
      const request = createGetRequest({
        question: "How to write tests?",
        workspace: workspace.slug,
      });

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    });

    test("should construct correct swarm URL for localhost", async () => {
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: "http://localhost:3000/api" },
      });

      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      await GET(request);

      expect(mockAskTools).toHaveBeenCalledWith(
        "http://localhost:3355",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
    });

    test("should construct correct swarm URL for production", async () => {
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: "https://production-swarm.sphinx.chat/api" },
      });

      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      await GET(request);

      expect(mockAskTools).toHaveBeenCalledWith(
        "https://production-swarm.sphinx.chat:3355",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
    });
  });

  describe("Encryption Handling", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));
    });

    test("should decrypt swarm API key before passing to askTools", async () => {
      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      await GET(request);

      // Verify the decrypted key was passed (not the encrypted JSON)
      expect(mockAskTools).toHaveBeenCalledWith(
        expect.any(String),
        PLAINTEXT_SWARM_API_KEY,
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );

      // Verify the encrypted key is still stored in database
      const storedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });

      expect(storedSwarm?.swarmApiKey).not.toContain(PLAINTEXT_SWARM_API_KEY);
    });

    test("should decrypt GitHub PAT before passing to askTools", async () => {
      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      await GET(request);

      // Verify the decrypted PAT was passed
      expect(mockAskTools).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        PLAINTEXT_GITHUB_PAT,
        expect.any(String),
      );

      // Verify the encrypted token is still stored in database
      const storedToken = await db.sourceControlToken.findFirst({
        where: { userId: ownerUser.id },
      });

      expect(storedToken?.token).not.toContain(PLAINTEXT_GITHUB_PAT);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));
    });

    test("should return 500 when streamText throws error", async () => {
      mockStreamText.mockImplementation(() => {
        throw new Error("AI service unavailable");
      });

      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create stream");
    });

    test("should return 500 when database query fails", async () => {
      vi.spyOn(db.swarm, "findFirst").mockRejectedValue(
        new Error("Database connection failed"),
      );

      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process quick ask");
    });

    test("should handle encryption service errors", async () => {
      vi.spyOn(EncryptionService.getInstance(), "decryptField").mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process quick ask");
    });

    test("should not expose sensitive data in error responses", async () => {
      mockStreamText.mockImplementation(() => {
        throw new Error(`AI error: API key ${PLAINTEXT_SWARM_API_KEY} invalid`);
      });

      const request = createGetRequest({
        question: "How to test?",
        workspace: workspace.slug,
      });

      const response = await GET(request);
      const responseText = await response.text();

      expect(responseText).not.toContain(PLAINTEXT_SWARM_API_KEY);
      expect(responseText).not.toContain(PLAINTEXT_GITHUB_PAT);
    });
  });

  describe("End-to-End Flow", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));
    });

    test("should complete full ask flow with all components", async () => {
      const question = "How to write comprehensive integration tests?";
      const request = createGetRequest({
        question,
        workspace: workspace.slug,
      });

      const response = await GET(request);

      // Verify response
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");

      // Verify all services were called in correct order
      expect(mockGetApiKeyForProvider).toHaveBeenCalledWith("anthropic");
      expect(mockGetModel).toHaveBeenCalled();
      expect(mockAskTools).toHaveBeenCalledWith(
        expect.stringContaining("test-swarm"),
        PLAINTEXT_SWARM_API_KEY,
        "https://github.com/test-org/test-repo",
        PLAINTEXT_GITHUB_PAT,
        "sk_test_anthropic_key",
      );
      expect(mockStreamText).toHaveBeenCalled();

      // Verify database state unchanged (no mutations)
      const finalSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });
      expect(finalSwarm?.swarmApiKey).toBe(swarm.swarmApiKey);
    });
  });
});