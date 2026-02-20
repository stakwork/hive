import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/git-leaks/route";
import {
  createTestUser,
  createTestWorkspaceScenario,
} from "@/__tests__/support/fixtures";
import { createTestRepository } from "@/__tests__/support/factories/repository.factory";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createGetRequest,
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers";
import type { GitLeakResult } from "@/types/git-leaks";

// Mock external service dependencies
vi.mock("@/services/swarm/api/swarm", () => ({
  swarmApiRequestAuth: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn(),
}));

// Import mocked functions for type-safe access
import { swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";

const mockSwarmApiRequest = vi.mocked(swarmApiRequestAuth);
const mockGetGithubAuth = vi.mocked(getGithubUsernameAndPAT);
const mockTransformUrl = vi.mocked(transformSwarmUrlToRepo2Graph);

describe("GET /api/workspaces/[slug]/git-leaks", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default successful mock implementations
    mockTransformUrl.mockReturnValue("http://test-swarm:3355");
    mockGetGithubAuth.mockResolvedValue({
      username: "testuser",
      token: "ghp_test_token",
    });
    mockSwarmApiRequest.mockResolvedValue({
      ok: true,
      data: { detect: [] },
      status: 200,
    });
  });

  describe("Authentication & Authorization", () => {
    test("rejects unauthenticated requests", async () => {
      const { workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectUnauthorized(response);
    });

    test("rejects non-member access", async () => {
      const { workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      const nonMember = await createTestUser();

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        nonMember,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("allows workspace owner access", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
    });

    test("allows workspace member access", async () => {
      const { members, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
        memberCount: 1,
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      const member = members[0];

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        member,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Validation Requirements", () => {
    test("returns 404 when workspace not found", async () => {
      const owner = await createTestUser();

      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/workspaces/nonexistent-slug/git-leaks",
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "nonexistent-slug" }),
      });

      await expectError(response, "Workspace not found", 404);
    });

    test("returns 400 when workspace has no swarm configured", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: false,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(
        response,
        "Workspace does not have a swarm configured",
        400,
      );
    });

    test("returns 400 when workspace has no repositories", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(
        response,
        "No repositories configured for this workspace",
        400,
      );
    });

    test("returns 400 when swarm API key not configured", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      // Remove swarm API key
      const { db } = await import("@/lib/db");
      await db.swarm.update({
        where: { id: swarm!.id },
        data: { swarmApiKey: null },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Swarm API key not configured", 400);
    });

    test("returns 400 when GitHub authentication not configured", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      // Mock GitHub auth not configured
      mockGetGithubAuth.mockResolvedValue(null);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(
        response,
        "GitHub authentication not configured for this workspace",
        400,
      );
    });

    test("returns 500 when unable to determine graph service URL", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      // Mock URL transformation failure
      mockTransformUrl.mockReturnValue("");

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Unable to determine graph service URL", 500);
    });
  });

  describe("Leak Detection", () => {
    test("detects and returns sensitive data leaks", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      const mockLeaks: GitLeakResult[] = [
        {
          Date: "2024-01-01T12:00:00Z",
          Description: "AWS Access Key",
          File: "config/secrets.js",
          Fingerprint: "abc123def456",
          Link: "https://github.com/test/repo/blob/main/config/secrets.js#L42",
          Message: "commit: added configuration",
        },
        {
          Date: "2024-01-02T10:30:00Z",
          Description: "GitHub Personal Access Token",
          File: ".env",
          Fingerprint: "xyz789",
          Link: "https://github.com/test/repo/blob/main/.env#L5",
          Message: "commit: environment setup",
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        data: { detect: mockLeaks },
        status: 200,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.leaks).toHaveLength(2);
      expect(data.count).toBe(2);
      expect(data.scannedAt).toBeDefined();
      expect(data.scannedAt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // Validate first leak structure
      expect(data.leaks[0]).toMatchObject({
        Date: "2024-01-01T12:00:00Z",
        Description: "AWS Access Key",
        File: "config/secrets.js",
        Fingerprint: "abc123def456",
        Link: "https://github.com/test/repo/blob/main/config/secrets.js#L42",
        Message: "commit: added configuration",
      });

      // Validate second leak structure
      expect(data.leaks[1]).toMatchObject({
        Date: "2024-01-02T10:30:00Z",
        Description: "GitHub Personal Access Token",
        File: ".env",
        Fingerprint: "xyz789",
      });
    });

    test("returns empty array when no leaks found", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        data: { detect: [] },
        status: 200,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.leaks).toHaveLength(0);
      expect(data.count).toBe(0);
      expect(data.scannedAt).toBeDefined();
    });

    test("correctly maps all GitLeakResult fields", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      const mockLeak: GitLeakResult = {
        Date: "2024-01-01T12:00:00Z",
        Description: "API Key",
        File: "src/config.ts",
        Fingerprint: "unique-fingerprint-123",
        Link: "https://github.com/test/repo/blob/main/src/config.ts#L10",
        Message: "Added API configuration",
      };

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        data: { detect: [mockLeak] },
        status: 200,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      // Validate all required GitLeakResult fields are present
      const leak = data.leaks[0];
      expect(leak.Date).toBe("2024-01-01T12:00:00Z");
      expect(leak.Description).toBe("API Key");
      expect(leak.File).toBe("src/config.ts");
      expect(leak.Fingerprint).toBe("unique-fingerprint-123");
      expect(leak.Link).toContain("github.com");
      expect(leak.Message).toBe("Added API configuration");
    });

    test("calls swarmApiRequestAuth with correct parameters", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      mockGetGithubAuth.mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token_123",
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(mockSwarmApiRequest).toHaveBeenCalledWith({
        swarmUrl: "http://test-swarm:3355",
        endpoint: "/leaks",
        method: "GET",
        apiKey: expect.any(String),
        params: {
          repo_url: "https://github.com/test/repo",
          username: "testuser",
          pat: "ghp_test_token_123",
        },
      });
    });
  });

  describe("Error Handling", () => {
    test("handles graph service unavailable error (503)", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      mockSwarmApiRequest.mockResolvedValue({
        ok: false,
        data: { error: "Service unavailable" },
        status: 503,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBe("Failed to scan for git leaks");
      expect(data.details).toContain("Service returned status 503");
    });

    test("handles timeout error (504)", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      // Simulate timeout error
      const timeoutError = new Error("Request timeout");
      timeoutError.name = "TimeoutError";
      mockSwarmApiRequest.mockRejectedValue(timeoutError);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(
        response,
        "Git leaks scan timed out. Please try again.",
        504,
      );
    });

    test("handles fetch connection error", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      // Simulate fetch connection failure
      mockSwarmApiRequest.mockRejectedValue(new Error("fetch failed"));

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Unable to connect to graph service", 503);
    });

    test("handles general server error (500)", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      mockSwarmApiRequest.mockRejectedValue(
        new Error("Unexpected internal error"),
      );

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Internal server error", 500);
    });

    test("handles swarm service error with response data", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
      });

      mockSwarmApiRequest.mockResolvedValue({
        ok: false,
        data: { error: "Invalid repository URL", code: "INVALID_REPO" },
        status: 400,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Failed to scan for git leaks");
      expect(data.details).toContain("Service returned status 400");
      expect(data.responseData).toBeDefined();
    });
  });

  describe("Multi-repository support", () => {
    test("valid repositoryId scans the correct repository URL", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      const repo1 = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo1",
        name: "repo1",
      });

      const repo2 = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo2",
        name: "repo2",
      });

      mockTransformUrl.mockReturnValue(
        "http://graph-service:8000",
      );
      mockGetGithubAuth.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        data: { detect: [] },
        status: 200,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
        { repositoryId: repo2.id },
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
      expect(mockSwarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ repo_url: repo2.repositoryUrl }),
        }),
      );
    });

    test("repositoryId from a different workspace returns 400", async () => {
      const { owner: owner1, workspace: workspace1 } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      await createTestRepository({
        workspaceId: workspace1.id,
        repositoryUrl: "https://github.com/test/workspace1-repo",
        name: "workspace1-repo",
      });

      const { workspace: workspace2 } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      const workspace2Repo = await createTestRepository({
        workspaceId: workspace2.id,
        repositoryUrl: "https://github.com/test/workspace2-repo",
        name: "workspace2-repo",
      });

      mockTransformUrl.mockReturnValue(
        "http://graph-service:8000",
      );
      mockGetGithubAuth.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace1.slug}/git-leaks`,
        owner1,
        { repositoryId: workspace2Repo.id },
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace1.slug }),
      });

      await expectError(
        response,
        "Repository not found in this workspace",
        400,
      );
    });

    test("omitted repositoryId falls back to first repository", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", swarmUrl: "http://test-swarm:8444/api" },
      });

      const repo1 = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/first-repo",
        name: "first-repo",
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/second-repo",
        name: "second-repo",
      });

      mockTransformUrl.mockReturnValue(
        "http://graph-service:8000",
      );
      mockGetGithubAuth.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        data: { detect: [] },
        status: 200,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/git-leaks`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
      expect(mockSwarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ repo_url: repo1.repositoryUrl }),
        }),
      );
    });
  });
});
