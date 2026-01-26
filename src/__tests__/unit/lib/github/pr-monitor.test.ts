import { describe, it, expect, beforeEach, vi } from "vitest";
import { mergeBaseBranch, rebaseOntoBaseBranch } from "@/lib/github/pr-monitor";
import type { Octokit } from "@octokit/rest";

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
});
