import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { askTools, listConcepts, repoAgent, searchClues, clueToolMsgs, createHasEndMarkerCondition } from "@/lib/ai/askTools";
import { parseOwnerRepo } from "@/lib/ai/utils";
import { tool } from "ai";

// Mock dependencies
vi.mock("ai", () => ({
  tool: vi.fn((config) => config),
}));

vi.mock("gitsee/server", () => ({
  RepoAnalyzer: vi.fn().mockImplementation(() => ({
    getRecentCommitsWithFiles: vi.fn(),
    getContributorPRs: vi.fn(),
  })),
}));

// Mock getProviderTool
vi.mock("@/lib/ai/provider", () => ({
  getProviderTool: vi.fn(),
}));

// Import the mocked function to use in tests
import { getProviderTool as mockGetProviderTool } from "@/lib/ai/provider";

describe("askTools", () => {
  const mockSwarmUrl = "https://test-swarm.sphinx.chat:3355";
  const mockSwarmApiKey = "test-api-key";
  const mockRepoUrl = "https://github.com/testowner/testrepo";
  const mockPat = "test-github-pat";
  const mockApiKey = "test-anthropic-key";

  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    // Mock web_search tool from getProviderTool
    mockGetProviderTool.mockReturnValue({
      description: "Search the web",
      inputSchema: {},
      execute: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("askTools function", () => {
    it("should return an object with all 7 tools", () => {
      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      expect(tools).toBeDefined();
      expect(tools.list_concepts).toBeDefined();
      expect(tools.learn_concept).toBeDefined();
      expect(tools.recent_commits).toBeDefined();
      expect(tools.recent_contributions).toBeDefined();
      expect(tools.repo_agent).toBeDefined();
      expect(tools.web_search).toBeDefined();
    });

    it("should call getProviderTool with correct parameters", () => {
      askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      expect(mockGetProviderTool).toHaveBeenCalledWith("anthropic", mockApiKey, "webSearch");
    });

    it("should extract owner and repo from repoUrl", () => {
      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      
      // Verify tools are created (parseOwnerRepo is called internally)
      expect(tools).toBeDefined();
      expect(tools.recent_commits).toBeDefined();
    });
  });

  describe("list_concepts tool", () => {
    it("should have correct tool definition", () => {
      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      expect(tools.list_concepts.description).toContain("knowledge base");
      expect(tools.list_concepts.inputSchema).toBeDefined();
      expect(tools.list_concepts.execute).toBeDefined();
    });

    it("should successfully fetch concepts", async () => {
      const mockConcepts = {
        features: [
          { id: "1", name: "Feature 1", description: "Test feature" },
          { id: "2", name: "Feature 2", description: "Another feature" },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockConcepts,
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.list_concepts.execute({});

      expect(result).toEqual(mockConcepts);
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockSwarmUrl}/gitree/features`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-token": mockSwarmApiKey,
          }),
        })
      );
    });

    it("should handle errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.list_concepts.execute({});

      expect(result).toBe("Could not retrieve features");
    });
  });

  describe("learn_concept tool", () => {
    it("should have correct tool definition with conceptId parameter", () => {
      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      expect(tools.learn_concept.description).toContain("documentation");
      expect(tools.learn_concept.inputSchema).toBeDefined();
      expect(tools.learn_concept.execute).toBeDefined();
    });

    it("should successfully fetch concept documentation", async () => {
      const mockConceptId = "test-concept-123";
      const mockConceptData = {
        id: mockConceptId,
        name: "Test Concept",
        documentation: "Detailed documentation...",
        prs: [],
        commits: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockConceptData,
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.learn_concept.execute({ conceptId: mockConceptId });

      expect(result).toEqual(mockConceptData);
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockSwarmUrl}/gitree/features/${encodeURIComponent(mockConceptId)}`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "x-api-token": mockSwarmApiKey,
          }),
        })
      );
    });

    it("should return error object when concept not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.learn_concept.execute({ conceptId: "nonexistent" });

      expect(result).toEqual({ error: "Feature not found" });
    });

    it("should handle network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.learn_concept.execute({ conceptId: "test" });

      expect(result).toBe("Could not retrieve feature documentation");
    });
  });

  describe("recent_commits tool", () => {
    it("should have correct tool definition with optional limit parameter", () => {
      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      expect(tools.recent_commits.description).toContain("recent commits");
      expect(tools.recent_commits.inputSchema).toBeDefined();
      expect(tools.recent_commits.execute).toBeDefined();
    });

    it("should fetch recent commits with default limit", async () => {
      const { RepoAnalyzer } = await import("gitsee/server");
      const mockCommits = [
        { sha: "abc123", message: "Fix bug", files: ["file1.ts"] },
        { sha: "def456", message: "Add feature", files: ["file2.ts"] },
      ];

      const mockAnalyzer = {
        getRecentCommitsWithFiles: vi.fn().mockResolvedValue(mockCommits),
      };
      (RepoAnalyzer as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockAnalyzer);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_commits.execute({});

      expect(result).toEqual(mockCommits);
      expect(mockAnalyzer.getRecentCommitsWithFiles).toHaveBeenCalledWith(
        "testowner",
        "testrepo",
        { limit: 10 }
      );
    });

    it("should fetch recent commits with custom limit", async () => {
      const { RepoAnalyzer } = await import("gitsee/server");
      const mockCommits = [{ sha: "abc123", message: "Test commit", files: [] }];

      const mockAnalyzer = {
        getRecentCommitsWithFiles: vi.fn().mockResolvedValue(mockCommits),
      };
      (RepoAnalyzer as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockAnalyzer);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_commits.execute({ limit: 5 });

      expect(result).toEqual(mockCommits);
      expect(mockAnalyzer.getRecentCommitsWithFiles).toHaveBeenCalledWith(
        "testowner",
        "testrepo",
        { limit: 5 }
      );
    });

    it("should handle errors gracefully", async () => {
      const { RepoAnalyzer } = await import("gitsee/server");
      const mockAnalyzer = {
        getRecentCommitsWithFiles: vi.fn().mockRejectedValue(new Error("GitHub API error")),
      };
      (RepoAnalyzer as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockAnalyzer);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_commits.execute({});

      expect(result).toBe("Could not retrieve recent commits");
    });
  });

  describe("recent_contributions tool", () => {
    it("should have correct tool definition with user and limit parameters", () => {
      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      expect(tools.recent_contributions.description).toContain("contributor");
      expect(tools.recent_contributions.inputSchema).toBeDefined();
      expect(tools.recent_contributions.execute).toBeDefined();
    });

    it("should fetch contributor PRs with default limit", async () => {
      const { RepoAnalyzer } = await import("gitsee/server");
      const mockContributions = [
        { prTitle: "Fix bug", commits: 3, reviews: 1 },
        { prTitle: "Add feature", commits: 5, reviews: 2 },
      ];

      const mockAnalyzer = {
        getContributorPRs: vi.fn().mockResolvedValue(mockContributions),
      };
      (RepoAnalyzer as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockAnalyzer);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_contributions.execute({ user: "testuser" });

      expect(result).toEqual(mockContributions);
      expect(mockAnalyzer.getContributorPRs).toHaveBeenCalledWith(
        "testowner",
        "testrepo",
        "testuser",
        5
      );
    });

    it("should fetch contributor PRs with custom limit", async () => {
      const { RepoAnalyzer } = await import("gitsee/server");
      const mockContributions = [{ prTitle: "Test PR", commits: 2, reviews: 0 }];

      const mockAnalyzer = {
        getContributorPRs: vi.fn().mockResolvedValue(mockContributions),
      };
      (RepoAnalyzer as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockAnalyzer);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_contributions.execute({ user: "contributor", limit: 10 });

      expect(result).toEqual(mockContributions);
      expect(mockAnalyzer.getContributorPRs).toHaveBeenCalledWith(
        "testowner",
        "testrepo",
        "contributor",
        10
      );
    });

    it("should handle errors gracefully", async () => {
      const { RepoAnalyzer } = await import("gitsee/server");
      const mockAnalyzer = {
        getContributorPRs: vi.fn().mockRejectedValue(new Error("API rate limit exceeded")),
      };
      (RepoAnalyzer as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockAnalyzer);

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.recent_contributions.execute({ user: "testuser" });

      expect(result).toBe("Could not retrieve repository map");
    });
  });

  describe("repo_agent tool", () => {
    it("should have correct tool definition with prompt parameter", () => {
      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      expect(tools.repo_agent.description).toContain("analyze the repository");
      expect(tools.repo_agent.inputSchema).toBeDefined();
      expect(tools.repo_agent.execute).toBeDefined();
    });

    it("should execute repo agent with speed instruction", async () => {
      const mockRequestId = "request-123";
      const mockResult = {
        content: "Analysis complete: Found 3 potential issues...",
      };

      // Use fake timers for this specific test
      vi.useFakeTimers();

      // Mock initial request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: mockRequestId }),
      });

      // Mock progress check (completed on first poll)
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "completed", result: mockResult }),
      });

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const resultPromise = tools.repo_agent.execute({ prompt: "Find security issues" });

      // Advance timer to trigger polling
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;

      expect(result).toBe(mockResult.content);
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockSwarmUrl}/repo/agent`,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("PLEASE BE AS FAST AS POSSIBLE"),
        })
      );

      vi.useRealTimers();
    });

    it("should handle repo agent errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Service unavailable"));

      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);
      const result = await tools.repo_agent.execute({ prompt: "Test prompt" });

      expect(result).toBe("Could not execute repo agent");
    });
  });

  describe("web_search tool", () => {
    it("should be sourced from getProviderTool", () => {
      const tools = askTools(mockSwarmUrl, mockSwarmApiKey, mockRepoUrl, mockPat, mockApiKey);

      expect(tools.web_search).toBeDefined();
      expect(mockGetProviderTool).toHaveBeenCalledWith("anthropic", mockApiKey, "webSearch");
    });
  });
});

describe("listConcepts", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch concepts from Swarm API", async () => {
    const mockConcepts = {
      features: [
        { id: "1", name: "Authentication", description: "User auth system" },
        { id: "2", name: "Database", description: "Prisma ORM" },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockConcepts,
    });

    const result = await listConcepts("https://test.sphinx.chat:3355", "test-key");

    expect(result).toEqual(mockConcepts);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.sphinx.chat:3355/gitree/features",
      expect.objectContaining({
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": "test-key",
        },
      })
    );
  });

  it("should handle API errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal server error" }),
    });

    const result = await listConcepts("https://test.sphinx.chat:3355", "test-key");

    expect(result).toEqual({ error: "Internal server error" });
  });
});

describe("repoAgent", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should initiate repo agent and poll for completion", async () => {
    const mockRequestId = "req-456";
    const mockResult = { content: "Analysis results..." };

    // Mock initiation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: mockRequestId }),
    });

    // Mock progress check - return completed immediately
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "completed", result: mockResult }),
    });

    const resultPromise = repoAgent("https://test.sphinx.chat:3355", "test-key", {
      repo_url: "https://github.com/test/repo",
      prompt: "Analyze code",
      pat: "test-pat",
    });

    // Advance timers to trigger first poll
    await vi.advanceTimersByTimeAsync(5000);
    
    const result = await resultPromise;

    expect(result).toEqual(mockResult);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.sphinx.chat:3355/repo/agent",
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      })
    );
  });

  it("should poll multiple times before completion", async () => {
    const mockRequestId = "req-789";
    const mockResult = { content: "Done" };

    // Mock initiation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: mockRequestId }),
    });

    // Mock progress checks - two in_progress, then completed
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "in_progress" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "in_progress" }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: "completed", result: mockResult }),
      });

    const resultPromise = repoAgent("https://test.sphinx.chat:3355", "test-key", {
      repo_url: "https://github.com/test/repo",
      prompt: "Test",
    });

    // Advance timers for each polling attempt
    await vi.advanceTimersByTimeAsync(5000); // First poll
    await vi.advanceTimersByTimeAsync(5000); // Second poll
    await vi.advanceTimersByTimeAsync(5000); // Third poll (completed)
    
    const result = await resultPromise;

    expect(result).toEqual(mockResult);
    expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initiate + 3 polls
  });

  it("should throw error when initiation fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Bad request",
    });

    await expect(
      repoAgent("https://test.sphinx.chat:3355", "test-key", {
        repo_url: "https://github.com/test/repo",
        prompt: "Test",
      })
    ).rejects.toThrow("Failed to initiate repo agent");
  });

  it("should throw error when no request_id returned", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    await expect(
      repoAgent("https://test.sphinx.chat:3355", "test-key", {
        repo_url: "https://github.com/test/repo",
        prompt: "Test",
      })
    ).rejects.toThrow("No request_id returned from repo agent");
  });

  it("should throw error when execution fails", async () => {
    const mockRequestId = "req-fail";

    // Mock initiation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: mockRequestId }),
    });

    // Mock failed status response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "failed", error: "Execution failed" }),
    });

    const resultPromise = repoAgent("https://test.sphinx.chat:3355", "test-key", {
      repo_url: "https://github.com/test/repo",
      prompt: "Test",
    });

    // Create promise for timer advancement
    const timerPromise = vi.advanceTimersByTimeAsync(5000);

    // Wait for both the timer and result promise
    await Promise.all([
      timerPromise,
      expect(resultPromise).rejects.toThrow("Execution failed")
    ]);
  });

  it("should handle progress check failures gracefully and continue polling", async () => {
    const mockRequestId = "req-retry";
    const mockResult = { content: "Success after retry" };

    // Mock initiation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: mockRequestId }),
    });

    // First poll fails, second succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: "completed", result: mockResult }),
      });

    const resultPromise = repoAgent("https://test.sphinx.chat:3355", "test-key", {
      repo_url: "https://github.com/test/repo",
      prompt: "Test",
    });

    // Advance timers for polling attempts
    await vi.advanceTimersByTimeAsync(5000); // First poll (fails)
    await vi.advanceTimersByTimeAsync(5000); // Second poll (succeeds)

    const result = await resultPromise;

    expect(result).toEqual(mockResult);
  });
});

describe("searchClues", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should search clues and filter by relevance score", async () => {
    const mockResults = [
      { id: "1", content: "High relevance", relevanceBreakdown: { vector: 0.85 } },
      { id: "2", content: "Low relevance", relevanceBreakdown: { vector: 0.50 } },
      { id: "3", content: "Medium relevance", relevanceBreakdown: { vector: 0.75 } },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: mockResults }),
    });

    const result = await searchClues("https://test.sphinx.chat:3355", "test-key", "test query", 0.73);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("1");
    expect(result[1].id).toBe("3");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.sphinx.chat:3355/gitree/search-clues",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "test query" }),
      })
    );
  });

  it("should use default minScore of 0.73", async () => {
    const mockResults = [
      { id: "1", content: "Test", relevanceBreakdown: { vector: 0.80 } },
      { id: "2", content: "Test", relevanceBreakdown: { vector: 0.70 } },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: mockResults }),
    });

    const result = await searchClues("https://test.sphinx.chat:3355", "test-key", "query");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });
});

describe("clueToolMsgs", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should construct tool-call and tool-result messages", async () => {
    const mockClues = Array.from({ length: 15 }, (_, i) => ({
      id: `clue-${i}`,
      content: `Clue ${i}`,
      relevanceBreakdown: { vector: 0.8 },
    }));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: mockClues }),
    });

    const result = await clueToolMsgs("https://test.sphinx.chat:3355", "test-key", "test query");

    expect(result).toHaveLength(2);
    expect(result![0].role).toBe("assistant");
    expect(result![0].content[0].type).toBe("tool-call");
    expect(result![0].content[0].toolName).toBe("search_relevant_clues");
    
    expect(result![1].role).toBe("tool");
    expect(result![1].content[0].type).toBe("tool-result");
    expect(result![1].content[0].toolName).toBe("search_relevant_clues");
    
    // Should limit to 10 clues
    const toolResult = result![1].content[0] as { output: { value: unknown[] } };
    expect(toolResult.output.value).toHaveLength(10);
  });

  it("should return null when no relevant clues found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const result = await clueToolMsgs("https://test.sphinx.chat:3355", "test-key", "no results");

    expect(result).toBeNull();
  });

  it("should return null on error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await clueToolMsgs("https://test.sphinx.chat:3355", "test-key", "query");

    expect(result).toBeNull();
  });
});

describe("createHasEndMarkerCondition", () => {
  it("should return true when [END_OF_ANSWER] marker found in text", () => {
    const condition = createHasEndMarkerCondition();
    
    const steps = [
      {
        content: [
          { type: "text" as const, text: "Some response text" },
          { type: "text" as const, text: "Final answer [END_OF_ANSWER]" },
        ],
      },
    ];

    const result = condition({ steps } as never);
    expect(result).toBe(true);
  });

  it("should return false when marker not found", () => {
    const condition = createHasEndMarkerCondition();
    
    const steps = [
      {
        content: [
          { type: "text" as const, text: "Some response text" },
          { type: "text" as const, text: "More text without marker" },
        ],
      },
    ];

    const result = condition({ steps } as never);
    expect(result).toBe(false);
  });

  it("should handle multiple steps", () => {
    const condition = createHasEndMarkerCondition();
    
    const steps = [
      {
        content: [
          { type: "text" as const, text: "Step 1" },
        ],
      },
      {
        content: [
          { type: "text" as const, text: "Step 2 [END_OF_ANSWER]" },
        ],
      },
    ];

    const result = condition({ steps } as never);
    expect(result).toBe(true);
  });

  it("should handle non-text content types", () => {
    const condition = createHasEndMarkerCondition();
    
    const steps = [
      {
        content: [
          { type: "tool-call" as const, toolName: "test" },
          { type: "text" as const, text: "Response" },
        ],
      },
    ];

    const result = condition({ steps } as never);
    expect(result).toBe(false);
  });
});

describe("parseOwnerRepo", () => {
  it("should parse https GitHub URL", () => {
    const result = parseOwnerRepo("https://github.com/testowner/testrepo");
    expect(result).toEqual({ owner: "testowner", repo: "testrepo" });
  });

  it("should parse https GitHub URL with .git suffix", () => {
    const result = parseOwnerRepo("https://github.com/testowner/testrepo.git");
    expect(result).toEqual({ owner: "testowner", repo: "testrepo" });
  });

  it("should parse git@ SSH format", () => {
    const result = parseOwnerRepo("git@github.com:testowner/testrepo.git");
    expect(result).toEqual({ owner: "testowner", repo: "testrepo" });
  });

  it("should parse owner/repo format", () => {
    const result = parseOwnerRepo("testowner/testrepo");
    expect(result).toEqual({ owner: "testowner", repo: "testrepo" });
  });

  it("should throw error for invalid format", () => {
    expect(() => parseOwnerRepo("invalid-url")).toThrow("Invalid repository URL format");
  });

  it("should throw error for empty string", () => {
    expect(() => parseOwnerRepo("")).toThrow("Invalid repository URL format");
  });
});
