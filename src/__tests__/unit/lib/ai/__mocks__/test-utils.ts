import { vi } from "vitest";

// Test data factory functions
export const createTestConfig = () => ({
  swarmUrl: "https://test-swarm.example.com",
  swarmApiKey: "test-swarm-api-key",
  repoUrl: "https://github.com/test-owner/test-repo",
  pat: "test-github-pat",
  apiKey: "test-anthropic-api-key",
});

export const createTestLearnings = () => [
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

export const createMockFetchResponse = (ok: boolean, data: any = null) => ({
  ok,
  json: vi.fn().mockResolvedValue(data),
  status: ok ? 200 : 500,
  statusText: ok ? "OK" : "Internal Server Error",
});

// Mock instances for RepoAnalyzer
export const createMockRepoAnalyzer = () => {
  const mockInstance = {
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
  };

  const MockConstructor = vi.fn().mockReturnValue(mockInstance);
  return { MockConstructor, mockInstance };
};

// Mock for aieo provider tool
export const createMockProviderTool = () => ({
  description: "Mock web search tool",
  inputSchema: vi.fn(),
  execute: vi.fn().mockResolvedValue("Mock search results"),
});

// Mock for parseOwnerRepo utility
export const createMockParseOwnerRepo = () => 
  vi.fn().mockReturnValue({
    owner: "test-owner",
    repo: "test-repo",
  });
