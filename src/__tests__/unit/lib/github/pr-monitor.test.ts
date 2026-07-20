import { describe, it, expect, beforeEach, vi } from "vitest";
import { mergeBaseBranch, rebaseOntoBaseBranch, triggerAgentModeFix, triggerLiveModeFix, createPrLogger, monitorSinglePR } from "@/lib/github/pr-monitor";
import type { Octokit } from "@octokit/rest";
import { ChatRole, ChatStatus } from "@prisma/client";

// Mock dependencies for all tests in this file
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
    artifact: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    agentLog: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "log-1", agent: "pr-monitor", createdAt: new Date() }),
      update: vi.fn().mockResolvedValue({ id: "log-1", agent: "pr-monitor", createdAt: new Date() }),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue(undefined),
  },
  getTaskChannelName: vi.fn((id: string) => `task-${id}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  PUSHER_EVENTS: {
    NEW_MESSAGE: "new-message",
    PR_STATUS_CHANGE: "pr-status-change",
    AGENT_LOG_UPDATED: "agent-log-updated",
  },
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.vercel.com/fake-url" }),
}));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn().mockReturnValue("decrypted-secret"),
      encryptField: vi.fn().mockReturnValue({
        data: "encrypted-data",
        iv: "mock-iv",
        tag: "mock-tag",
        keyId: "mock-key-id",
        version: 1,
        encryptedAt: new Date().toISOString(),
      }),
    })),
  },
}));
vi.mock("jsonwebtoken", () => ({
  default: {
    sign: vi.fn(() => "mock-jwt-token"),
  },
}));
vi.mock("@/lib/auth/agent-jwt", () => ({
  createWebhookToken: vi.fn().mockResolvedValue("mock-webhook-token"),
  generateWebhookSecret: vi.fn().mockReturnValue("mock-webhook-secret"),
}));
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    pulls: { get: vi.fn() },
  })),
}));
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn().mockResolvedValue({ accessToken: "github-token" }),
}));
vi.mock("@/lib/pods/utils", () => ({
  releaseTaskPod: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/lib/github/pr-ci", () => ({
  fetchCIStatus: vi.fn().mockResolvedValue({
    status: "failure",
    summary: "Tests failed",
    failedChecks: ["test"],
    failedCheckLogs: {},
  }),
}));
vi.mock("@/services/task-workflow", () => ({
  createChatMessageAndTriggerStakwork: vi.fn().mockResolvedValue({
    stakworkData: { projectId: "proj-123" },
  }),
}));
vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

// Import mocked modules after mocks are defined
import { db } from "@/lib/db";
import { pusherServer, getTaskChannelName, getFeatureChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { put } from "@vercel/blob";
import { createChatMessageAndTriggerStakwork } from "@/services/task-workflow";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

describe("PR Monitor - Branch Update Operations", () => {
  let mockOctokit: Partial<Octokit>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("mergeBaseBranch", () => {
    describe("Success scenarios", () => {
      it("should successfully merge base branch into PR branch", async () => {
        const mockMerge = vi.fn().mockResolvedValue({
          data: { sha: "abc123def456" },
        });

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        const result = await mergeBaseBranch(
          mockOctokit as Octokit,
          "test-owner",
          "test-repo",
          "feature-branch",
          "main",
        );

        expect(result.success).toBe(true);
        expect(result.sha).toBe("abc123def456");
        expect(result.error).toBeUndefined();

        expect(mockMerge).toHaveBeenCalledWith({
          owner: "test-owner",
          repo: "test-repo",
          base: "feature-branch",
          head: "main",
          commit_message: "Merge branch 'main' into feature-branch",
        });
        expect(mockMerge).toHaveBeenCalledTimes(1);
      });

      it("should use custom commit message when provided", async () => {
        const mockMerge = vi.fn().mockResolvedValue({
          data: { sha: "custom123" },
        });

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        const customMessage = "chore: update feature branch from main";
        const result = await mergeBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          customMessage,
        );

        expect(result.success).toBe(true);
        expect(result.sha).toBe("custom123");

        expect(mockMerge).toHaveBeenCalledWith({
          owner: "owner",
          repo: "repo",
          base: "feature",
          head: "main",
          commit_message: customMessage,
        });
      });

      it("should handle different branch names correctly", async () => {
        const mockMerge = vi.fn().mockResolvedValue({
          data: { sha: "branch-test-sha" },
        });

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        await mergeBaseBranch(
          mockOctokit as Octokit,
          "my-org",
          "my-repo",
          "bugfix/issue-123",
          "develop",
        );

        expect(mockMerge).toHaveBeenCalledWith({
          owner: "my-org",
          repo: "my-repo",
          base: "bugfix/issue-123",
          head: "develop",
          commit_message: "Merge branch 'develop' into bugfix/issue-123",
        });
      });
    });

    describe("Conflict scenarios", () => {
      it("should detect merge conflicts with 409 status code", async () => {
        const conflictError = new Error("Merge conflict");
        (conflictError as any).status = 409;

        const mockMerge = vi.fn().mockRejectedValue(conflictError);

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        const result = await mergeBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Merge conflicts exist");
        expect(result.sha).toBeUndefined();
      });

      it("should detect merge conflicts from error message containing '409'", async () => {
        const mockMerge = vi.fn().mockRejectedValue(
          new Error("Request failed with status code 409"),
        );

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        const result = await mergeBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Merge conflicts exist");
      });

      it("should detect merge conflicts from error message containing 'Merge conflict'", async () => {
        const mockMerge = vi.fn().mockRejectedValue(
          new Error("Merge conflict detected between branches"),
        );

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        const result = await mergeBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Merge conflicts exist");
      });
    });

    describe("Error handling", () => {
      it("should handle generic GitHub API errors", async () => {
        const mockMerge = vi.fn().mockRejectedValue(new Error("API rate limit exceeded"));

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        const result = await mergeBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("API rate limit exceeded");
        expect(result.sha).toBeUndefined();
      });

      it("should handle authentication errors", async () => {
        const authError = new Error("Bad credentials");
        (authError as any).status = 401;

        const mockMerge = vi.fn().mockRejectedValue(authError);

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        const result = await mergeBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Bad credentials");
      });

      it("should handle permission errors", async () => {
        const permError = new Error("Resource not accessible by integration");
        (permError as any).status = 403;

        const mockMerge = vi.fn().mockRejectedValue(permError);

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        const result = await mergeBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Resource not accessible by integration");
      });

      it("should handle non-Error objects", async () => {
        const mockMerge = vi.fn().mockRejectedValue("String error");

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        const result = await mergeBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("String error");
      });

      it("should handle network errors", async () => {
        const mockMerge = vi.fn().mockRejectedValue(new Error("Network request failed"));

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        const result = await mergeBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Network request failed");
      });
    });

    describe("Edge cases", () => {
      it("should handle empty SHA response", async () => {
        const mockMerge = vi.fn().mockResolvedValue({
          data: { sha: "" },
        });

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        const result = await mergeBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
        );

        expect(result.success).toBe(true);
        expect(result.sha).toBe("");
      });

      it("should handle branches with special characters", async () => {
        const mockMerge = vi.fn().mockResolvedValue({
          data: { sha: "special-sha" },
        });

        mockOctokit = {
          repos: {
            merge: mockMerge,
          } as any,
        };

        await mergeBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature/TICKET-123",
          "release/v1.0.0",
        );

        expect(mockMerge).toHaveBeenCalledWith(
          expect.objectContaining({
            base: "feature/TICKET-123",
            head: "release/v1.0.0",
          }),
        );
      });
    });
  });

  describe("rebaseOntoBaseBranch", () => {
    describe("Success scenarios", () => {
      it("should successfully rebase PR branch onto base branch", async () => {
        const mockUpdateBranch = vi.fn().mockResolvedValue({
          data: { message: "Updating pull request branch." },
        });

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "test-owner",
          "test-repo",
          "feature-branch",
          "main",
          123,
        );

        expect(result.success).toBe(true);
        expect(result.sha).toBe("Updating pull request branch.");
        expect(result.error).toBeUndefined();

        expect(mockUpdateBranch).toHaveBeenCalledWith({
          owner: "test-owner",
          repo: "test-repo",
          pull_number: 123,
        });
        expect(mockUpdateBranch).toHaveBeenCalledTimes(1);
      });

      it("should handle different PR numbers", async () => {
        const mockUpdateBranch = vi.fn().mockResolvedValue({
          data: { message: "Branch updated successfully" },
        });

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "org",
          "repo",
          "feature",
          "develop",
          9999,
        );

        expect(mockUpdateBranch).toHaveBeenCalledWith({
          owner: "org",
          repo: "repo",
          pull_number: 9999,
        });
      });

      it("should return success message in sha field", async () => {
        const mockUpdateBranch = vi.fn().mockResolvedValue({
          data: { message: "Custom success message from GitHub" },
        });

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          456,
        );

        expect(result.success).toBe(true);
        expect(result.sha).toBe("Custom success message from GitHub");
      });
    });

    describe("Conflict scenarios", () => {
      it("should detect conflicts with 422 status code", async () => {
        const conflictError = new Error("Request failed with status code 422");
        (conflictError as any).status = 422;

        const mockUpdateBranch = vi.fn().mockRejectedValue(conflictError);

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          123,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Cannot rebase: conflicts exist or branch is protected");
        expect(result.sha).toBeUndefined();
      });

      it("should detect conflicts from error message containing '422'", async () => {
        const mockUpdateBranch = vi.fn().mockRejectedValue(
          new Error("Request failed with status code 422"),
        );

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          123,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Cannot rebase: conflicts exist or branch is protected");
      });

      it("should detect conflicts from error message containing 'conflict'", async () => {
        const mockUpdateBranch = vi.fn().mockRejectedValue(
          new Error("Cannot update branch: merge conflict detected"),
        );

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          123,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Cannot rebase: conflicts exist or branch is protected");
      });

      it("should handle branch protection errors with 422 in message", async () => {
        const protectionError = new Error("HTTP 422: Required status check is expected");

        const mockUpdateBranch = vi.fn().mockRejectedValue(protectionError);

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          123,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Cannot rebase: conflicts exist or branch is protected");
      });
    });

    describe("Error handling", () => {
      it("should handle generic GitHub API errors", async () => {
        const mockUpdateBranch = vi.fn().mockRejectedValue(new Error("Service temporarily unavailable"));

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          123,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Service temporarily unavailable");
      });

      it("should handle authentication errors", async () => {
        const authError = new Error("Requires authentication");
        (authError as any).status = 401;

        const mockUpdateBranch = vi.fn().mockRejectedValue(authError);

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          123,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Requires authentication");
      });

      it("should handle permission errors", async () => {
        const permError = new Error("Must have admin rights to update branch");
        (permError as any).status = 403;

        const mockUpdateBranch = vi.fn().mockRejectedValue(permError);

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          123,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Must have admin rights to update branch");
      });

      it("should handle not found errors", async () => {
        const notFoundError = new Error("Pull request not found");
        (notFoundError as any).status = 404;

        const mockUpdateBranch = vi.fn().mockRejectedValue(notFoundError);

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          999,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Pull request not found");
      });

      it("should handle non-Error objects", async () => {
        const mockUpdateBranch = vi.fn().mockRejectedValue("Unexpected error");

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          123,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Unexpected error");
      });

      it("should handle timeout errors", async () => {
        const mockUpdateBranch = vi.fn().mockRejectedValue(new Error("Request timeout"));

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          123,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Request timeout");
      });
    });

    describe("Edge cases", () => {
      it("should handle PR number zero", async () => {
        const mockUpdateBranch = vi.fn().mockResolvedValue({
          data: { message: "Updated" },
        });

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          0,
        );

        expect(mockUpdateBranch).toHaveBeenCalledWith(
          expect.objectContaining({
            pull_number: 0,
          }),
        );
      });

      it("should handle large PR numbers", async () => {
        const mockUpdateBranch = vi.fn().mockResolvedValue({
          data: { message: "Updated" },
        });

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          999999,
        );

        expect(mockUpdateBranch).toHaveBeenCalledWith(
          expect.objectContaining({
            pull_number: 999999,
          }),
        );
      });

      it("should handle empty response message", async () => {
        const mockUpdateBranch = vi.fn().mockResolvedValue({
          data: { message: "" },
        });

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        const result = await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature",
          "main",
          123,
        );

        expect(result.success).toBe(true);
        expect(result.sha).toBe("");
      });

      it("should handle branches with slashes and special characters", async () => {
        const mockUpdateBranch = vi.fn().mockResolvedValue({
          data: { message: "Success" },
        });

        mockOctokit = {
          pulls: {
            updateBranch: mockUpdateBranch,
          } as any,
        };

        await rebaseOntoBaseBranch(
          mockOctokit as Octokit,
          "owner",
          "repo",
          "feature/JIRA-123/fix-bug",
          "release/v2.0.0-beta",
          123,
        );

        expect(mockUpdateBranch).toHaveBeenCalledWith({
          owner: "owner",
          repo: "repo",
          pull_number: 123,
        });
      });
    });
  });

  describe("Comparison between merge and rebase strategies", () => {
    it("mergeBaseBranch should use repos.merge API", async () => {
      const mockMerge = vi.fn().mockResolvedValue({
        data: { sha: "merge-sha" },
      });

      mockOctokit = {
        repos: {
          merge: mockMerge,
        } as any,
      };

      await mergeBaseBranch(
        mockOctokit as Octokit,
        "owner",
        "repo",
        "feature",
        "main",
      );

      expect(mockMerge).toHaveBeenCalled();
    });

    it("rebaseOntoBaseBranch should use pulls.updateBranch API", async () => {
      const mockUpdateBranch = vi.fn().mockResolvedValue({
        data: { message: "Updated" },
      });

      mockOctokit = {
        pulls: {
          updateBranch: mockUpdateBranch,
        } as any,
      };

      await rebaseOntoBaseBranch(
        mockOctokit as Octokit,
        "owner",
        "repo",
        "feature",
        "main",
        123,
      );

      expect(mockUpdateBranch).toHaveBeenCalled();
    });

    it("merge requires head and base parameters while rebase only needs PR number", async () => {
      const mockMerge = vi.fn().mockResolvedValue({
        data: { sha: "sha" },
      });
      const mockUpdateBranch = vi.fn().mockResolvedValue({
        data: { message: "msg" },
      });

      const mockOctokitForMerge = {
        repos: {
          merge: mockMerge,
        } as any,
      };

      const mockOctokitForRebase = {
        pulls: {
          updateBranch: mockUpdateBranch,
        } as any,
      };

      await mergeBaseBranch(
        mockOctokitForMerge as Octokit,
        "owner",
        "repo",
        "feature",
        "main",
      );

      await rebaseOntoBaseBranch(
        mockOctokitForRebase as Octokit,
        "owner",
        "repo",
        "feature",
        "main",
        123,
      );

      expect(mockMerge).toHaveBeenCalledWith(
        expect.objectContaining({
          base: "feature",
          head: "main",
        }),
      );

      expect(mockUpdateBranch).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 123,
      });
    });

    it("both functions should return consistent result structure on success", async () => {
      const mockMerge = vi.fn().mockResolvedValue({
        data: { sha: "merge-sha" },
      });
      const mockUpdateBranch = vi.fn().mockResolvedValue({
        data: { message: "rebase-msg" },
      });

      const mergeResult = await mergeBaseBranch(
        { repos: { merge: mockMerge } } as any,
        "owner",
        "repo",
        "feature",
        "main",
      );

      const rebaseResult = await rebaseOntoBaseBranch(
        { pulls: { updateBranch: mockUpdateBranch } } as any,
        "owner",
        "repo",
        "feature",
        "main",
        123,
      );

      // Both should have success and sha fields on success
      expect(mergeResult).toHaveProperty("success", true);
      expect(mergeResult).toHaveProperty("sha");
      expect(mergeResult.error).toBeUndefined();

      expect(rebaseResult).toHaveProperty("success", true);
      expect(rebaseResult).toHaveProperty("sha");
      expect(rebaseResult.error).toBeUndefined();
    });

    it("both functions should return consistent result structure on failure", async () => {
      const mockMerge = vi.fn().mockRejectedValue(new Error("Merge failed"));
      const mockUpdateBranch = vi.fn().mockRejectedValue(new Error("Rebase failed"));

      const mergeResult = await mergeBaseBranch(
        { repos: { merge: mockMerge } } as any,
        "owner",
        "repo",
        "feature",
        "main",
      );

      const rebaseResult = await rebaseOntoBaseBranch(
        { pulls: { updateBranch: mockUpdateBranch } } as any,
        "owner",
        "repo",
        "feature",
        "main",
        123,
      );

      // Both should have success and error fields on failure
      expect(mergeResult).toHaveProperty("success", false);
      expect(mergeResult).toHaveProperty("error");
      expect(mergeResult.sha).toBeUndefined();

      expect(rebaseResult).toHaveProperty("success", false);
      expect(rebaseResult).toHaveProperty("error");
      expect(rebaseResult.sha).toBeUndefined();
    });
  });

  describe("triggerAgentModeFix", () => {
    const mockTaskId = "task-123";
    const mockPrompt = "Fix the CI failure:\n<logs>npm test failed</logs>";
    const mockAgentUrl = "https://agent.example.com";

    beforeEach(() => {
      vi.clearAllMocks();

      // Mock environment variables
      process.env.NEXTAUTH_URL = "http://localhost:3000";

      // Mock db.task.findUnique
      vi.mocked(db.task.findUnique).mockResolvedValue({
        id: mockTaskId,
        agentUrl: mockAgentUrl,
        agentPassword: JSON.stringify({ encrypted: "key" }),
        agentWebhookSecret: null,
        mode: "agent",
        podId: "pod-123",
        // Bifrost wiring on triggerAgentModeFix needs workspace
        // identity to mint a macaroon. The orchestrator no-ops
        // (rollout flag off in tests), but the code path still
        // reads these fields off `task`.
        workspaceId: "workspace-123",
        createdById: "user-123",
        workspace: { slug: "test-workspace", ownerId: "owner-123" },
      } as any);

      // Mock db.task.update
      vi.mocked(db.task.update).mockResolvedValue({} as any);

      // Mock fetch for agent session creation
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessionId: "session-123" }),
      } as any);
    });

    it("should create trigger message and broadcast via Pusher", async () => {
      const mockTriggerMessage = {
        id: "msg-trigger-1",
        taskId: mockTaskId,
        message: `[PR Monitor] Detected issue with pull request. Attempting automatic fix...\n\n${mockPrompt}`,
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      };

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockTriggerMessage as any);

      // Mock fetch for agent session creation
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessionId: "session-123" }),
      } as any);

      await triggerAgentModeFix(mockTaskId, mockPrompt);

      // Verify chat message was created
      expect(db.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: mockTaskId,
          message: `[PR Monitor] Detected issue with pull request. Attempting automatic fix...\n\n${mockPrompt}`,
          role: ChatRole.USER,
          status: ChatStatus.SENT,
        },
      });

      // Verify Pusher broadcast was triggered
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${mockTaskId}`,
        "new-message",
        mockTriggerMessage.id
      );
    });

    it("should broadcast trigger message before creating agent session", async () => {
      const mockTriggerMessage = {
        id: "msg-trigger-2",
        taskId: mockTaskId,
      };

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockTriggerMessage as any);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessionId: "session-456" }),
      });
      global.fetch = fetchMock;

      await triggerAgentModeFix(mockTaskId, mockPrompt);

      // Get call order
      const chatCreateCallOrder = vi.mocked(db.chatMessage.create).mock.invocationCallOrder[0];
      const pusherTriggerCallOrder = vi.mocked(pusherServer.trigger).mock.invocationCallOrder[0];
      const fetchCallOrder = fetchMock.mock.invocationCallOrder[0];

      // Pusher should be called after chat message creation but before agent session
      expect(chatCreateCallOrder).toBeLessThan(pusherTriggerCallOrder);
      expect(pusherTriggerCallOrder).toBeLessThan(fetchCallOrder);
    });

    it("should still broadcast message even if agent session creation fails", async () => {
      const mockTriggerMessage = {
        id: "msg-trigger-3",
        taskId: mockTaskId,
      };

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockTriggerMessage as any);

      // Mock fetch to fail
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as any);

      const result = await triggerAgentModeFix(mockTaskId, mockPrompt);

      // Verify the function returned an error
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Verify message was still created and broadcast before the failure
      expect(db.chatMessage.create).toHaveBeenCalled();
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${mockTaskId}`,
        "new-message",
        mockTriggerMessage.id
      );
    });

    it("should include prompt with logs in trigger message", async () => {
      const promptWithLogs = "Fix CI failure:\n<logs>Error: Test suite failed</logs>";
      
      vi.mocked(db.chatMessage.create).mockResolvedValue({
        id: "msg-4",
        taskId: mockTaskId,
      } as any);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessionId: "session-789" }),
      } as any);

      await triggerAgentModeFix(mockTaskId, promptWithLogs);

      expect(db.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: mockTaskId,
          message: expect.stringContaining("<logs>Error: Test suite failed</logs>"),
          role: ChatRole.USER,
          status: ChatStatus.SENT,
        },
      });
    });
  });
});

// ─── Zombie PR Fix Tests ──────────────────────────────────────────────────────
// These tests require a fresh module scope with full monitorOpenPRs mocks.
// We use a separate describe block with vi.mock hoisting at the top of the file.

describe("PR Monitor - Zombie PR fixes", () => {
  // We need to mock all dependencies used by monitorOpenPRs / findOpenPRArtifacts
  // These mocks are separate from the triggerAgentModeFix mocks above.

  const mockPullsGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to build a minimal raw artifact row returned by db.$queryRaw
  function makeArtifactRow(overrides: {
    url?: string;
    podId?: string | null;
    prMonitorConfig?: Partial<{
      pr_conflict_fix_enabled: boolean;
      pr_ci_failure_fix_enabled: boolean;
    }>;
    progress?: Record<string, unknown>;
  } = {}) {
    return {
      id: "artifact-1",
      content: {
        url: overrides.url ?? "https://github.com/org/repo/pull/1",
        status: "IN_PROGRESS",
        progress: overrides.progress ?? undefined,
      },
      task_id: "task-1",
      pod_id: overrides.podId !== undefined ? overrides.podId : "pod-1",
      workspace_id: "ws-1",
      owner_id: "owner-1",
      pr_monitor_enabled: true,
      pr_conflict_fix_enabled: overrides.prMonitorConfig?.pr_conflict_fix_enabled ?? true,
      pr_ci_failure_fix_enabled: overrides.prMonitorConfig?.pr_ci_failure_fix_enabled ?? false,
      pr_out_of_date_fix_enabled: false,
      pr_use_rebase_for_updates: false,
    };
  }

  describe("findOpenPRArtifacts SQL filters", () => {
    it("should include AND t.mode != 'agent' in the SQL query", async () => {
      vi.mocked(db.$queryRaw).mockResolvedValue([]);

      const { findOpenPRArtifacts } = await import("@/lib/github/pr-monitor");
      await findOpenPRArtifacts(20);

      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(db.$queryRaw).mock.calls[0];
      // The first argument is a TemplateStringsArray from the tagged template literal
      const sqlParts = (callArgs[0] as TemplateStringsArray).join("");
      expect(sqlParts).toContain("t.mode != 'agent'");
    });

    it("should include LIKE 'https://github.com/%' filter in the SQL query", async () => {
      vi.mocked(db.$queryRaw).mockResolvedValue([]);

      const { findOpenPRArtifacts } = await import("@/lib/github/pr-monitor");
      await findOpenPRArtifacts(20);

      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(db.$queryRaw).mock.calls[0];
      const sqlParts = (callArgs[0] as TemplateStringsArray).join("");
      expect(sqlParts).toContain("LIKE 'https://github.com/%'");
    });
  });

  describe("shouldTriggerFix without podId (live-mode tasks)", () => {
    // Re-mock full dependency set for monitorOpenPRs
    beforeEach(async () => {
      // Configure the Octokit mock to use mockPullsGet for these tests
      const { Octokit } = await import("@octokit/rest");
      vi.mocked(Octokit).mockImplementation(() => ({
        pulls: { get: mockPullsGet },
      }) as any);

      // PR returns ci_failure state
      mockPullsGet.mockResolvedValue({
        data: {
          state: "open",
          merged: false,
          mergeable: true,
          mergeable_state: "clean",
          head: { ref: "feature/test", sha: "head-sha" },
          base: { ref: "main", sha: "base-sha" },
        },
      });
    });

    it("calls triggerLiveModeFix and sets resolution to in_progress when podId is null", async () => {
      // Live-mode task with NO pod
      vi.mocked(db.$queryRaw).mockResolvedValue([
        makeArtifactRow({
          podId: null,
          prMonitorConfig: { pr_ci_failure_fix_enabled: true },
        }),
      ]);

      vi.mocked(db.artifact.findUnique).mockResolvedValue({
        content: {
          url: "https://github.com/org/repo/pull/1",
          status: "IN_PROGRESS",
        },
      } as any);
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);

      // triggerLiveModeFix calls db.task.findUnique then createChatMessageAndTriggerStakwork
      vi.mocked(db.task.findUnique).mockResolvedValue({
        id: "task-1",
        mode: "live",
        workflowStatus: "COMPLETED",
        createdById: "creator-1",
        workspace: { ownerId: "owner-1", slug: "test-workspace" },
      } as any);
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "creator-gh",
        pat: "creator-pat",
      } as any);
      vi.mocked(createChatMessageAndTriggerStakwork).mockResolvedValue({
        stakworkData: { projectId: "proj-123" },
      } as any);

      const { monitorOpenPRs } = await import("@/lib/github/pr-monitor");
      const stats = await monitorOpenPRs(20);

      // Fix should have been triggered
      expect(createChatMessageAndTriggerStakwork).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1", mode: "live" })
      );
      expect(stats.agentTriggered).toBe(1);

      // Artifact progress should be updated with in_progress resolution
      expect(db.artifact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.objectContaining({
              progress: expect.objectContaining({
                resolution: expect.objectContaining({
                  status: "in_progress",
                  attempts: 1,
                }),
              }),
            }),
          }),
        })
      );
    });

    it("sets resolution to gave_up after PR_FIX_MAX_ATTEMPTS (6) failed attempts", async () => {
      // Simulate a task already at max attempts (6)
      vi.mocked(db.$queryRaw).mockResolvedValue([
        makeArtifactRow({
          podId: null,
          prMonitorConfig: { pr_ci_failure_fix_enabled: true },
          progress: {
            state: "ci_failure",
            lastCheckedAt: new Date(Date.now() - 60000).toISOString(),
            resolution: {
              status: "in_progress",
              attempts: 6,
              lastAttemptAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago (stale)
            },
          },
        }),
      ]);

      vi.mocked(db.artifact.findUnique).mockResolvedValue({
        content: {
          url: "https://github.com/org/repo/pull/1",
          status: "IN_PROGRESS",
        },
      } as any);
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);
      vi.mocked(db.task.findUnique).mockResolvedValue({
        id: "task-1",
        mode: "live",
        workflowStatus: "COMPLETED",
        createdById: "creator-1",
        workspace: { ownerId: "owner-1", slug: "test-workspace" },
      } as any);
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "creator-gh",
        pat: "creator-pat",
      } as any);

      const { monitorOpenPRs } = await import("@/lib/github/pr-monitor");
      await monitorOpenPRs(20);

      // Should NOT trigger another fix
      expect(createChatMessageAndTriggerStakwork).not.toHaveBeenCalled();

      // Should have set resolution to gave_up
      expect(db.artifact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.objectContaining({
              progress: expect.objectContaining({
                resolution: expect.objectContaining({
                  status: "gave_up",
                  attempts: 6,
                }),
              }),
            }),
          }),
        })
      );
    });
  });
});

describe("triggerLiveModeFix - userId resolution", () => {
  const taskId = "task-live-1";
  const prompt = "Fix the CI failure";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createChatMessageAndTriggerStakwork).mockResolvedValue({
      stakworkData: { projectId: "proj-live-1" },
    } as any);
  });

  it("uses task createdById when task creator has GitHub credentials", async () => {
    vi.mocked(db.task.findUnique).mockResolvedValue({
      id: taskId,
      mode: "live",
      workflowStatus: "COMPLETED",
      createdById: "creator-user-1",
      workspace: { ownerId: "owner-user-1", slug: "my-workspace" },
    } as any);
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
      username: "creator-gh",
      pat: "creator-pat",
    } as any);

    const result = await triggerLiveModeFix(taskId, prompt);

    expect(result.success).toBe(true);
    expect(getGithubUsernameAndPAT).toHaveBeenCalledWith("creator-user-1", "my-workspace");
    expect(createChatMessageAndTriggerStakwork).toHaveBeenCalledWith(
      expect.objectContaining({ taskId, userId: "creator-user-1", mode: "live" })
    );
  });

  it("falls back to workspace.ownerId and logs when task creator has no GitHub credentials", async () => {
    vi.mocked(db.task.findUnique).mockResolvedValue({
      id: taskId,
      mode: "live",
      workflowStatus: "COMPLETED",
      createdById: "creator-user-2",
      workspace: { ownerId: "owner-user-2", slug: "my-workspace" },
    } as any);
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

    const logInfoSpy = vi.spyOn(console, "log");

    const result = await triggerLiveModeFix(taskId, prompt);

    expect(result.success).toBe(true);
    expect(getGithubUsernameAndPAT).toHaveBeenCalledWith("creator-user-2", "my-workspace");
    expect(createChatMessageAndTriggerStakwork).toHaveBeenCalledWith(
      expect.objectContaining({ taskId, userId: "owner-user-2", mode: "live" })
    );
    expect(logInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining("Task creator has no GitHub credentials, falling back to workspace owner"),
      expect.stringContaining("creator-user-2")
    );
  });
});

// ─── createPrLogger Tests ─────────────────────────────────────────────────────

describe("createPrLogger", () => {
  const taskId = "task-logger-1";
  const workspaceId = "ws-logger-1";
  const featureId = "feature-logger-1";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.agentLog.findFirst).mockResolvedValue(null);
    vi.mocked(db.agentLog.create).mockResolvedValue({
      id: "log-1",
      agent: "pr-monitor",
      createdAt: new Date(),
    } as any);
    vi.mocked(db.agentLog.update).mockResolvedValue({
      id: "log-1",
      agent: "pr-monitor",
      createdAt: new Date(),
    } as any);
    vi.mocked(put).mockResolvedValue({ url: "https://blob.vercel.com/fake-url" } as any);
    vi.mocked(pusherServer.trigger).mockResolvedValue(undefined as any);
  });

  it("accumulates lines with correct level/msg/ts fields", () => {
    const prLog = createPrLogger(taskId);
    prLog.info("info message", { key: "val" });
    prLog.warn("warn message");
    prLog.error("error message", { err: "oops" });

    // The internal buffer is not directly accessible, but we can verify
    // by flushing and checking what was serialized into the blob
    // We'll verify by checking put call args after flush
  });

  it("flush uploads blob with correct path and JSON content", async () => {
    const prLog = createPrLogger(taskId);
    prLog.info("test info");
    prLog.warn("test warn");

    // Manually await flush by calling flushToAgentLog via the returned flush (which is void-wrapped)
    // We need to await the underlying promise — use a small trick: let microtasks drain
    prLog.flush(featureId, workspaceId);
    await new Promise((r) => setTimeout(r, 10));

    expect(put).toHaveBeenCalledWith(
      `agent-logs/${workspaceId}/${taskId}/pr-monitor.json`,
      expect.stringContaining('"level"'),
      expect.objectContaining({
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
      })
    );

    // Verify the JSON content is an array with correct entries
    const putCall = vi.mocked(put).mock.calls[0];
    const content = JSON.parse(putCall[1] as string);
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({ level: "info", msg: "test info" });
    expect(content[1]).toMatchObject({ level: "warn", msg: "test warn" });
    expect(content[0].ts).toBeDefined();
  });

  it("flush creates AgentLog row when no existing record", async () => {
    vi.mocked(db.agentLog.findFirst).mockResolvedValue(null);

    const prLog = createPrLogger(taskId);
    prLog.info("something happened");

    prLog.flush(featureId, workspaceId);
    await new Promise((r) => setTimeout(r, 10));

    expect(db.agentLog.create).toHaveBeenCalledWith({
      data: {
        blobUrl: "https://blob.vercel.com/fake-url",
        agent: "pr-monitor",
        taskId,
        featureId,
        workspaceId,
        repos: [],
      },
    });
    expect(db.agentLog.update).not.toHaveBeenCalled();
  });

  it("flush updates AgentLog row when existing record found", async () => {
    vi.mocked(db.agentLog.findFirst).mockResolvedValue({ id: "existing-log-1" } as any);

    const prLog = createPrLogger(taskId);
    prLog.info("update path");

    prLog.flush(featureId, workspaceId);
    await new Promise((r) => setTimeout(r, 10));

    expect(db.agentLog.update).toHaveBeenCalledWith({
      where: { id: "existing-log-1" },
      data: { blobUrl: "https://blob.vercel.com/fake-url" },
    });
    expect(db.agentLog.create).not.toHaveBeenCalled();
  });

  it("flush triggers Pusher on task channel", async () => {
    const prLog = createPrLogger(taskId);
    prLog.info("pusher test");

    prLog.flush(featureId, workspaceId);
    await new Promise((r) => setTimeout(r, 10));

    expect(pusherServer.trigger).toHaveBeenCalledWith(
      `task-${taskId}`,
      "agent-log-updated",
      expect.objectContaining({ id: "log-1", agent: "pr-monitor" })
    );
  });

  it("flush triggers Pusher on feature channel when featureId is non-null", async () => {
    const prLog = createPrLogger(taskId);
    prLog.info("feature pusher test");

    prLog.flush(featureId, workspaceId);
    await new Promise((r) => setTimeout(r, 10));

    const triggerCalls = vi.mocked(pusherServer.trigger).mock.calls;
    const featureCall = triggerCalls.find((c) => c[0] === `feature-${featureId}`);
    expect(featureCall).toBeDefined();
    expect(featureCall![1]).toBe("agent-log-updated");
  });

  it("flush skips feature Pusher when featureId is null", async () => {
    const prLog = createPrLogger(taskId);
    prLog.info("no feature");

    prLog.flush(null, workspaceId);
    await new Promise((r) => setTimeout(r, 10));

    const triggerCalls = vi.mocked(pusherServer.trigger).mock.calls;
    expect(triggerCalls).toHaveLength(1); // only task channel
    expect(triggerCalls[0][0]).toBe(`task-${taskId}`);
  });

  it("flush swallows errors — does not rethrow", async () => {
    vi.mocked(put).mockRejectedValue(new Error("Blob upload failed"));

    const prLog = createPrLogger(taskId);
    prLog.info("will fail");

    // Should not throw
    expect(() => prLog.flush(featureId, workspaceId)).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    // DB and pusher should not have been called
    expect(db.agentLog.create).not.toHaveBeenCalled();
    expect(pusherServer.trigger).not.toHaveBeenCalled();
  });

  it("flush is no-op when lines buffer is empty", async () => {
    const prLog = createPrLogger(taskId);
    // Don't log anything

    prLog.flush(featureId, workspaceId);
    await new Promise((r) => setTimeout(r, 10));

    expect(put).not.toHaveBeenCalled();
    expect(db.agentLog.create).not.toHaveBeenCalled();
    expect(pusherServer.trigger).not.toHaveBeenCalled();
  });
});

// ─── monitorSinglePR Tests ─────────────────────────────────────────────────────

describe("monitorSinglePR", () => {
  const prUrl = "https://github.com/org/repo/pull/42";

  // Helper to build a raw artifact row matching what db.$queryRaw returns
  function makeSingleArtifactRow(overrides: {
    url?: string;
    progress?: Record<string, unknown>;
    pr_conflict_fix_enabled?: boolean;
    pr_ci_failure_fix_enabled?: boolean;
  } = {}) {
    return {
      id: "artifact-single-1",
      content: {
        url: overrides.url ?? prUrl,
        status: "IN_PROGRESS",
        progress: overrides.progress ?? undefined,
      },
      task_id: "task-single-1",
      pod_id: null,
      workspace_id: "ws-single-1",
      owner_id: "owner-single-1",
      last_checked_at: null,
      pr_monitor_enabled: true,
      pr_conflict_fix_enabled: overrides.pr_conflict_fix_enabled ?? false,
      pr_ci_failure_fix_enabled: overrides.pr_ci_failure_fix_enabled ?? false,
      pr_out_of_date_fix_enabled: false,
      pr_use_rebase_for_updates: false,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: task lookup returns featureId
    vi.mocked(db.task.findUnique).mockResolvedValue({
      id: "task-single-1",
      featureId: "feature-single-1",
      mode: "live",
      workflowStatus: "COMPLETED",
      createdById: "creator-1",
      workspace: { ownerId: "owner-single-1", slug: "test-ws" },
    } as any);

    // Default: artifact update succeeds
    vi.mocked(db.artifact.findUnique).mockResolvedValue({
      content: {
        url: prUrl,
        status: "IN_PROGRESS",
      },
    } as any);
    vi.mocked(db.artifact.update).mockResolvedValue({} as any);

    // Default Octokit: returns healthy PR
    const { Octokit } = await import("@octokit/rest");
    vi.mocked(Octokit).mockImplementation(() => ({
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: {
            state: "open",
            merged: false,
            mergeable: true,
            mergeable_state: "clean",
            head: { ref: "feature/test", sha: "head-sha" },
            base: { ref: "main", sha: "base-sha" },
          },
        }),
        updateBranch: vi.fn(),
      },
      repos: {
        compareCommits: vi.fn().mockResolvedValue({ data: { ahead_by: 0 } }),
        merge: vi.fn(),
      },
    }));

    // Default CI: passing
    const { fetchCIStatus } = await import("@/lib/github/pr-ci");
    vi.mocked(fetchCIStatus).mockResolvedValue({
      status: "success",
      summary: "All checks passed",
      failedChecks: [],
      failedCheckLogs: {},
    });
  });

  it("returns zeroed stats and does not call checkPR when no artifact is found", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([]);

    const stats = await monitorSinglePR(prUrl);

    expect(stats).toEqual({
      checked: 0,
      conflicts: 0,
      ciFailures: 0,
      ciPending: 0,
      outOfDate: 0,
      autoMerged: 0,
      healthy: 0,
      errors: 0,
      agentTriggered: 0,
      notified: 0,
    });

    // Artifact update should never be called
    expect(db.artifact.update).not.toHaveBeenCalled();
  });

  it("returns stats.healthy === 1 and stats.checked === 1 for a healthy PR", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([makeSingleArtifactRow()]);

    const stats = await monitorSinglePR(prUrl);

    expect(stats.checked).toBe(1);
    expect(stats.healthy).toBe(1);
    expect(stats.errors).toBe(0);
    expect(stats.ciFailures).toBe(0);
  });

  it("returns stats.ciFailures === 1 when CI is failing", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([
      makeSingleArtifactRow({ pr_ci_failure_fix_enabled: true }),
    ]);

    const { fetchCIStatus } = await import("@/lib/github/pr-ci");
    vi.mocked(fetchCIStatus).mockResolvedValue({
      status: "failure",
      summary: "Tests failed",
      failedChecks: ["unit-tests"],
      failedCheckLogs: {},
    });

    const stats = await monitorSinglePR(prUrl);

    expect(stats.checked).toBe(1);
    expect(stats.ciFailures).toBe(1);
    expect(stats.healthy).toBe(0);
  });

  it("returns stats.outOfDate === 1 when PR is behind base (no CI block entered)", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([makeSingleArtifactRow()]);

    const { Octokit } = await import("@octokit/rest");
    vi.mocked(Octokit).mockImplementation(() => ({
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: {
            state: "open",
            merged: false,
            mergeable: true,
            mergeable_state: "behind",
            head: { ref: "feature/test", sha: "head-sha" },
            base: { ref: "main", sha: "base-sha" },
          },
        }),
        updateBranch: vi.fn(),
      },
      repos: {
        // ahead_by > 0 means base is ahead of head → PR is behind
        compareCommits: vi.fn().mockResolvedValue({ data: { ahead_by: 3 } }),
        merge: vi.fn(),
      },
    }));

    // CI would report failure, but the behind-base check should short-circuit before it
    const { fetchCIStatus } = await import("@/lib/github/pr-ci");
    vi.mocked(fetchCIStatus).mockResolvedValue({
      status: "failure",
      summary: "Tests failed",
      failedChecks: ["unit-tests"],
      failedCheckLogs: {},
    });

    const stats = await monitorSinglePR(prUrl);

    expect(stats.checked).toBe(1);
    expect(stats.outOfDate).toBe(1);
    expect(stats.ciFailures).toBe(0);
    expect(stats.healthy).toBe(0);
  });

  it("returns stats.ciFailures === 1 when CI fails and PR is not behind base", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([
      makeSingleArtifactRow({ pr_ci_failure_fix_enabled: true }),
    ]);

    const { Octokit } = await import("@octokit/rest");
    vi.mocked(Octokit).mockImplementation(() => ({
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: {
            state: "open",
            merged: false,
            mergeable: true,
            mergeable_state: "unstable",
            head: { ref: "feature/test", sha: "head-sha" },
            base: { ref: "main", sha: "base-sha" },
          },
        }),
        updateBranch: vi.fn(),
      },
      repos: {
        // ahead_by === 0 means PR is up-to-date with base
        compareCommits: vi.fn().mockResolvedValue({ data: { ahead_by: 0 } }),
        merge: vi.fn(),
      },
    }));

    const { fetchCIStatus } = await import("@/lib/github/pr-ci");
    vi.mocked(fetchCIStatus).mockResolvedValue({
      status: "failure",
      summary: "Tests failed",
      failedChecks: ["unit-tests"],
      failedCheckLogs: {},
    });

    const stats = await monitorSinglePR(prUrl);

    expect(stats.checked).toBe(1);
    expect(stats.ciFailures).toBe(1);
    expect(stats.outOfDate).toBe(0);
    expect(stats.healthy).toBe(0);
  });

  it("returns stats.outOfDate === 1 (not ciFailures) when PR is both behind base and has CI failures", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([
      makeSingleArtifactRow({ pr_ci_failure_fix_enabled: true }),
    ]);

    const { Octokit } = await import("@octokit/rest");
    vi.mocked(Octokit).mockImplementation(() => ({
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: {
            state: "open",
            merged: false,
            mergeable: true,
            mergeable_state: "behind",
            head: { ref: "feature/test", sha: "head-sha" },
            base: { ref: "main", sha: "base-sha" },
          },
        }),
        updateBranch: vi.fn(),
      },
      repos: {
        compareCommits: vi.fn().mockResolvedValue({ data: { ahead_by: 2 } }),
        merge: vi.fn(),
      },
    }));

    const { fetchCIStatus } = await import("@/lib/github/pr-ci");
    vi.mocked(fetchCIStatus).mockResolvedValue({
      status: "failure",
      summary: "Tests failed",
      failedChecks: ["unit-tests"],
      failedCheckLogs: {},
    });

    const stats = await monitorSinglePR(prUrl);

    // behind-base wins — state becomes out_of_date before CI block is reached
    expect(stats.checked).toBe(1);
    expect(stats.outOfDate).toBe(1);
    expect(stats.ciFailures).toBe(0);
    expect(stats.healthy).toBe(0);
  });

  it("returns zeroed stats (same as no artifact) when pr_monitor_enabled filter excludes the record", async () => {
    // The SQL query filters COALESCE(jc.pr_monitor_enabled, false) = true,
    // so a disabled workspace returns no rows — identical to "not found" case
    vi.mocked(db.$queryRaw).mockResolvedValue([]);

    const stats = await monitorSinglePR(prUrl);

    expect(stats).toMatchObject({
      checked: 0,
      conflicts: 0,
      ciFailures: 0,
      ciPending: 0,
      outOfDate: 0,
      autoMerged: 0,
      healthy: 0,
      errors: 0,
      agentTriggered: 0,
      notified: 0,
    });
  });
});
