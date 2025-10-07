import { describe, test, expect, beforeEach, vi } from "vitest";
import { askTools } from "@/lib/ai/askTools";

// Mock test utilities
const createTestConfig = () => ({
  swarmUrl: "https://test-swarm.example.com",
  swarmApiKey: "test-swarm-api-key",
  repoUrl: "https://github.com/test-owner/test-repo",
  pat: "test-github-pat",
  apiKey: "test-anthropic-api-key",
});

const createTestLearnings = () => [
  {
    id: "learning-1",
    question: "What is testing?",
    answer: "Testing verifies code behavior",
    createdAt: new Date().toISOString(),
  },
  {
    id: "learning-2", 
    question: "How to mock?",
    answer: "Use vi.mock() for mocking",
    createdAt: new Date().toISOString(),
  },
];

const createMockFetchResponse = (ok: boolean, data: any = null) => ({
  ok,
  json: vi.fn().mockResolvedValue(data),
  status: ok ? 200 : 500,
  statusText: ok ? "OK" : "Internal Server Error",
});

// Mock external dependencies
vi.mock("gitsee/server", () => ({
  RepoAnalyzer: vi.fn().mockImplementation(() => ({
    getRecentCommitsWithFiles: vi.fn().mockResolvedValue([
      {
        sha: "abc123",
        message: "Test commit",
        author: "test-user",
        files: ["file1.ts"],
      },
    ]),
    getContributorPRs: vi.fn().mockResolvedValue([
      {
        number: 1,
        title: "Test PR",
        user: "test-user",
        commits: [],
      },
    ]),
  })),
}));

vi.mock("aieo", () => ({
  getProviderTool: vi.fn().mockReturnValue({
    description: "Mock web search tool",
    inputSchema: vi.fn(),
    execute: vi.fn().mockResolvedValue("Mock search results"),
  }),
}));

vi.mock("@/lib/ai/utils", () => ({
  parseOwnerRepo: vi.fn().mockReturnValue({
    owner: "test-owner",
    repo: "test-repo",
  }),
}));

