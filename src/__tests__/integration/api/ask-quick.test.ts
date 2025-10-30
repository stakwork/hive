import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/ask/quick/route";
import { db } from "@/lib/db";
import {
  expectError,
  createGetRequest,
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";

// Mock external service dependencies
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn().mockReturnValue("decrypted-api-key"),
    })),
  },
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/lib/helpers/repository", () => ({
  getPrimaryRepository: vi.fn(),
}));

vi.mock("aieo", () => ({
  getApiKeyForProvider: vi.fn().mockReturnValue("anthropic-test-key"),
  getModel: vi.fn().mockResolvedValue({
    modelId: "claude-3-5-sonnet-20241022",
  }),
}));

vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn().mockReturnValue({
    get_learnings: { name: "get_learnings" },
    ask_question: { name: "ask_question" },
    recent_commits: { name: "recent_commits" },
    recent_contributions: { name: "recent_contributions" },
    web_search: { name: "web_search" },
    final_answer: { name: "final_answer" },
  }),
}));

vi.mock("ai", () => ({
  streamText: vi.fn(() => ({
    toUIMessageStreamResponse: () =>
      new Response("Mock AI streaming response", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
  })),
  hasToolCall: vi.fn(() => () => false),
}));

describe("GET /api/ask/quick - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 401 when user is not authenticated", async () => {
    const request = createGetRequest("http://localhost/api/ask/quick", {
      question: "How does authentication work?",
      workspace: "test-workspace",
    });

    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  test("returns 400 when question parameter is missing", async () => {
    const user = await createTestUser();

    const request = createAuthenticatedGetRequest(
      "http://localhost/api/ask/quick",
      user,
      {
        workspace: "test-workspace",
      }
    );

    const response = await GET(request);

    await expectError(response, "Missing required parameter: question", 400);
  });

  test("returns 400 when workspace parameter is missing", async () => {
    const user = await createTestUser();

    const request = createAuthenticatedGetRequest(
      "http://localhost/api/ask/quick",
      user,
      {
        question: "How does authentication work?",
      }
    );

    const response = await GET(request);

    await expectError(response, "Missing required parameter: workspace", 400);
  });

  test("returns 403 when user lacks workspace access", async () => {
    const user = await createTestUser();

    const { validateWorkspaceAccess } = await import("@/services/workspace");
    (validateWorkspaceAccess as any).mockResolvedValue({
      hasAccess: false,
      canRead: false,
      canWrite: false,
      canAdmin: false,
    });

    const request = createAuthenticatedGetRequest(
      "http://localhost/api/ask/quick",
      user,
      {
        question: "How does authentication work?",
        workspace: "test-workspace",
      }
    );

    const response = await GET(request);

    await expectError(response, "Workspace not found or access denied", 403);
  });

  test("returns 404 when swarm configuration is not found", async () => {
    const user = await createTestUser();
    const workspace = await createTestWorkspace({
      ownerId: user.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });

    const { validateWorkspaceAccess } = await import("@/services/workspace");
    (validateWorkspaceAccess as any).mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        slug: workspace.slug,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
    });

    const request = createAuthenticatedGetRequest(
      "http://localhost/api/ask/quick",
      user,
      {
        question: "How does authentication work?",
        workspace: "test-workspace",
      }
    );

    const response = await GET(request);

    await expectError(response, "Swarm not found for this workspace", 404);
  });

  test("returns 404 when swarm URL is not configured", async () => {
    const user = await createTestUser();
    const workspace = await createTestWorkspace({
      ownerId: user.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });

    // Create swarm without URL
    await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "test-swarm-no-url",
        swarmUrl: null,
        swarmApiKey: null,
      },
    });

    const { validateWorkspaceAccess } = await import("@/services/workspace");
    (validateWorkspaceAccess as any).mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        slug: workspace.slug,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
    });

    const request = createAuthenticatedGetRequest(
      "http://localhost/api/ask/quick",
      user,
      {
        question: "How does authentication work?",
        workspace: "test-workspace",
      }
    );

    const response = await GET(request);

    await expectError(response, "Swarm URL not configured", 404);
  });

  test("returns 404 when repository URL is not configured", async () => {
    const user = await createTestUser();
    const workspace = await createTestWorkspace({
      ownerId: user.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });

    // Create swarm with URL
    await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "test-swarm-repo-check",
        swarmUrl: "http://swarm.example.com",
        swarmApiKey: "encrypted-api-key",
      },
    });

    const { validateWorkspaceAccess } = await import("@/services/workspace");
    (validateWorkspaceAccess as any).mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        slug: workspace.slug,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
    });

    const { getPrimaryRepository } = await import("@/lib/helpers/repository");
    (getPrimaryRepository as any).mockResolvedValue(null);

    const request = createAuthenticatedGetRequest(
      "http://localhost/api/ask/quick",
      user,
      {
        question: "How does authentication work?",
        workspace: "test-workspace",
      }
    );

    const response = await GET(request);

    await expectError(response, "Repository URL not configured for this swarm", 404);
  });

  test("returns 404 when GitHub PAT is not found", async () => {
    const user = await createTestUser();
    const workspace = await createTestWorkspace({
      ownerId: user.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });

    // Create swarm with URL
    await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "test-swarm-github-pat",
        swarmUrl: "http://swarm.example.com",
        swarmApiKey: "encrypted-api-key",
      },
    });

    const { validateWorkspaceAccess } = await import("@/services/workspace");
    (validateWorkspaceAccess as any).mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        slug: workspace.slug,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
    });

    const { getPrimaryRepository } = await import("@/lib/helpers/repository");
    (getPrimaryRepository as any).mockResolvedValue({
      id: "repo-123",
      repositoryUrl: "https://github.com/test/repo",
      name: "Test Repo",
      branch: "main",
    });

    const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
    (getGithubUsernameAndPAT as any).mockResolvedValue(null);

    const request = createAuthenticatedGetRequest(
      "http://localhost/api/ask/quick",
      user,
      {
        question: "How does authentication work?",
        workspace: "test-workspace",
      }
    );

    const response = await GET(request);

    await expectError(response, "GitHub PAT not found for this user", 404);
  });

  test("successfully processes question with valid inputs and returns streaming response", async () => {
    const user = await createTestUser({ withGitHubAuth: true });
    const workspace = await createTestWorkspace({
      ownerId: user.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });

    // Create swarm with complete configuration
    await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "test-swarm-success",
        swarmUrl: "http://swarm.example.com",
        swarmApiKey: "encrypted-api-key",
      },
    });

    const { validateWorkspaceAccess } = await import("@/services/workspace");
    (validateWorkspaceAccess as any).mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        slug: workspace.slug,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
    });

    const { getPrimaryRepository } = await import("@/lib/helpers/repository");
    (getPrimaryRepository as any).mockResolvedValue({
      id: "repo-123",
      repositoryUrl: "https://github.com/test/repo",
      name: "Test Repo",
      branch: "main",
      ignoreDirs: null,
      unitGlob: null,
      integrationGlob: null,
      e2eGlob: null,
      description: "Test repository",
    });

    const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
    (getGithubUsernameAndPAT as any).mockResolvedValue({
      username: "testuser",
      token: "test-github-pat-token",
    });

    const request = createAuthenticatedGetRequest(
      "http://localhost/api/ask/quick",
      user,
      {
        question: "How does authentication work in this codebase?",
        workspace: "test-workspace",
      }
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");

    // Verify response body can be read
    const text = await response.text();
    expect(text).toBe("Mock AI streaming response");
  });

  test("calls AI tools with correct parameters", async () => {
    const user = await createTestUser({ withGitHubAuth: true });
    const workspace = await createTestWorkspace({
      ownerId: user.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });

    // Create swarm with complete configuration
    await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "test-swarm-ai-tools",
        swarmUrl: "http://swarm.example.com",
        swarmApiKey: "encrypted-api-key",
      },
    });

    const { validateWorkspaceAccess } = await import("@/services/workspace");
    (validateWorkspaceAccess as any).mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        slug: workspace.slug,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
    });

    const { getPrimaryRepository } = await import("@/lib/helpers/repository");
    (getPrimaryRepository as any).mockResolvedValue({
      id: "repo-123",
      repositoryUrl: "https://github.com/test/repo",
      name: "Test Repo",
      branch: "main",
      ignoreDirs: null,
      unitGlob: null,
      integrationGlob: null,
      e2eGlob: null,
      description: "Test repository",
    });

    const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
    (getGithubUsernameAndPAT as any).mockResolvedValue({
      username: "testuser",
      token: "test-github-pat-token",
    });

    const { askTools } = await import("@/lib/ai/askTools");
    const { streamText } = await import("ai");

    const request = createAuthenticatedGetRequest(
      "http://localhost/api/ask/quick",
      user,
      {
        question: "What are the recent commits?",
        workspace: "test-workspace",
      }
    );

    await GET(request);

    // Verify askTools was called with correct parameters
    expect(askTools).toHaveBeenCalledWith(
      "https://swarm.example.com:3355", // baseSwarmUrl with :3355 port (https for non-localhost)
      "decrypted-api-key", // decrypted swarm API key
      "https://github.com/test/repo", // repository URL
      "test-github-pat-token", // GitHub PAT
      "anthropic-test-key" // Anthropic API key
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
          }),
          expect.objectContaining({
            role: "user",
            content: "What are the recent commits?",
          }),
        ]),
        tools: expect.objectContaining({
          get_learnings: expect.any(Object),
          ask_question: expect.any(Object),
          recent_commits: expect.any(Object),
          recent_contributions: expect.any(Object),
          web_search: expect.any(Object),
          final_answer: expect.any(Object),
        }),
      })
    );
  });

  test("handles streamText failure with 500 error", async () => {
    const user = await createTestUser({ withGitHubAuth: true });
    const workspace = await createTestWorkspace({
      ownerId: user.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });

    // Create swarm with complete configuration
    await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "test-swarm-streamtext-fail",
        swarmUrl: "http://swarm.example.com",
        swarmApiKey: "encrypted-api-key",
      },
    });

    const { validateWorkspaceAccess } = await import("@/services/workspace");
    (validateWorkspaceAccess as any).mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        slug: workspace.slug,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
    });

    const { getPrimaryRepository } = await import("@/lib/helpers/repository");
    (getPrimaryRepository as any).mockResolvedValue({
      id: "repo-123",
      repositoryUrl: "https://github.com/test/repo",
      name: "Test Repo",
      branch: "main",
      ignoreDirs: null,
      unitGlob: null,
      integrationGlob: null,
      e2eGlob: null,
      description: "Test repository",
    });

    const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
    (getGithubUsernameAndPAT as any).mockResolvedValue({
      username: "testuser",
      token: "test-github-pat-token",
    });

    // Mock streamText to throw error
    const { streamText } = await import("ai");
    (streamText as any).mockRejectedValueOnce(new Error("AI service unavailable"));

    const request = createAuthenticatedGetRequest(
      "http://localhost/api/ask/quick",
      user,
      {
        question: "How does authentication work?",
        workspace: "test-workspace",
      }
    );

    const response = await GET(request);

    await expectError(response, "Failed to create stream", 500);
  });

  test("handles localhost swarm URL correctly", async () => {
    const user = await createTestUser({ withGitHubAuth: true });
    const workspace = await createTestWorkspace({
      ownerId: user.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });

    // Create swarm with localhost URL
    await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "test-swarm-localhost",
        swarmUrl: "http://localhost:8000",
        swarmApiKey: "encrypted-api-key",
      },
    });

    const { validateWorkspaceAccess } = await import("@/services/workspace");
    (validateWorkspaceAccess as any).mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        slug: workspace.slug,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
    });

    const { getPrimaryRepository } = await import("@/lib/helpers/repository");
    (getPrimaryRepository as any).mockResolvedValue({
      id: "repo-123",
      repositoryUrl: "https://github.com/test/repo",
      name: "Test Repo",
      branch: "main",
      ignoreDirs: null,
      unitGlob: null,
      integrationGlob: null,
      e2eGlob: null,
      description: "Test repository",
    });

    const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
    (getGithubUsernameAndPAT as any).mockResolvedValue({
      username: "testuser",
      token: "test-github-pat-token",
    });

    const { askTools } = await import("@/lib/ai/askTools");

    const request = createAuthenticatedGetRequest(
      "http://localhost/api/ask/quick",
      user,
      {
        question: "Test question",
        workspace: "test-workspace",
      }
    );

    await GET(request);

    // Verify askTools was called with localhost URL (http instead of https)
    expect(askTools).toHaveBeenCalledWith(
      "http://localhost:3355", // localhost should use http protocol
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String)
    );
  });
});
