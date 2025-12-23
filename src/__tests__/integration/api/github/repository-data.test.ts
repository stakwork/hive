import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/github/repository/data/route";
import { createGetRequest } from "@/__tests__/support/helpers/request-builders";
import { mockGitHubState } from "@/lib/mock/github-state";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import * as githubApp from "@/lib/githubApp";
import * as nextAuth from "next-auth/next";
import axios from "axios";

vi.mock("@/lib/githubApp");
vi.mock("next-auth/next");
vi.mock("axios");

describe("GET /api/github/repository/data", () => {
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

  describe("Authentication & Authorization", () => {
    it("should return 401 when user is not authenticated", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(null);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Request Validation", () => {
    it("should return 400 when repoUrl parameter is missing", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest("/api/github/repository/data");

      const response = await GET(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Repo URL is required");
    });
  });

  describe("URL Parsing", () => {
    it("should parse HTTPS repository URL correctly", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = mockGitHubState.createRepository("owner", "repo");
      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [] }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      expect(axiosInstance.get).toHaveBeenCalledWith("/repos/owner/repo");
    });

    it("should parse SSH repository URL correctly", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = mockGitHubState.createRepository("owner", "repo");
      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [] }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "git@github.com:owner/repo.git",
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      expect(axiosInstance.get).toHaveBeenCalledWith("/repos/owner/repo");
    });

    it("should handle HTTPS URL without trailing slash", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = mockGitHubState.createRepository("testowner", "testrepo");
      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [] }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/testowner/testrepo",
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
    });
  });

  describe("Token Management", () => {
    it("should return 403 when GitHub App tokens are not found", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue(null);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain("No GitHub App tokens found");
    });

    it("should use Bearer token format for GitHub App authentication", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = mockGitHubState.createRepository("owner", "repo");
      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "test-github-app-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [] }),
      };
      const axiosCreateSpy = vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      await GET(request);

      expect(axiosCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-github-app-token",
          }),
        })
      );
    });
  });

  describe("Successful Data Retrieval", () => {
    it("should return repository data with contributors and issues", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = mockGitHubState.createRepository("owner", "repo");
      const mockContributors = [
        {
          login: "contributor1",
          id: 1001,
          avatar_url: "https://avatars.githubusercontent.com/u/1001",
          html_url: "https://github.com/contributor1",
          contributions: 50,
        },
      ];
      const mockIssues = [
        {
          id: 2001,
          number: 1,
          title: "Test Issue",
          state: "open",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          html_url: "https://github.com/owner/repo/issues/1",
          user: {
            login: "user1",
            avatar_url: "https://avatars.githubusercontent.com/u/2001",
          },
        },
      ];

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: mockContributors })
          .mockResolvedValueOnce({ data: mockIssues }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.message).toBe("Repository data retrieved successfully");
      expect(result.data).toBeDefined();
      expect(result.data.name).toBe("repo");
      expect(result.data.full_name).toBe("owner/repo");
      expect(result.data.contributors).toHaveLength(1);
      expect(result.data.recent_issues).toHaveLength(1);
    });

    it("should fetch contributors with per_page=30 parameter", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = mockGitHubState.createRepository("owner", "repo");
      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [] }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      await GET(request);

      expect(axiosInstance.get).toHaveBeenCalledWith(
        "/repos/owner/repo/contributors?per_page=30"
      );
    });

    it("should fetch recent issues with correct query parameters", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = mockGitHubState.createRepository("owner", "repo");
      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [] }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      await GET(request);

      expect(axiosInstance.get).toHaveBeenCalledWith(
        "/repos/owner/repo/issues?state=all&sort=updated&direction=desc&per_page=20"
      );
    });

    it("should include all required repository fields in response", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = {
        id: 12345,
        name: "test-repo",
        full_name: "owner/test-repo",
        description: "Test repository description",
        private: false,
        html_url: "https://github.com/owner/test-repo",
        stargazers_count: 100,
        watchers_count: 50,
        forks_count: 25,
        open_issues_count: 10,
        default_branch: "main",
        language: "TypeScript",
        topics: ["test", "demo"],
        created_at: "2023-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [] }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/test-repo",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(result.data).toMatchObject({
        id: 12345,
        name: "test-repo",
        full_name: "owner/test-repo",
        description: "Test repository description",
        private: false,
        html_url: "https://github.com/owner/test-repo",
        stargazers_count: 100,
        watchers_count: 50,
        forks_count: 25,
        open_issues_count: 10,
        default_branch: "main",
        language: "TypeScript",
        topics: ["test", "demo"],
        created_at: "2023-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });
    });
  });

  describe("Error Handling", () => {
    it("should return 401 when GitHub token is expired or invalid", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "expired-token",
      });

      const axiosInstance = {
        get: vi.fn().mockRejectedValue({
          response: { status: 401 },
        }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("GitHub token expired or invalid");
    });

    it("should return 404 when repository is not found", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi.fn().mockRejectedValue({
          response: { status: 404 },
        }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/nonexistent",
      });

      const response = await GET(request);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Repository not found or no access");
    });

    it("should return 403 when GitHub API rate limit is exceeded", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi.fn().mockRejectedValue({
          response: { status: 403 },
        }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("GitHub API rate limit exceeded");
    });

    it("should return 500 for unexpected errors", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi.fn().mockRejectedValue(new Error("Network error")),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to fetch repository data");
    });

    it("should handle errors without response object", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi.fn().mockRejectedValue({ message: "Connection refused" }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to fetch repository data");
    });
  });

  describe("Data Transformation", () => {
    it("should correctly transform contributor data", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = mockGitHubState.createRepository("owner", "repo");
      const mockContributors = [
        {
          login: "contributor1",
          id: 1001,
          avatar_url: "https://avatars.githubusercontent.com/u/1001",
          html_url: "https://github.com/contributor1",
          contributions: 50,
          type: "User",
          site_admin: false,
        },
      ];

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: mockContributors })
          .mockResolvedValueOnce({ data: [] }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(result.data.contributors).toHaveLength(1);
      expect(result.data.contributors[0]).toEqual({
        login: "contributor1",
        id: 1001,
        avatar_url: "https://avatars.githubusercontent.com/u/1001",
        html_url: "https://github.com/contributor1",
        contributions: 50,
      });
    });

    it("should correctly transform issue data", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = mockGitHubState.createRepository("owner", "repo");
      const createdAt = new Date().toISOString();
      const updatedAt = new Date().toISOString();
      const mockIssues = [
        {
          id: 2001,
          number: 1,
          title: "Test Issue",
          state: "open",
          created_at: createdAt,
          updated_at: updatedAt,
          html_url: "https://github.com/owner/repo/issues/1",
          user: {
            login: "user1",
            id: 3001,
            avatar_url: "https://avatars.githubusercontent.com/u/3001",
          },
          labels: [],
          assignees: [],
        },
      ];

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: mockIssues }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(result.data.recent_issues).toHaveLength(1);
      expect(result.data.recent_issues[0]).toEqual({
        id: 2001,
        number: 1,
        title: "Test Issue",
        state: "open",
        created_at: createdAt,
        updated_at: updatedAt,
        html_url: "https://github.com/owner/repo/issues/1",
        user: {
          login: "user1",
          avatar_url: "https://avatars.githubusercontent.com/u/3001",
        },
      });
    });

    it("should handle empty topics array", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = {
        ...mockGitHubState.createRepository("owner", "repo"),
        topics: null,
      };

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [] }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(result.data.topics).toEqual([]);
    });

    it("should handle multiple contributors and issues", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: testUser,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockRepo = mockGitHubState.createRepository("owner", "repo");
      const mockContributors = Array.from({ length: 5 }, (_, i) => ({
        login: `contributor${i + 1}`,
        id: 1000 + i,
        avatar_url: `https://avatars.githubusercontent.com/u/${1000 + i}`,
        html_url: `https://github.com/contributor${i + 1}`,
        contributions: 50 - i * 5,
      }));
      const mockIssues = Array.from({ length: 10 }, (_, i) => ({
        id: 2000 + i,
        number: i + 1,
        title: `Test Issue ${i + 1}`,
        state: i % 2 === 0 ? "open" : "closed",
        created_at: new Date(Date.now() - i * 86400000).toISOString(),
        updated_at: new Date(Date.now() - i * 43200000).toISOString(),
        html_url: `https://github.com/owner/repo/issues/${i + 1}`,
        user: {
          login: `user${i + 1}`,
          avatar_url: `https://avatars.githubusercontent.com/u/${3000 + i}`,
        },
      }));

      vi.mocked(githubApp.getUserAppTokens).mockResolvedValue({
        accessToken: "mock-token",
      });

      const axiosInstance = {
        get: vi
          .fn()
          .mockResolvedValueOnce({ data: mockRepo })
          .mockResolvedValueOnce({ data: mockContributors })
          .mockResolvedValueOnce({ data: mockIssues }),
      };
      vi.mocked(axios.create).mockReturnValue(axiosInstance as any);

      const request = createGetRequest("/api/github/repository/data", {
        repoUrl: "https://github.com/owner/repo",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(result.data.contributors).toHaveLength(5);
      expect(result.data.recent_issues).toHaveLength(10);
      expect(result.data.recent_issues[0].state).toBe("open");
      expect(result.data.recent_issues[1].state).toBe("closed");
    });
  });
});
