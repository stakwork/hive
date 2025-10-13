import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { askTools } from "@/lib/ai/askTools";
import { z } from "zod";

// Mock external dependencies
vi.mock("gitsee/server", () => ({
  RepoAnalyzer: vi.fn().mockImplementation(() => ({
    getRecentCommitsWithFiles: vi.fn(),
    getContributorPRs: vi.fn(),
  })),
}));

vi.mock("aieo", () => ({
  getProviderTool: vi.fn(),
}));

// Mock global fetch
global.fetch = vi.fn();

// Import mocked modules
import { RepoAnalyzer } from "gitsee/server";
import { getProviderTool } from "aieo";

const mockRepoAnalyzer = RepoAnalyzer as Mock;
const mockGetProviderTool = getProviderTool as Mock;
const mockFetch = global.fetch as Mock;

// Test Data Factories
const TestDataFactory = {
  createValidToolParams: () => ({
    swarmUrl: "https://test-swarm.sphinx.chat",
    swarmApiKey: "sk_test_swarm_key_123",
    repoUrl: "https://github.com/test-org/test-repo",
    pat: "github_pat_test_token_123",
    apiKey: "sk_test_anthropic_key_456",
  }),

  createLearningsResponse: (overrides = {}) => ({
    learnings: [
      {
        id: "learning-1",
        question: "How to test AI tools?",
        answer: "Use mocking and isolation",
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "learning-2",
        question: "What is askTools?",
        answer: "A tool factory for AI orchestration",
        created_at: "2024-01-02T00:00:00Z",
      },
    ],
    ...overrides,
  }),

  createCommitsResponse: (count = 3) => ({
    commits: Array.from({ length: count }, (_, i) => ({
      sha: `commit-sha-${i + 1}`,
      message: `Commit message ${i + 1}`,
      author: `author-${i + 1}`,
      date: `2024-01-0${i + 1}T00:00:00Z`,
      files: [
        {
          filename: `file-${i + 1}.ts`,
          status: "modified",
          additions: 10,
          deletions: 5,
        },
      ],
    })),
  }),

  createContributionsResponse: (user: string, count = 2) => ({
    contributions: Array.from({ length: count }, (_, i) => ({
      pr_number: i + 1,
      pr_title: `PR ${i + 1} by ${user}`,
      issue_title: `Issue ${i + 1}`,
      commit_messages: [`Commit message ${i + 1}`],
      review_comments: [`Review comment ${i + 1}`],
    })),
  }),

  createWebSearchTool: () => ({
    description: "Web search tool",
    inputSchema: z.object({ query: z.string() }),
    execute: vi.fn().mockResolvedValue({ results: [] }),
  }),
};

// Test Helpers
const TestHelpers = {
  setupSuccessfulFetch: (responseData: any) => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => responseData,
    });
  },

  setupFailedFetch: (status = 500) => {
    mockFetch.mockResolvedValue({
      ok: false,
      status,
    });
  },

  setupFetchError: (error: Error) => {
    mockFetch.mockRejectedValue(error);
  },

  setupRepoAnalyzer: (
    commitsData: any,
    contributionsData: any,
  ) => {
    const mockInstance = {
      getRecentCommitsWithFiles: vi.fn().mockResolvedValue(commitsData),
      getContributorPRs: vi.fn().mockResolvedValue(contributionsData),
    };
    mockRepoAnalyzer.mockImplementation(() => mockInstance);
    return mockInstance;
  },

  expectToolStructure: (tool: any, expectedDescription: string) => {
    expect(tool).toHaveProperty("description");
    expect(tool.description).toBe(expectedDescription);
    expect(tool).toHaveProperty("inputSchema");
    expect(tool).toHaveProperty("execute");
    expect(typeof tool.execute).toBe("function");
  },
};

// Mock Setup Helpers
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
  },

  setupDefaultMocks: () => {
    mockGetProviderTool.mockReturnValue(TestDataFactory.createWebSearchTool());
  },
};

