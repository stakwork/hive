import { describe, test, beforeEach, vi, expect, afterEach } from "vitest";
import { GET } from "@/app/api/ask/quick/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
  createTestRepository,
} from "@/__tests__/support/fixtures";
import {
  createGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm, Repository } from "@prisma/client";
import { NextResponse } from "next/server";

// Mock middleware utilities
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

// Mock workspace service
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

// Mock GitHub auth utilities
vi.mock("@/lib/auth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

// Mock repository helpers
vi.mock("@/lib/helpers/repository", () => ({
  getPrimaryRepository: vi.fn(),
}));

// Mock aieo package
vi.mock("aieo", () => ({
  getApiKeyForProvider: vi.fn(),
  getModel: vi.fn(),
}));

// Mock AI tools
vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn(),
}));

// Mock Vercel AI SDK
vi.mock("ai", () => ({
  streamText: vi.fn(),
  hasToolCall: vi.fn(),
}));

describe("GET /api/ask/quick - Integration Tests", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;
  let memberViewer: User;
  let memberDeveloper: User;
  let memberAdmin: User;
  let nonMember: User;

  beforeEach(async () => {
    vi.clearAllMocks();

    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Quick Ask Owner" },
      members: [
        { role: "VIEWER" },
        { role: "DEVELOPER" },
        { role: "ADMIN" },
      ],
    });

    owner = scenario.owner;
    workspace = scenario.workspace;
    memberViewer = scenario.members[0];
    memberDeveloper = scenario.members[1];
    memberAdmin = scenario.members[2];

    // Create swarm with encrypted API key
    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField(
      "swarmApiKey",
      "test-swarm-api-key"
    );

    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `test-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
    });

    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });

    // Create repository
    repository = await createTestRepository({
      workspaceId: workspace.id,
      name: "Test Repository",
      repositoryUrl: "https://github.com/test/repo",
      branch: "main",
    });

    // Create non-member user
    nonMember = await db.user.create({
      data: {
        name: "Non Member User",
        email: `non-member-${generateUniqueId("user")}@example.com`,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      
      // Mock requireAuth to return 401 NextResponse
      requireAuth.mockReturnValue(
        NextResponse.json(
          { error: "Unauthorized", kind: "unauthorized" },
          { status: 401 }
        )
      );

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("How does this work?")}&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    test("should return 400 when question parameter is missing", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });

      const request = createGetRequest(
        `/api/ask/quick?workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Missing required parameter: question");
      expect(data.kind).toBe("validation");
    });

    test("should return 400 when workspace parameter is missing", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("How does this work?")}`
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Missing required parameter: workspace");
      expect(data.kind).toBe("validation");
    });
  });

  describe("Authorization", () => {
    test("should return 403 when user lacks workspace access", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");

      requireAuth.mockReturnValue({ id: nonMember.id, email: nonMember.email, name: nonMember.name });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("How does this work?")}&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Workspace not found or access denied");
      expect(data.kind).toBe("forbidden");
    });

    test("should allow VIEWER role to access quick ask", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");
      const { getGithubUsernameAndPAT } = await import("@/lib/auth");
      const { getPrimaryRepository } = await import("@/lib/helpers/repository");
      const { getApiKeyForProvider, getModel } = await import("aieo");
      const { askTools } = await import("@/lib/ai/askTools");
      const { streamText } = await import("ai");

      requireAuth.mockReturnValue({ id: memberViewer.id, email: memberViewer.email, name: memberViewer.name });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
        canRead: true,
        canWrite: false,
        canAdmin: false,
      });

      const encryptionService = EncryptionService.getInstance();
      const decryptSpy = vi.spyOn(encryptionService, "decryptField");
      decryptSpy.mockReturnValue("test-swarm-api-key");

      getPrimaryRepository.mockResolvedValue(repository);
      getGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-pat-token",
      });

      getApiKeyForProvider.mockReturnValue("anthropic-key");
      getModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      askTools.mockReturnValue([
        { name: "get_learnings" },
        { name: "recent_commits" },
        { name: "final_answer" },
      ]);

      streamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("Mock AI response", {
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        ),
      });

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("How does authentication work?")}&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(validateWorkspaceAccess).toHaveBeenCalledWith(workspace.slug, memberViewer.id);
    });
  });

  describe("Data Integrity", () => {
    test("should return 404 when swarm is not configured", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");

      const newScenario = await createTestWorkspaceScenario({
        owner: { name: "No Swarm Owner" },
      });

      requireAuth.mockReturnValue({ 
        id: newScenario.owner.id, 
        email: newScenario.owner.email, 
        name: newScenario.owner.name 
      });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: newScenario.workspace.id, slug: newScenario.workspace.slug },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("Test question")}&workspace=${newScenario.workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Swarm not found for this workspace");
      expect(data.kind).toBe("not_found");
    });

    test("should return 404 when swarmUrl is not configured", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");

      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: null },
      });

      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("Test question")}&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Swarm URL not configured");
      expect(data.kind).toBe("not_found");
    });

    test("should return 404 when repository URL is not configured", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");
      const { getPrimaryRepository } = await import("@/lib/helpers/repository");

      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const encryptionService = EncryptionService.getInstance();
      const decryptSpy = vi.spyOn(encryptionService, "decryptField");
      decryptSpy.mockReturnValue("test-swarm-api-key");

      getPrimaryRepository.mockResolvedValue(null);

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("Test question")}&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Repository URL not configured for this swarm");
      expect(data.kind).toBe("not_found");
    });

    test("should return 404 when GitHub PAT is not found", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");
      const { getGithubUsernameAndPAT } = await import("@/lib/auth");
      const { getPrimaryRepository } = await import("@/lib/helpers/repository");

      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const encryptionService = EncryptionService.getInstance();
      const decryptSpy = vi.spyOn(encryptionService, "decryptField");
      decryptSpy.mockReturnValue("test-swarm-api-key");

      getPrimaryRepository.mockResolvedValue(repository);
      getGithubUsernameAndPAT.mockResolvedValue(null);

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("Test question")}&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("GitHub PAT not found for this user");
      expect(data.kind).toBe("not_found");
    });

    test("should decrypt swarm API key before making AI request", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");
      const { getGithubUsernameAndPAT } = await import("@/lib/auth");
      const { getPrimaryRepository } = await import("@/lib/helpers/repository");
      const { getApiKeyForProvider, getModel } = await import("aieo");
      const { askTools } = await import("@/lib/ai/askTools");
      const { streamText } = await import("ai");

      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const encryptionService = EncryptionService.getInstance();
      const decryptSpy = vi.spyOn(encryptionService, "decryptField");
      decryptSpy.mockReturnValue("decrypted-swarm-api-key");

      getPrimaryRepository.mockResolvedValue(repository);
      getGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-pat-token",
      });

      getApiKeyForProvider.mockReturnValue("anthropic-key");
      getModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      
      const askToolsSpy = vi.fn().mockReturnValue([
        { name: "get_learnings" },
        { name: "recent_commits" },
        { name: "final_answer" },
      ]);
      askTools.mockImplementation(askToolsSpy);

      streamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("Mock AI response", {
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        ),
      });

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("Test question")}&workspace=${workspace.slug}`
      );

      await GET(request);

      // Verify decryption was called
      expect(decryptSpy).toHaveBeenCalledWith("swarmApiKey", expect.any(String));

      // Verify decrypted key was passed to askTools
      expect(askToolsSpy).toHaveBeenCalledWith(
        expect.stringContaining("https://test-swarm.sphinx.chat:3355"),
        "decrypted-swarm-api-key",
        "https://github.com/test/repo",
        "test-pat-token",
        "anthropic-key"
      );
    });

    test("should construct correct swarm URL with port 3355 for production", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");
      const { getGithubUsernameAndPAT } = await import("@/lib/auth");
      const { getPrimaryRepository } = await import("@/lib/helpers/repository");
      const { getApiKeyForProvider, getModel } = await import("aieo");
      const { askTools } = await import("@/lib/ai/askTools");
      const { streamText } = await import("ai");

      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const encryptionService = EncryptionService.getInstance();
      const decryptSpy = vi.spyOn(encryptionService, "decryptField");
      decryptSpy.mockReturnValue("test-swarm-api-key");

      getPrimaryRepository.mockResolvedValue(repository);
      getGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-pat-token",
      });

      getApiKeyForProvider.mockReturnValue("anthropic-key");
      getModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      
      const askToolsSpy = vi.fn().mockReturnValue([
        { name: "get_learnings" },
        { name: "recent_commits" },
        { name: "final_answer" },
      ]);
      askTools.mockImplementation(askToolsSpy);

      streamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("Mock AI response", {
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        ),
      });

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("Test question")}&workspace=${workspace.slug}`
      );

      await GET(request);

      // Verify swarm URL format: https://{hostname}:3355
      expect(askToolsSpy).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat:3355",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });

    test("should handle localhost swarm URL correctly", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");
      const { getGithubUsernameAndPAT } = await import("@/lib/auth");
      const { getPrimaryRepository } = await import("@/lib/helpers/repository");
      const { getApiKeyForProvider, getModel } = await import("aieo");
      const { askTools } = await import("@/lib/ai/askTools");
      const { streamText } = await import("ai");

      // Update swarm URL to localhost
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: "http://localhost:3000" },
      });

      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const encryptionService = EncryptionService.getInstance();
      const decryptSpy = vi.spyOn(encryptionService, "decryptField");
      decryptSpy.mockReturnValue("test-swarm-api-key");

      getPrimaryRepository.mockResolvedValue(repository);
      getGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-pat-token",
      });

      getApiKeyForProvider.mockReturnValue("anthropic-key");
      getModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      
      const askToolsSpy = vi.fn().mockReturnValue([
        { name: "get_learnings" },
        { name: "recent_commits" },
        { name: "final_answer" },
      ]);
      askTools.mockImplementation(askToolsSpy);

      streamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("Mock AI response", {
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        ),
      });

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("Test question")}&workspace=${workspace.slug}`
      );

      await GET(request);

      // Verify localhost uses http:// instead of https://
      expect(askToolsSpy).toHaveBeenCalledWith(
        "http://localhost:3355",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe("Successful Request Flow", () => {
    test("should successfully process question with valid inputs", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");
      const { getGithubUsernameAndPAT } = await import("@/lib/auth");
      const { getPrimaryRepository } = await import("@/lib/helpers/repository");
      const { getApiKeyForProvider, getModel } = await import("aieo");
      const { askTools } = await import("@/lib/ai/askTools");
      const { streamText } = await import("ai");

      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const encryptionService = EncryptionService.getInstance();
      const decryptSpy = vi.spyOn(encryptionService, "decryptField");
      decryptSpy.mockReturnValue("test-swarm-api-key");

      getPrimaryRepository.mockResolvedValue(repository);
      getGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-pat-token",
      });

      getApiKeyForProvider.mockReturnValue("anthropic-key");
      getModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      askTools.mockReturnValue([
        { name: "get_learnings" },
        { name: "recent_commits" },
        { name: "final_answer" },
      ]);

      const mockStreamResponse = new Response("Mock AI streaming response", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });

      streamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(mockStreamResponse),
      });

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("How does authentication work?")}&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      // Verify streaming response
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
    });

    test("should call AI tools with correct parameters", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");
      const { getGithubUsernameAndPAT } = await import("@/lib/auth");
      const { getPrimaryRepository } = await import("@/lib/helpers/repository");
      const { getApiKeyForProvider, getModel } = await import("aieo");
      const { askTools } = await import("@/lib/ai/askTools");
      const { streamText } = await import("ai");

      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const encryptionService = EncryptionService.getInstance();
      const decryptSpy = vi.spyOn(encryptionService, "decryptField");
      decryptSpy.mockReturnValue("test-swarm-api-key");

      getPrimaryRepository.mockResolvedValue(repository);
      getGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-pat-token",
      });

      getApiKeyForProvider.mockReturnValue("anthropic-key");
      const mockModel = { modelId: "claude-3-5-sonnet-20241022" };
      getModel.mockResolvedValue(mockModel);
      
      const mockTools = [
        { name: "get_learnings" },
        { name: "recent_commits" },
        { name: "final_answer" },
      ];
      askTools.mockReturnValue(mockTools);

      const streamTextSpy = vi.fn().mockResolvedValue({
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("Mock AI response", {
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        ),
      });
      streamText.mockImplementation(streamTextSpy);

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("What are recent commits?")}&workspace=${workspace.slug}`
      );

      await GET(request);

      // Verify askTools was called with correct parameters
      expect(askTools).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat:3355",
        "test-swarm-api-key",
        "https://github.com/test/repo",
        "test-pat-token",
        "anthropic-key"
      );

      // Verify streamText was called with correct configuration
      expect(streamTextSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockModel,
          tools: mockTools,
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "system",
            }),
            expect.objectContaining({
              role: "user",
              content: "What are recent commits?",
            }),
          ]),
        })
      );
    });
  });

  describe("Error Handling", () => {
    test("should return 500 when AI streaming fails", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");
      const { getGithubUsernameAndPAT } = await import("@/lib/auth");
      const { getPrimaryRepository } = await import("@/lib/helpers/repository");
      const { getApiKeyForProvider, getModel } = await import("aieo");
      const { askTools } = await import("@/lib/ai/askTools");
      const { streamText } = await import("ai");

      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });
      validateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: workspace.id, slug: workspace.slug },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });

      const encryptionService = EncryptionService.getInstance();
      const decryptSpy = vi.spyOn(encryptionService, "decryptField");
      decryptSpy.mockReturnValue("test-swarm-api-key");

      getPrimaryRepository.mockResolvedValue(repository);
      getGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-pat-token",
      });

      getApiKeyForProvider.mockReturnValue("anthropic-key");
      getModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      askTools.mockReturnValue([
        { name: "get_learnings" },
        { name: "recent_commits" },
        { name: "final_answer" },
      ]);

      // Mock streamText to throw an error
      streamText.mockRejectedValue(new Error("AI service unavailable"));

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("Test question")}&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to create stream");
      expect(data.kind).toBe("server_error");
    });

    test("should handle generic errors gracefully", async () => {
      const { requireAuth } = await import("@/lib/middleware/utils");
      const { validateWorkspaceAccess } = await import("@/services/workspace");

      requireAuth.mockReturnValue({ id: owner.id, email: owner.email, name: owner.name });
      
      // Mock validateWorkspaceAccess to throw a non-ApiError
      validateWorkspaceAccess.mockRejectedValue(new Error("Database connection failed"));

      const request = createGetRequest(
        `/api/ask/quick?question=${encodeURIComponent("Test question")}&workspace=${workspace.slug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to process quick ask");
    });
  });
});
