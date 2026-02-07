import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseOwnerRepo } from "@/lib/ai/utils";

// Use vi.hoisted to create mocks that can be accessed in vi.mock factories
const { mockGetRecentCommitsWithFiles, mockGetContributorPRs, mockGetProviderTool, mockCreateMCPClient } = vi.hoisted(() => ({
  mockGetRecentCommitsWithFiles: vi.fn(),
  mockGetContributorPRs: vi.fn(),
  mockGetProviderTool: vi.fn(),
  mockCreateMCPClient: vi.fn(),
}));

// Mock external dependencies using the hoisted mock instances
vi.mock("gitsee/server", () => ({
  RepoAnalyzer: vi.fn().mockImplementation(() => ({
    getRecentCommitsWithFiles: mockGetRecentCommitsWithFiles,
    getContributorPRs: mockGetContributorPRs,
  })),
}));

vi.mock("@/lib/ai/provider", () => ({
  getProviderTool: mockGetProviderTool,
}));

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: mockCreateMCPClient,
}));

import { askTools } from "@/lib/ai/askTools";

describe("askTools", () => {
  const mockSwarmUrl = "https://swarm.example.com";
  const mockSwarmApiKey = "test-swarm-key";
  const mockRepoUrl = "https://github.com/test-owner/test-repo";
  const mockPat = "test-github-token";
  const mockApiKey = "test-api-key";

  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Clear mock call history but preserve implementations
    mockGetRecentCommitsWithFiles.mockClear();
    mockGetContributorPRs.mockClear();
    mockGetProviderTool.mockClear();

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    // Set default mock implementations
    mockGetRecentCommitsWithFiles.mockResolvedValue([]);
    mockGetContributorPRs.mockResolvedValue([]);
    mockGetProviderTool.mockReturnValue({
      description: "Mock web search",
      parameters: {},
      execute: vi.fn(),
    });
  });

  describe("factory function", () => {
    it("returns object with all 7 tools", () => {
      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      expect(tools).toHaveProperty("list_concepts");
      expect(tools).toHaveProperty("learn_concept");
      expect(tools).toHaveProperty("recent_commits");
      expect(tools).toHaveProperty("recent_contributions");
      expect(tools).toHaveProperty("repo_agent");
      expect(tools).toHaveProperty("search_logs");
      expect(tools).toHaveProperty("web_search");
    });

    it("parses repository URL correctly", () => {
      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const { owner, repo } = parseOwnerRepo(mockRepoUrl);

      expect(owner).toBe("test-owner");
      expect(repo).toBe("test-repo");
    });

    it("calls getProviderTool for web_search", () => {
      mockGetProviderTool.mockReturnValue({
        description: "Mock web search",
        parameters: {},
        execute: vi.fn(),
      });

      askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      expect(mockGetProviderTool).toHaveBeenCalledWith("anthropic", mockApiKey, "webSearch");
    });
  });

  describe("list_concepts tool", () => {
    it("returns feature list on success", async () => {
      const mockFeatures = [
        { id: "feature-1", name: "Feature 1", description: "Description 1" },
        { id: "feature-2", name: "Feature 2", description: "Description 2" },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockFeatures,
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.list_concepts.execute({});

      expect(result).toEqual(mockFeatures);
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockSwarmUrl}/gitree/features`,
        expect.objectContaining({
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": mockSwarmApiKey,
          },
        })
      );
    });

    it("returns error message on failure", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.list_concepts.execute({});

      expect(result).toBe("Could not retrieve features");
    });

    it("has correct tool structure", () => {
      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      expect(tools.list_concepts.description).toBeDefined();
      expect(tools.list_concepts.execute).toBeDefined();
      expect(typeof tools.list_concepts.execute).toBe("function");
    });
  });

  describe("learn_concept tool", () => {
    it("returns feature documentation on success", async () => {
      const mockFeatureData = {
        id: "feature-1",
        name: "Feature 1",
        documentation: "Detailed docs",
        prs: [],
        commits: [],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockFeatureData,
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.learn_concept.execute({ conceptId: "feature-1" });

      expect(result).toEqual(mockFeatureData);
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockSwarmUrl}/gitree/features/${encodeURIComponent("feature-1")}`,
        expect.objectContaining({
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": mockSwarmApiKey,
          },
        })
      );
    });

    it("returns error object when feature not found", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.learn_concept.execute({ conceptId: "nonexistent" });

      expect(result).toEqual({ error: "Feature not found" });
    });

    it("returns error message on fetch failure", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.learn_concept.execute({ conceptId: "feature-1" });

      expect(result).toBe("Could not retrieve feature documentation");
    });

    it("encodes conceptId in URL correctly", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      await tools.learn_concept.execute({ conceptId: "feature/with/slashes" });

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockSwarmUrl}/gitree/features/${encodeURIComponent("feature/with/slashes")}`,
        expect.any(Object)
      );
    });
  });

  describe("recent_commits tool", () => {
    it("returns commit list with default limit", async () => {
      const mockCommits = [
        { sha: "abc123", message: "Commit 1", files: [] },
        { sha: "def456", message: "Commit 2", files: [] },
      ];

      mockGetRecentCommitsWithFiles.mockResolvedValue(mockCommits as any);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_commits.execute({});

      expect(result).toEqual(mockCommits);
      expect(mockGetRecentCommitsWithFiles).toHaveBeenCalledWith(
        "test-owner",
        "test-repo",
        { limit: 10 }
      );
    });

    it("returns commit list with custom limit", async () => {
      const mockCommits = [{ sha: "abc123", message: "Commit 1", files: [] }];

      mockGetRecentCommitsWithFiles.mockResolvedValue(mockCommits as any);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_commits.execute({ limit: 5 });

      expect(result).toEqual(mockCommits);
      expect(mockGetRecentCommitsWithFiles).toHaveBeenCalledWith(
        "test-owner",
        "test-repo",
        { limit: 5 }
      );
    });

    it("returns error message on failure", async () => {
      mockGetRecentCommitsWithFiles.mockRejectedValue(new Error("GitHub API error"));

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_commits.execute({});

      expect(result).toBe("Could not retrieve recent commits");
    });

    it("uses limit from parameter or fallback to 10", async () => {
      const mockCommits: any[] = [];
      mockGetRecentCommitsWithFiles.mockResolvedValue(mockCommits);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      
      // Test with explicit limit
      await tools.recent_commits.execute({ limit: 20 });
      expect(mockGetRecentCommitsWithFiles).toHaveBeenCalledWith(
        "test-owner",
        "test-repo",
        { limit: 20 }
      );

      // Test with undefined limit (should use 10)
      await tools.recent_commits.execute({});
      expect(mockGetRecentCommitsWithFiles).toHaveBeenCalledWith(
        "test-owner",
        "test-repo",
        { limit: 10 }
      );
    });
  });

  describe("recent_contributions tool", () => {
    it("returns contributions with default limit", async () => {
      const mockContributions = [
        { pr: { title: "PR 1" }, commits: [], reviews: [] },
        { pr: { title: "PR 2" }, commits: [], reviews: [] },
      ];

      mockGetContributorPRs.mockResolvedValue(mockContributions as any);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_contributions.execute({ user: "testuser" });

      expect(result).toEqual(mockContributions);
      expect(mockGetContributorPRs).toHaveBeenCalledWith(
        "test-owner",
        "test-repo",
        "testuser",
        5
      );
    });

    it("returns contributions with custom limit", async () => {
      const mockContributions = [{ pr: { title: "PR 1" }, commits: [], reviews: [] }];

      mockGetContributorPRs.mockResolvedValue(mockContributions as any);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_contributions.execute({ user: "testuser", limit: 10 });

      expect(result).toEqual(mockContributions);
      expect(mockGetContributorPRs).toHaveBeenCalledWith(
        "test-owner",
        "test-repo",
        "testuser",
        10
      );
    });

    it("returns error message on failure", async () => {
      mockGetContributorPRs.mockRejectedValue(new Error("GitHub API error"));

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_contributions.execute({ user: "testuser" });

      expect(result).toBe("Could not retrieve repository map");
    });

    it("uses limit from parameter or fallback to 5", async () => {
      const mockContributions: any[] = [];
      mockGetContributorPRs.mockResolvedValue(mockContributions);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      
      // Test with explicit limit
      await tools.recent_contributions.execute({ user: "testuser", limit: 15 });
      expect(mockGetContributorPRs).toHaveBeenCalledWith(
        "test-owner",
        "test-repo",
        "testuser",
        15
      );

      // Test with undefined limit (should use 5)
      await tools.recent_contributions.execute({ user: "testuser" });
      expect(mockGetContributorPRs).toHaveBeenCalledWith(
        "test-owner",
        "test-repo",
        "testuser",
        5
      );
    });
  });

  describe("repo_agent tool", () => {
    it("returns agent response on success", async () => {
      // Use fake timers to avoid actual waiting
      vi.useFakeTimers();
      
      // Mock initiate response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: "test-request-123" }),
      });
      
      // Mock progress response (completed)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "completed",
          result: { content: "Analysis result" },
        }),
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const executePromise = tools.repo_agent.execute({ prompt: "Analyze this code" });
      
      // Fast-forward through the setTimeout delay
      await vi.advanceTimersByTimeAsync(5000);
      
      const result = await executePromise;

      expect(result).toBe("Analysis result");
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockSwarmUrl}/repo/agent`,
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": mockSwarmApiKey,
          },
          body: expect.stringContaining("Analyze this code"),
        })
      );
      
      vi.useRealTimers();
    });

    it("appends optimization instructions to prompt", async () => {
      vi.useFakeTimers();
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: "test-request-456" }),
      });
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "completed",
          result: { content: "Result" },
        }),
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const executePromise = tools.repo_agent.execute({ prompt: "Test prompt" });
      
      await vi.advanceTimersByTimeAsync(5000);
      await executePromise;

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.prompt).toContain("PLEASE BE AS FAST AS POSSIBLE");
      expect(callBody.prompt).toContain("Test prompt");
      
      vi.useRealTimers();
    });

    it("returns error message on failure", async () => {
      mockFetch.mockRejectedValue(new Error("Agent execution failed"));

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.repo_agent.execute({ prompt: "Analyze this code" });

      expect(result).toBe("Could not execute repo agent");
    });
  });

  describe("search_logs tool", () => {
    beforeEach(() => {
      mockCreateMCPClient.mockClear();
    });

    it("executes search_logs tool successfully", async () => {
      const mockLogs = [
        { timestamp: "2024-01-01T00:00:00Z", level: "INFO", message: "Log entry 1" },
        { timestamp: "2024-01-01T00:00:01Z", level: "ERROR", message: "Log entry 2" },
      ];

      const mockClose = vi.fn();
      const mockExecute = vi.fn().mockResolvedValue(mockLogs);
      const mockTools = {
        search_logs: {
          execute: mockExecute,
        },
      };

      mockCreateMCPClient.mockResolvedValue({
        tools: vi.fn().mockResolvedValue(mockTools),
        close: mockClose,
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.search_logs.execute({ query: "*", max_hits: 10 });

      expect(result).toEqual(mockLogs);
      expect(mockCreateMCPClient).toHaveBeenCalledWith({
        transport: {
          type: 'http',
          url: `${mockSwarmUrl}/mcp`,
          headers: {
            Authorization: `Bearer ${mockSwarmApiKey}`,
          },
        },
      });
      expect(mockExecute).toHaveBeenCalledWith(
        { query: "*", max_hits: 10 },
        { toolCallId: '1', messages: [] }
      );
      expect(mockClose).toHaveBeenCalled();
    });

    it("handles search_logs MCP connection failure", async () => {
      mockCreateMCPClient.mockRejectedValue(new Error("MCP connection failed"));

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.search_logs.execute({ query: "level:ERROR" });

      expect(result).toBe("Could not search logs");
    });

    it("closes MCP client after execution", async () => {
      const mockClose = vi.fn();
      const mockExecute = vi.fn().mockResolvedValue([]);
      const mockTools = {
        search_logs: {
          execute: mockExecute,
        },
      };

      mockCreateMCPClient.mockResolvedValue({
        tools: vi.fn().mockResolvedValue(mockTools),
        close: mockClose,
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      await tools.search_logs.execute({ query: "*" });

      expect(mockClose).toHaveBeenCalled();
    });

    it("closes MCP client even on error", async () => {
      const mockClose = vi.fn();
      const mockExecute = vi.fn().mockRejectedValue(new Error("Execution failed"));
      const mockTools = {
        search_logs: {
          execute: mockExecute,
        },
      };

      mockCreateMCPClient.mockResolvedValue({
        tools: vi.fn().mockResolvedValue(mockTools),
        close: mockClose,
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.search_logs.execute({ query: "*" });

      expect(result).toBe("Could not search logs");
      expect(mockClose).toHaveBeenCalled();
    });

    it("uses default max_hits value when not provided", async () => {
      const mockClose = vi.fn();
      const mockExecute = vi.fn().mockResolvedValue([]);
      const mockTools = {
        search_logs: {
          execute: mockExecute,
        },
      };

      mockCreateMCPClient.mockResolvedValue({
        tools: vi.fn().mockResolvedValue(mockTools),
        close: mockClose,
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      await tools.search_logs.execute({ query: "*" });

      expect(mockExecute).toHaveBeenCalledWith(
        { query: "*", max_hits: 10 },
        { toolCallId: '1', messages: [] }
      );
    });

    it("handles missing search_logs tool on MCP server", async () => {
      const mockClose = vi.fn();
      const mockTools = {}; // No search_logs tool

      mockCreateMCPClient.mockResolvedValue({
        tools: vi.fn().mockResolvedValue(mockTools),
        close: mockClose,
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.search_logs.execute({ query: "*" });

      expect(result).toBe("search_logs tool not found on MCP server");
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe("web_search tool", () => {
    it("returns web_search tool from provider", () => {
      const mockWebSearchTool = {
        description: "Search the web",
        parameters: { query: "string" },
        execute: vi.fn(),
      };

      mockGetProviderTool.mockReturnValue(mockWebSearchTool);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      expect(tools.web_search).toEqual(mockWebSearchTool);
    });
  });

  describe("error handling", () => {
    it("handles errors gracefully without throwing", async () => {
      mockFetch.mockRejectedValue(new Error("Critical failure"));

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      
      // Should not throw, should return error message
      await expect(tools.list_concepts.execute({})).resolves.toBe("Could not retrieve features");
    });

    it("all tools return error strings instead of throwing exceptions", async () => {
      // Setup all tools to fail
      mockFetch.mockRejectedValue(new Error("Fail"));
      mockGetRecentCommitsWithFiles.mockRejectedValue(new Error("Fail"));
      mockGetContributorPRs.mockRejectedValue(new Error("Fail"));

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      // All tools should return error messages, not throw
      await expect(tools.list_concepts.execute({})).resolves.toBe("Could not retrieve features");
      await expect(tools.learn_concept.execute({ conceptId: "test" })).resolves.toBe(
        "Could not retrieve feature documentation"
      );
      await expect(tools.recent_commits.execute({})).resolves.toBe(
        "Could not retrieve recent commits"
      );
      await expect(tools.recent_contributions.execute({ user: "test" })).resolves.toBe(
        "Could not retrieve repository map"
      );
      await expect(tools.repo_agent.execute({ prompt: "test" })).resolves.toBe(
        "Could not execute repo agent"
      );
    });
  });

  describe("edge cases", () => {
    it("handles empty feature list", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.list_concepts.execute({});

      expect(result).toEqual([]);
    });

    it("handles special characters in conceptId", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "special!@#$%^&*()" }),
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      await tools.learn_concept.execute({ conceptId: "special!@#$%^&*()" });

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockSwarmUrl}/gitree/features/${encodeURIComponent("special!@#$%^&*()")}`,
        expect.any(Object)
      );
    });

    it("handles empty commit list", async () => {
      mockGetRecentCommitsWithFiles.mockResolvedValue([]);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_commits.execute({});

      expect(result).toEqual([]);
    });

    it("handles empty contributions list", async () => {
      mockGetContributorPRs.mockResolvedValue([]);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_contributions.execute({ user: "testuser" });

      expect(result).toEqual([]);
    });
  });
});