describe("askTools - Unit Tests", () => {
  beforeEach(() => {
    MockSetup.reset();
    MockSetup.setupDefaultMocks();
  });

  describe("askTools Factory Function", () => {
    test("should return object with 6 tools", () => {
      const params = TestDataFactory.createValidToolParams();
      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      expect(tools).toHaveProperty("get_learnings");
      expect(tools).toHaveProperty("ask_question");
      expect(tools).toHaveProperty("recent_commits");
      expect(tools).toHaveProperty("recent_contributions");
      expect(tools).toHaveProperty("web_search");
      expect(tools).toHaveProperty("final_answer");

      expect(Object.keys(tools)).toHaveLength(6);
    });

    test("should call getProviderTool for web_search", () => {
      const params = TestDataFactory.createValidToolParams();
      askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      expect(mockGetProviderTool).toHaveBeenCalledWith(
        "anthropic",
        params.apiKey,
        "webSearch",
      );
    });

    test("should create tools with correct structure", () => {
      const params = TestDataFactory.createValidToolParams();
      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      TestHelpers.expectToolStructure(
        tools.get_learnings,
        "Fetch previous learnings from the knowledge base.",
      );
      TestHelpers.expectToolStructure(
        tools.recent_commits,
        "Query a repo for recent commits. The output is a list of recent commits.",
      );
      TestHelpers.expectToolStructure(
        tools.recent_contributions,
        "Query a repo for recent PRs by a specific contributor. Input is the contributor's GitHub login. The output is a list of their most recent contributions, including PR titles, issue titles, commit messages, and code review comments.",
      );
      TestHelpers.expectToolStructure(
        tools.final_answer,
        "Provide the final answer to the user. YOU **MUST** CALL THIS TOOL",
      );
    });

    test("should handle different repository URL formats", () => {
      const repoUrls = [
        "https://github.com/owner/repo",
        "https://github.com/owner/repo.git",
        "git@github.com:owner/repo.git",
        "owner/repo",
      ];

      repoUrls.forEach((repoUrl) => {
        const params = TestDataFactory.createValidToolParams();
        expect(() =>
          askTools(
            params.swarmUrl,
            params.swarmApiKey,
            repoUrl,
            params.pat,
            params.apiKey,
          ),
        ).not.toThrow();
      });
    });
  });

  describe("get_learnings Tool", () => {
    test("should fetch learnings with default limit", async () => {
      const params = TestDataFactory.createValidToolParams();
      const learningsData = TestDataFactory.createLearningsResponse();
      TestHelpers.setupSuccessfulFetch(learningsData);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const result = await tools.get_learnings.execute({
        question: "How to test?",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${params.swarmUrl}/learnings?limit=3&question=${encodeURIComponent("How to test?")}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": params.swarmApiKey,
          },
        },
      );

      expect(result).toEqual(learningsData);
    });

    test("should fetch learnings with custom limit", async () => {
      const params = TestDataFactory.createValidToolParams();
      const learningsData = TestDataFactory.createLearningsResponse();
      TestHelpers.setupSuccessfulFetch(learningsData);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      await tools.get_learnings.execute({
        question: "What is testing?",
        limit: 10,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=10"),
        expect.any(Object),
      );
    });

    test("should return error message on fetch failure", async () => {
      const params = TestDataFactory.createValidToolParams();
      TestHelpers.setupFailedFetch(500);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const result = await tools.get_learnings.execute({
        question: "test",
      });

      expect(result).toEqual([]);
    });

    test("should handle network errors gracefully", async () => {
      const params = TestDataFactory.createValidToolParams();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      TestHelpers.setupFetchError(new Error("Network error"));

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const result = await tools.get_learnings.execute({
        question: "test",
      });

      expect(result).toBe("Could not retrieve learnings");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error retrieving learnings:",
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    test("should validate input schema", () => {
      const params = TestDataFactory.createValidToolParams();
      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const schema = tools.get_learnings.inputSchema;

      // Valid input
      expect(() => schema.parse({ question: "test" })).not.toThrow();
      expect(() => schema.parse({ question: "test", limit: 5 })).not.toThrow();

      // Invalid input
      expect(() => schema.parse({})).toThrow();
      expect(() => schema.parse({ question: 123 })).toThrow();
    });
  });

  describe("recent_commits Tool", () => {
    test("should fetch recent commits with default limit", async () => {
      const params = TestDataFactory.createValidToolParams();
      const commitsData = TestDataFactory.createCommitsResponse();

      const mockInstance = TestHelpers.setupRepoAnalyzer(commitsData, null);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const result = await tools.recent_commits.execute({});

      expect(mockRepoAnalyzer).toHaveBeenCalledWith({
        githubToken: params.pat,
      });

      expect(mockInstance.getRecentCommitsWithFiles).toHaveBeenCalledWith(
        "test-org",
        "test-repo",
        { limit: 10 },
      );

      expect(result).toEqual(commitsData);
    });

    test("should fetch recent commits with custom limit", async () => {
      const params = TestDataFactory.createValidToolParams();
      const commitsData = TestDataFactory.createCommitsResponse(5);

      const mockInstance = TestHelpers.setupRepoAnalyzer(commitsData, null);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      await tools.recent_commits.execute({ limit: 5 });

      expect(mockInstance.getRecentCommitsWithFiles).toHaveBeenCalledWith(
        "test-org",
        "test-repo",
        { limit: 5 },
      );
    });

    test("should handle RepoAnalyzer errors gracefully", async () => {
      const params = TestDataFactory.createValidToolParams();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockInstance = {
        getRecentCommitsWithFiles: vi.fn().mockRejectedValue(new Error("GitHub API error")),
        getContributorPRs: vi.fn(),
      };
      mockRepoAnalyzer.mockImplementation(() => mockInstance);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const result = await tools.recent_commits.execute({});

      expect(result).toBe("Could not retrieve recent commits");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error retrieving recent commits:",
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    test("should validate input schema", () => {
      const params = TestDataFactory.createValidToolParams();
      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const schema = tools.recent_commits.inputSchema;

      // Valid input
      expect(() => schema.parse({})).not.toThrow();
      expect(() => schema.parse({ limit: 20 })).not.toThrow();

      // Invalid input
      expect(() => schema.parse({ limit: "10" })).toThrow();
    });

    test("should parse repository URL correctly", async () => {
      const params = TestDataFactory.createValidToolParams();
      const commitsData = TestDataFactory.createCommitsResponse();

      const mockInstance = TestHelpers.setupRepoAnalyzer(commitsData, null);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        "https://github.com/owner-name/repo-name",
        params.pat,
        params.apiKey,
      );

      await tools.recent_commits.execute({});

      expect(mockInstance.getRecentCommitsWithFiles).toHaveBeenCalledWith(
        "owner-name",
        "repo-name",
        expect.any(Object),
      );
    });
  });

  describe("recent_contributions Tool", () => {
    test("should fetch contributor PRs with default limit", async () => {
      const params = TestDataFactory.createValidToolParams();
      const contributionsData = TestDataFactory.createContributionsResponse("testuser");

      const mockInstance = TestHelpers.setupRepoAnalyzer(null, contributionsData);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const result = await tools.recent_contributions.execute({
        user: "testuser",
      });

      expect(mockRepoAnalyzer).toHaveBeenCalledWith({
        githubToken: params.pat,
      });

      expect(mockInstance.getContributorPRs).toHaveBeenCalledWith(
        "test-org",
        "test-repo",
        "testuser",
        5,
      );

      expect(result).toEqual(contributionsData);
    });

    test("should fetch contributor PRs with custom limit", async () => {
      const params = TestDataFactory.createValidToolParams();
      const contributionsData = TestDataFactory.createContributionsResponse("contributor", 10);

      const mockInstance = TestHelpers.setupRepoAnalyzer(null, contributionsData);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      await tools.recent_contributions.execute({
        user: "contributor",
        limit: 10,
      });

      expect(mockInstance.getContributorPRs).toHaveBeenCalledWith(
        "test-org",
        "test-repo",
        "contributor",
        10,
      );
    });

    test("should handle RepoAnalyzer errors gracefully", async () => {
      const params = TestDataFactory.createValidToolParams();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockInstance = {
        getRecentCommitsWithFiles: vi.fn(),
        getContributorPRs: vi.fn().mockRejectedValue(new Error("GitHub API error")),
      };
      mockRepoAnalyzer.mockImplementation(() => mockInstance);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const result = await tools.recent_contributions.execute({
        user: "testuser",
      });

      expect(result).toBe("Could not retrieve repository map");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error retrieving recent contributions:",
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    test("should validate input schema", () => {
      const params = TestDataFactory.createValidToolParams();
      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const schema = tools.recent_contributions.inputSchema;

      // Valid input
      expect(() => schema.parse({ user: "testuser" })).not.toThrow();
      expect(() => schema.parse({ user: "testuser", limit: 10 })).not.toThrow();

      // Invalid input
      expect(() => schema.parse({})).toThrow();
      expect(() => schema.parse({ user: 123 })).toThrow();
      expect(() => schema.parse({ user: "testuser", limit: "10" })).toThrow();
    });
  });

  describe("web_search Tool", () => {
    test("should return web_search tool from getProviderTool", () => {
      const params = TestDataFactory.createValidToolParams();
      const mockWebSearchTool = TestDataFactory.createWebSearchTool();
      mockGetProviderTool.mockReturnValue(mockWebSearchTool);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      expect(tools.web_search).toBe(mockWebSearchTool);
      expect(mockGetProviderTool).toHaveBeenCalledWith(
        "anthropic",
        params.apiKey,
        "webSearch",
      );
    });

    test("should use correct Anthropic API key", () => {
      const params = TestDataFactory.createValidToolParams();
      const customApiKey = "sk_custom_anthropic_key";

      askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        customApiKey,
      );

      expect(mockGetProviderTool).toHaveBeenCalledWith(
        "anthropic",
        customApiKey,
        "webSearch",
      );
    });
  });

  describe("final_answer Tool", () => {
    test("should return answer string directly", async () => {
      const params = TestDataFactory.createValidToolParams();
      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const testAnswer = "This is the final answer to the user's question.";
      const result = await tools.final_answer.execute({ answer: testAnswer });

      expect(result).toBe(testAnswer);
    });

    test("should validate input schema", () => {
      const params = TestDataFactory.createValidToolParams();
      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const schema = tools.final_answer.inputSchema;

      // Valid input
      expect(() => schema.parse({ answer: "test answer" })).not.toThrow();

      // Invalid input
      expect(() => schema.parse({})).toThrow();
      expect(() => schema.parse({ answer: 123 })).toThrow();
    });

    test("should handle empty string answer", async () => {
      const params = TestDataFactory.createValidToolParams();
      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const result = await tools.final_answer.execute({ answer: "" });
      expect(result).toBe("");
    });

    test("should handle long answer strings", async () => {
      const params = TestDataFactory.createValidToolParams();
      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const longAnswer = "A".repeat(10000);
      const result = await tools.final_answer.execute({ answer: longAnswer });
      expect(result).toBe(longAnswer);
    });
  });

  describe("Error Handling", () => {
    test("should handle malformed swarm URL gracefully", async () => {
      const params = TestDataFactory.createValidToolParams();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      TestHelpers.setupFetchError(new TypeError("Invalid URL"));

      const tools = askTools(
        "invalid-url",
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const result = await tools.get_learnings.execute({ question: "test" });

      expect(result).toBe("Could not retrieve learnings");
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    test("should handle missing GitHub PAT gracefully", async () => {
      const params = TestDataFactory.createValidToolParams();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockInstance = {
        getRecentCommitsWithFiles: vi.fn().mockRejectedValue(new Error("Unauthorized")),
        getContributorPRs: vi.fn(),
      };
      mockRepoAnalyzer.mockImplementation(() => mockInstance);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        "",
        params.apiKey,
      );

      const result = await tools.recent_commits.execute({});

      expect(result).toBe("Could not retrieve recent commits");
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    test("should handle timeout errors", async () => {
      const params = TestDataFactory.createValidToolParams();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      TestHelpers.setupFetchError(new Error("Request timeout"));

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const result = await tools.get_learnings.execute({ question: "test" });

      expect(result).toBe("Could not retrieve learnings");

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    test("should handle special characters in question", async () => {
      const params = TestDataFactory.createValidToolParams();
      const learningsData = TestDataFactory.createLearningsResponse();
      TestHelpers.setupSuccessfulFetch(learningsData);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      const specialQuestion = "What is <script>alert('xss')</script>?";
      await tools.get_learnings.execute({ question: specialQuestion });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(specialQuestion)),
        expect.any(Object),
      );
    });

    test("should fallback to default limit when zero is provided", async () => {
      const params = TestDataFactory.createValidToolParams();
      const learningsData = TestDataFactory.createLearningsResponse();
      TestHelpers.setupSuccessfulFetch(learningsData);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      await tools.get_learnings.execute({ question: "test", limit: 0 });

      // Implementation uses "limit || 3" so zero falls back to default of 3
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=3"),
        expect.any(Object),
      );
    });

    test("should handle very large limit parameter", async () => {
      const params = TestDataFactory.createValidToolParams();
      const commitsData = TestDataFactory.createCommitsResponse(1000);

      const mockInstance = TestHelpers.setupRepoAnalyzer(commitsData, null);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        params.repoUrl,
        params.pat,
        params.apiKey,
      );

      await tools.recent_commits.execute({ limit: 1000 });

      expect(mockInstance.getRecentCommitsWithFiles).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { limit: 1000 },
      );
    });

    test("should handle repository URL without owner/repo format", async () => {
      const params = TestDataFactory.createValidToolParams();
      const commitsData = TestDataFactory.createCommitsResponse();

      const mockInstance = TestHelpers.setupRepoAnalyzer(commitsData, null);

      const tools = askTools(
        params.swarmUrl,
        params.swarmApiKey,
        "test-org/test-repo",
        params.pat,
        params.apiKey,
      );

      await tools.recent_commits.execute({});

      expect(mockInstance.getRecentCommitsWithFiles).toHaveBeenCalledWith(
        "test-org",
        "test-repo",
        expect.any(Object),
      );
    });
  });
});