describe("askTools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock fetch
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  describe("fetchLearnings (via get_learnings tool)", () => {
    test("should fetch learnings successfully", async () => {
      const config = createTestConfig();
      const learnings = createTestLearnings();
      mockFetch.mockResolvedValue(createMockFetchResponse(true, learnings));

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      const result = await tools.get_learnings.execute({
        question: "test question",
        limit: 3,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${config.swarmUrl}/learnings?limit=3&question=${encodeURIComponent("test question")}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": config.swarmApiKey,
          },
        }
      );
      expect(result).toEqual(learnings);
    });

    test("should return empty array on fetch failure", async () => {
      const config = createTestConfig();
      mockFetch.mockResolvedValue(createMockFetchResponse(false));

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      const result = await tools.get_learnings.execute({
        question: "test question",
        limit: 3,
      });

      expect(result).toEqual([]);
    });

    test("should URL-encode special characters in question", async () => {
      const config = createTestConfig();
      const specialQuestion = "What is React? How does it work with TypeScript & JavaScript?";
      mockFetch.mockResolvedValue(createMockFetchResponse(true, []));

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      await tools.get_learnings.execute({
        question: specialQuestion,
        limit: 5,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${config.swarmUrl}/learnings?limit=5&question=${encodeURIComponent(specialQuestion)}`,
        expect.any(Object)
      );
    });

    test("should handle network errors gracefully", async () => {
      const config = createTestConfig();
      mockFetch.mockRejectedValue(new Error("Network error"));

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      const result = await tools.get_learnings.execute({
        question: "test question",
        limit: 3,
      });

      expect(result).toBe("Could not retrieve learnings");
    });
  });

  describe("askTools factory", () => {
    test("should return object with all 5 tools", () => {
      const config = createTestConfig();

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      expect(tools).toHaveProperty("get_learnings");
      expect(tools).toHaveProperty("recent_commits");
      expect(tools).toHaveProperty("recent_contributions");
      expect(tools).toHaveProperty("web_search");
      expect(tools).toHaveProperty("final_answer");
    });

    test("should have valid tool structure with description, inputSchema, and execute", () => {
      const config = createTestConfig();

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      // Verify each tool has the required structure
      Object.values(tools).forEach((tool) => {
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(tool).toHaveProperty("execute");
        expect(typeof tool.description).toBe("string");
        expect(typeof tool.execute).toBe("function");
      });
    });
  });

  describe("get_learnings tool", () => {
    test("should use default limit of 3 when not provided", async () => {
      const config = createTestConfig();
      mockFetch.mockResolvedValue(createMockFetchResponse(true, []));

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      await tools.get_learnings.execute({ question: "test" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=3"),
        expect.any(Object)
      );
    });

    test("should respect custom limit parameter", async () => {
      const config = createTestConfig();
      mockFetch.mockResolvedValue(createMockFetchResponse(true, []));

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      await tools.get_learnings.execute({ question: "test", limit: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=10"),
        expect.any(Object)
      );
    });

    test("should have correct Zod schema structure", () => {
      const config = createTestConfig();

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      expect(tools.get_learnings.inputSchema).toBeDefined();
      expect(tools.get_learnings.description).toBe(
        "Fetch previous learnings from the knowledge base."
      );
    });

    test("should return error message on exception", async () => {
      const config = createTestConfig();
      mockFetch.mockRejectedValue(new Error("Fetch failed"));

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      const result = await tools.get_learnings.execute({
        question: "test",
        limit: 3,
      });

      expect(result).toBe("Could not retrieve learnings");
    });
  });

  describe("recent_commits tool", () => {
    test("should have correct tool structure", () => {
      const config = createTestConfig();

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      expect(tools.recent_commits).toHaveProperty("description");
      expect(tools.recent_commits.description).toContain("recent commits");
    });

    test("should return string error on failure", async () => {
      const config = createTestConfig();

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      // This will fail due to invalid PAT, but should return a string error
      const result = await tools.recent_commits.execute({ limit: 10 });

      expect(typeof result).toBe("string");
      expect(result).toBe("Could not retrieve recent commits");
    });
  });

  describe("recent_contributions tool", () => {
    test("should have correct tool structure", () => {
      const config = createTestConfig();

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      expect(tools.recent_contributions).toHaveProperty("description");
      expect(tools.recent_contributions.description).toContain("contributor");
    });

    test("should return string error on failure", async () => {
      const config = createTestConfig();

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      // This will fail due to invalid PAT, but should return a string error
      const result = await tools.recent_contributions.execute({
        user: "test-user",
        limit: 5,
      });

      expect(typeof result).toBe("string");
      expect(result).toBe("Could not retrieve repository map");
    });
  });

  describe("web_search tool", () => {
    test("should include web_search tool in returned object", () => {
      const config = createTestConfig();

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      expect(tools.web_search).toBeDefined();
      expect(tools.web_search.description).toBe("Mock web search tool");
    });
  });

  describe("final_answer tool", () => {
    test("should return answer string unmodified", async () => {
      const config = createTestConfig();

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      const testAnswer = "This is the final answer to the question.";
      const result = await tools.final_answer.execute({ answer: testAnswer });

      expect(result).toBe(testAnswer);
    });

    test("should handle empty answer string", async () => {
      const config = createTestConfig();

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      const result = await tools.final_answer.execute({ answer: "" });

      expect(result).toBe("");
    });

    test("should have correct description indicating mandatory usage", () => {
      const config = createTestConfig();

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      expect(tools.final_answer.description).toContain("MUST");
      expect(tools.final_answer.description).toContain("final answer");
    });
  });

  describe("edge cases", () => {
    test("should handle undefined limit with fallback defaults", async () => {
      const config = createTestConfig();
      mockFetch.mockResolvedValue(createMockFetchResponse(true, []));

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      // Pass undefined explicitly to test || fallback
      await tools.get_learnings.execute({ question: "test", limit: undefined });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=3"),
        expect.any(Object)
      );
    });

    test("should handle zero limit with fallback to default", async () => {
      const config = createTestConfig();
      mockFetch.mockResolvedValue(createMockFetchResponse(true, []));

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      // Zero is falsy, so should fallback to default
      await tools.get_learnings.execute({ question: "test", limit: 0 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=3"),
        expect.any(Object)
      );
    });

    test("should handle very long questions with URL encoding", async () => {
      const config = createTestConfig();
      const longQuestion = "A".repeat(1000) + " with special chars: ?&=%";
      mockFetch.mockResolvedValue(createMockFetchResponse(true, []));

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      await tools.get_learnings.execute({ question: longQuestion, limit: 3 });

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain(encodeURIComponent(longQuestion));
    });

    test("should preserve original error logging behavior", async () => {
      const config = createTestConfig();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation();
      mockFetch.mockRejectedValue(new Error("Test error"));

      const tools = askTools(
        config.swarmUrl,
        config.swarmApiKey,
        config.repoUrl,
        config.pat,
        config.apiKey
      );

      await tools.get_learnings.execute({ question: "test", limit: 3 });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error retrieving learnings:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
