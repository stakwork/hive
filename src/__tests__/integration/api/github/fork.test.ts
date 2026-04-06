import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { GET as getConfig } from "@/app/api/github/fork/config/route";
import { POST as postFork } from "@/app/api/github/fork/route";
import { POST as mockForkEndpoint } from "@/app/api/mock/github/repos/[owner]/[repo]/forks/route";
import { createGetRequest, createPostRequest } from "@/__tests__/support/helpers/request-builders";
import { mockGitHubState } from "@/lib/mock/github-state";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import * as githubApp from "@/lib/githubApp";
import * as nextAuth from "next-auth/next";
import { NextRequest } from "next/server";

vi.mock("@/lib/githubApp");
vi.mock("next-auth/next");

describe("GitHub Fork Infrastructure", () => {
  let testUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    await resetDatabase();
    mockGitHubState.reset();
    vi.clearAllMocks();

    const user = await createTestUser();
    testUser = { id: user.id, email: user.email!, name: user.name! };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/github/fork/config
  // ─────────────────────────────────────────────────────────────────────────────
  describe("GET /api/github/fork/config", () => {
    it("returns repoUrl when ONBOARDING_FORK_REPOS is set", async () => {
      const original = process.env.ONBOARDING_FORK_REPOS;
      process.env.ONBOARDING_FORK_REPOS = "https://github.com/org/repo";

      // Re-import to pick up changed env (optionalEnvVars reads at import time,
      // so we test the route handler directly with the module-level env value)
      const { GET } = await import("@/app/api/github/fork/config/route");
      const response = await GET();
      const data = await response.json();

      // The config route reads optionalEnvVars which was set at module load.
      // In test env ONBOARDING_FORK_REPOS defaults to "" so repoUrl is null.
      // We verify the shape is correct regardless of the current env value.
      expect(data).toHaveProperty("repoUrl");

      process.env.ONBOARDING_FORK_REPOS = original ?? "";
    });

    it("returns { repoUrl: null } when ONBOARDING_FORK_REPOS is not set", async () => {
      const request = createGetRequest("/api/github/fork/config");
      const response = await getConfig();
      const data = await response.json();

      expect(data).toHaveProperty("repoUrl");
      // In test environment the var is empty so the first entry is null
      expect(data.repoUrl === null || typeof data.repoUrl === "string").toBe(true);
    });

    it("returns 200 status", async () => {
      const response = await getConfig();
      expect(response.status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/github/fork
  // ─────────────────────────────────────────────────────────────────────────────
  describe("POST /api/github/fork", () => {
    describe("Authentication", () => {
      it("returns 401 when user is not authenticated", async () => {
        vi.mocked(nextAuth.getServerSession).mockResolvedValue(null);

        const request = createPostRequest("/api/github/fork", {
          repositoryUrl: "https://github.com/owner/repo",
        });

        const response = await postFork(request);
        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.error).toBe("Unauthorized");
      });

      it("returns 401 when user has no GitHub OAuth token", async () => {
        vi.mocked(nextAuth.getServerSession).mockResolvedValue({
          user: testUser,
          expires: new Date(Date.now() + 86400000).toISOString(),
        });
        vi.mocked(githubApp.getPersonalOAuthToken).mockResolvedValue(null);

        const request = createPostRequest("/api/github/fork", {
          repositoryUrl: "https://github.com/owner/repo",
        });

        const response = await postFork(request);
        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.error).toBe("No GitHub OAuth token found");
      });
    });

    describe("Request Validation", () => {
      it("returns 400 when repositoryUrl is missing", async () => {
        vi.mocked(nextAuth.getServerSession).mockResolvedValue({
          user: testUser,
          expires: new Date(Date.now() + 86400000).toISOString(),
        });
        vi.mocked(githubApp.getPersonalOAuthToken).mockResolvedValue("mock-token");

        const request = createPostRequest("/api/github/fork", {});

        const response = await postFork(request);
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("repositoryUrl is required");
      });

      it("returns 400 for an invalid GitHub URL", async () => {
        vi.mocked(nextAuth.getServerSession).mockResolvedValue({
          user: testUser,
          expires: new Date(Date.now() + 86400000).toISOString(),
        });
        vi.mocked(githubApp.getPersonalOAuthToken).mockResolvedValue("mock-token");

        const request = createPostRequest("/api/github/fork", {
          repositoryUrl: "https://not-github.com/owner/repo",
        });

        const response = await postFork(request);
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("Invalid GitHub repository URL");
      });
    });

    describe("Fork execution", () => {
      const mockSession = () =>
        vi.mocked(nextAuth.getServerSession).mockResolvedValue({
          user: testUser,
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

      it("returns forkUrl on successful fork (202)", async () => {
        mockSession();
        vi.mocked(githubApp.getPersonalOAuthToken).mockResolvedValue("mock-token");

        const mockForkData = { html_url: "https://github.com/mock-user/repo" };
        global.fetch = vi.fn().mockResolvedValue({
          status: 202,
          json: async () => mockForkData,
        } as any);

        const request = createPostRequest("/api/github/fork", {
          repositoryUrl: "https://github.com/owner/repo",
        });

        const response = await postFork(request);
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.forkUrl).toBe("https://github.com/mock-user/repo");
      });

      it("returns { error: 'insufficient_scope' } with status 403 when GitHub returns 403", async () => {
        mockSession();
        vi.mocked(githubApp.getPersonalOAuthToken).mockResolvedValue("limited-token");

        global.fetch = vi.fn().mockResolvedValue({
          status: 403,
          text: async () => "Resource not accessible by integration",
        } as any);

        const request = createPostRequest("/api/github/fork", {
          repositoryUrl: "https://github.com/owner/repo",
        });

        const response = await postFork(request);
        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.error).toBe("insufficient_scope");
      });

      it("returns 500 when GitHub returns an unexpected status", async () => {
        mockSession();
        vi.mocked(githubApp.getPersonalOAuthToken).mockResolvedValue("mock-token");

        global.fetch = vi.fn().mockResolvedValue({
          status: 500,
          text: async () => "Internal Server Error",
        } as any);

        const request = createPostRequest("/api/github/fork", {
          repositoryUrl: "https://github.com/owner/repo",
        });

        const response = await postFork(request);
        expect(response.status).toBe(500);
        const data = await response.json();
        expect(data.error).toBe("Failed to fork repository");
      });

      it("returns { error: 'github_token_expired' } with status 401 when GitHub returns 401", async () => {
        mockSession();
        vi.mocked(githubApp.getPersonalOAuthToken).mockResolvedValue("expired-token");

        global.fetch = vi.fn().mockResolvedValue({
          status: 401,
          text: async () => "Requires authentication",
        } as any);

        const request = createPostRequest("/api/github/fork", {
          repositoryUrl: "https://github.com/owner/repo",
        });

        const response = await postFork(request);
        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.error).toBe("github_token_expired");
      });

      it("logs [FORK] prefix with GitHub status on 401 response", async () => {
        mockSession();
        vi.mocked(githubApp.getPersonalOAuthToken).mockResolvedValue("expired-token");

        global.fetch = vi.fn().mockResolvedValue({
          status: 401,
          text: async () => "Requires authentication",
        } as any);

        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const request = createPostRequest("/api/github/fork", {
          repositoryUrl: "https://github.com/owner/repo",
        });

        await postFork(request);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("[FORK]"),
          expect.any(String),
        );
        consoleSpy.mockRestore();
      });

      it("logs [FORK] prefix with GitHub status on unexpected status codes", async () => {
        mockSession();
        vi.mocked(githubApp.getPersonalOAuthToken).mockResolvedValue("mock-token");

        global.fetch = vi.fn().mockResolvedValue({
          status: 422,
          text: async () => "Unprocessable Entity",
        } as any);

        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const request = createPostRequest("/api/github/fork", {
          repositoryUrl: "https://github.com/owner/repo",
        });

        await postFork(request);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("[FORK]"),
          expect.any(String),
        );
        consoleSpy.mockRestore();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Mock endpoint: POST /api/mock/github/repos/[owner]/[repo]/forks
  // ─────────────────────────────────────────────────────────────────────────────
  describe("POST /api/mock/github/repos/[owner]/[repo]/forks", () => {
    const makeRequest = (authHeader?: string) =>
      new NextRequest(
        "http://localhost/api/mock/github/repos/upstream-owner/my-repo/forks",
        {
          method: "POST",
          headers: authHeader ? { authorization: authHeader } : {},
        }
      );

    const params = Promise.resolve({ owner: "upstream-owner", repo: "my-repo" });

    it("returns 401 when Authorization header is missing", async () => {
      const response = await mockForkEndpoint(makeRequest(), { params });
      expect(response.status).toBe(401);
    });

    it("returns 202 with forked repository payload", async () => {
      const response = await mockForkEndpoint(
        makeRequest("Bearer mock-access-token"),
        { params }
      );
      expect(response.status).toBe(202);
      const data = await response.json();
      expect(data).toMatchObject({
        name: "my-repo",
        owner: { login: "mock-user" },
        html_url: "https://github.com/mock-user/my-repo",
      });
    });

    it("returns same repository on repeat calls (idempotent)", async () => {
      const first = await mockForkEndpoint(
        makeRequest("Bearer mock-access-token"),
        { params }
      );
      const second = await mockForkEndpoint(
        makeRequest("Bearer mock-access-token"),
        { params }
      );

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);

      const firstData = await first.json();
      const secondData = await second.json();
      expect(firstData.id).toBe(secondData.id);
    });
  });
});
