 
import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { extractPrArtifact } from "@/lib/helpers/tasks";
import { TaskStatus } from "@prisma/client";

// Mock dependencies
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    artifact: {
      update: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/pods/utils", () => ({
  releaseTaskPod: vi.fn(),
}));

vi.mock("@/config/services", () => ({
  serviceConfigs: {
    github: {
      baseURL: "https://api.github.com",
    },
  },
}));

// Import mocked functions
import { getUserAppTokens } from "@/lib/githubApp";
import { db } from "@/lib/db";
import { releaseTaskPod } from "@/lib/pods/utils";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

// Test data factories
function createMockTask(overrides: Partial<{
  id: string;
  status: TaskStatus;
  podId: string | null;
  workspaceId: string;
  chatMessages: unknown[];
}> = {}) {
  return {
    id: "task-123",
    status: TaskStatus.IN_PROGRESS,
    chatMessages: [],
    ...overrides,
  };
}

function createMockChatMessage(artifacts: Array<{
  id: string;
  type: string;
  content: Record<string, unknown>;
}> = []) {
  return {
    id: "message-123",
    artifacts,
  };
}

function createMockPrArtifact(contentOverrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-123",
    type: "PULL_REQUEST",
    content: {
      url: "https://github.com/test-owner/test-repo/pull/42",
      status: "IN_PROGRESS",
      ...contentOverrides,
    },
  };
}

describe("extractPrArtifact", () => {
  const mockUserId = "user-123";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.task.findUnique).mockResolvedValue(null as any);
    vi.mocked(releaseTaskPod).mockResolvedValue({
      success: true,
      podDropped: true,
      taskCleared: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Null/Empty Input Handling", () => {
    test("returns null when task has no chatMessages", async () => {
      const task = createMockTask({ chatMessages: undefined });

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toBeNull();
    });

    test("returns null when chatMessages is empty array", async () => {
      const task = createMockTask({ chatMessages: [] });

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toBeNull();
    });

    test("returns null when message has no artifacts", async () => {
      const message = createMockChatMessage([]);
      const task = createMockTask({ chatMessages: [message] });

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toBeNull();
    });

    test("returns null when message has undefined artifacts", async () => {
      const task = createMockTask({
        chatMessages: [{ id: "msg-1" }],
      });

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toBeNull();
    });

    test("returns null when no PULL_REQUEST artifact exists", async () => {
      const codeArtifact = {
        id: "artifact-code",
        type: "CODE",
        content: { code: "console.log('test')" },
      };
      const message = createMockChatMessage([codeArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toBeNull();
    });

    test("returns null when artifact has null content", async () => {
      const prArtifact = {
        id: "artifact-123",
        type: "PULL_REQUEST",
        content: null,
      };
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toBeNull();
    });
  });

  describe("Terminal Status Handling (DONE)", () => {
    test("returns artifact immediately when status is DONE without calling GitHub API", async () => {
      const prArtifact = createMockPrArtifact({ status: "DONE" });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });
      expect(getUserAppTokens).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(db.artifact.update).not.toHaveBeenCalled();
    });

    test("releases assigned pod when artifact is already marked DONE", async () => {
      const prArtifact = createMockPrArtifact({ status: "DONE" });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({
        chatMessages: [message],
        podId: "pod-123",
        workspaceId: "workspace-123",
      });

      await extractPrArtifact(task as any, mockUserId);

      expect(releaseTaskPod).toHaveBeenCalledWith({
        taskId: task.id,
        podId: "pod-123",
        workspaceId: "workspace-123",
        verifyOwnership: true,
        clearTaskFields: true,
        newWorkflowStatus: null,
      });
    });

    test("skips GitHub API call for merged PRs (status: DONE) while syncing task state", async () => {
      const prArtifact = createMockPrArtifact({
        status: "DONE",
        url: "https://github.com/owner/repo/pull/100",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      await extractPrArtifact(task, mockUserId);

      // Verify no external calls
      expect(getUserAppTokens).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(db.artifact.update).not.toHaveBeenCalled();
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: task.id },
        data: { status: TaskStatus.DONE },
      });
    });
  });

  describe("Non-Terminal Status Handling (CANCELLED)", () => {
    test("checks GitHub API when status is CANCELLED (can be reopened)", async () => {
      const prArtifact = createMockPrArtifact({ status: "CANCELLED" });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github-token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "open",
          merged_at: null,
        }),
      });

      await extractPrArtifact(task, mockUserId);

      expect(getUserAppTokens).toHaveBeenCalledWith(mockUserId, "test-owner");
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("GitHub API Integration - Happy Path", () => {
    test("successfully fetches PR status and updates artifact for open PR", async () => {
      const prArtifact = createMockPrArtifact({
        status: "IN_PROGRESS",
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github-token-123",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "open",
          merged_at: null,
        }),
      });
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);

      const result = await extractPrArtifact(task, mockUserId);

      // Verify getUserAppTokens called with correct params
      expect(getUserAppTokens).toHaveBeenCalledWith(mockUserId, "owner");

      // Verify GitHub API fetch
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo/pulls/42",
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: "Bearer github-token-123",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      // Verify artifact update
      expect(db.artifact.update).toHaveBeenCalledWith({
        where: { id: prArtifact.id },
        data: {
          content: {
            url: prArtifact.content.url,
            status: "IN_PROGRESS",
          },
        },
      });

      // Verify return value
      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: {
          url: prArtifact.content.url,
          status: "IN_PROGRESS",
        },
      });

      // Task should NOT be updated (PR still open)
      expect(db.task.update).not.toHaveBeenCalled();
    });

    test("updates artifact and task status when PR is merged", async () => {
      const prArtifact = createMockPrArtifact({
        status: "IN_PROGRESS",
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({
        id: "task-456",
        status: TaskStatus.IN_PROGRESS,
        chatMessages: [message],
      });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github-token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "closed",
          merged_at: "2024-01-15T10:30:00Z",
        }),
      });
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);
      vi.mocked(db.task.update).mockResolvedValue({} as any);

      const result = await extractPrArtifact(task, mockUserId);

      // Verify artifact updated with DONE status
      expect(db.artifact.update).toHaveBeenCalledWith({
        where: { id: prArtifact.id },
        data: {
          content: {
            url: prArtifact.content.url,
            status: "DONE",
          },
        },
      });

      // Verify task status updated to DONE
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: task.id },
        data: { status: TaskStatus.DONE },
      });

      expect(result?.content.status).toBe("DONE");
    });

    test("releases pod when merged PR is detected from GitHub and task context must be reloaded", async () => {
      const prArtifact = createMockPrArtifact({
        status: "IN_PROGRESS",
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({
        id: "task-release",
        status: TaskStatus.IN_PROGRESS,
        chatMessages: [message],
      });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github-token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "closed",
          merged_at: "2024-01-15T10:30:00Z",
        }),
      });
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);
      vi.mocked(db.task.update).mockResolvedValue({} as any);
      vi.mocked(db.task.findUnique).mockResolvedValue({
        workspaceId: "workspace-456",
        podId: "pod-456",
      } as any);

      await extractPrArtifact(task, mockUserId);

      expect(db.task.findUnique).toHaveBeenCalledWith({
        where: { id: task.id },
        select: {
          workspaceId: true,
          podId: true,
        },
      });
      expect(releaseTaskPod).toHaveBeenCalledWith({
        taskId: task.id,
        podId: "pod-456",
        workspaceId: "workspace-456",
        verifyOwnership: true,
        clearTaskFields: true,
        newWorkflowStatus: null,
      });
    });

    test("updates artifact to CANCELLED when PR is closed but not merged", async () => {
      const prArtifact = createMockPrArtifact({
        status: "IN_PROGRESS",
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github-token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "closed",
          merged_at: null,
        }),
      });
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);

      const result = await extractPrArtifact(task, mockUserId);

      expect(db.artifact.update).toHaveBeenCalledWith({
        where: { id: prArtifact.id },
        data: {
          content: {
            url: prArtifact.content.url,
            status: "CANCELLED",
          },
        },
      });

      expect(result?.content.status).toBe("CANCELLED");
      expect(db.task.update).not.toHaveBeenCalled();
    });

    test("does not update task status when task already DONE", async () => {
      const prArtifact = createMockPrArtifact({
        status: "IN_PROGRESS",
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({
        id: "task-done",
        status: TaskStatus.DONE,
        chatMessages: [message],
      });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github-token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "closed",
          merged_at: "2024-01-15T10:30:00Z",
        }),
      });
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);

      await extractPrArtifact(task, mockUserId);

      // Artifact should still be updated
      expect(db.artifact.update).toHaveBeenCalled();
      // But task should NOT be updated (already DONE)
      expect(db.task.update).not.toHaveBeenCalled();
    });
  });

  describe("URL Parsing Edge Cases", () => {
    test("handles PR URL with no matching pattern", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });
      expect(getUserAppTokens).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    test("handles null PR URL", async () => {
      const prArtifact = createMockPrArtifact({ url: null });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "No PR URL found for task:",
        task.id
      );

      consoleErrorSpy.mockRestore();
    });

    test("handles undefined PR URL", async () => {
      const prArtifact = {
        id: "artifact-123",
        type: "PULL_REQUEST",
        content: { status: "IN_PROGRESS" },
      };
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await extractPrArtifact(task, mockUserId);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "No PR URL found for task:",
        task.id
      );
      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });

      consoleErrorSpy.mockRestore();
    });

    test("parses PR number correctly from various URL formats", async () => {
      const testCases = [
        {
          url: "https://github.com/owner/repo/pull/123",
          expectedNumber: 123,
        },
        {
          url: "https://github.com/org/project/pull/999",
          expectedNumber: 999,
        },
        {
          url: "https://github.com/user/repo-name/pull/1",
          expectedNumber: 1,
        },
      ];

      for (const testCase of testCases) {
        vi.clearAllMocks();

        const prArtifact = createMockPrArtifact({ url: testCase.url });
        const message = createMockChatMessage([prArtifact]);
        const task = createMockTask({ chatMessages: [message] });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "token",
        });
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ state: "open", merged_at: null }),
        });

        await extractPrArtifact(task, mockUserId);

        const [owner, repo] = testCase.url.split("/").slice(3, 5);
        expect(mockFetch).toHaveBeenCalledWith(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${testCase.expectedNumber}`,
          expect.any(Object)
        );
      }
    });
  });

  describe("Authentication Handling", () => {
    test("returns artifact without update when getUserAppTokens returns null", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      const result = await extractPrArtifact(task, mockUserId);

      expect(getUserAppTokens).toHaveBeenCalledWith(mockUserId, "owner");
      expect(mockFetch).not.toHaveBeenCalled();
      expect(db.artifact.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });
    });

    test("returns artifact without update when accessToken is undefined", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        refreshToken: "refresh-token",
      });

      const result = await extractPrArtifact(task, mockUserId);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });
    });

    test("handles getUserAppTokens throwing error", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockRejectedValue(
        new Error("Decryption failed")
      );

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await extractPrArtifact(task, mockUserId);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error checking PR status:",
        expect.any(Error)
      );
      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe("GitHub API Error Handling", () => {
    test("handles GitHub API returning non-ok response", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github-token",
      });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await extractPrArtifact(task, mockUserId);

      expect(db.artifact.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });
    });

    test("handles GitHub API network error", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github-token",
      });
      mockFetch.mockRejectedValue(new Error("Network error"));

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await extractPrArtifact(task, mockUserId);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error checking PR status:",
        expect.any(Error)
      );
      expect(db.artifact.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });

      consoleErrorSpy.mockRestore();
    });

    test("handles GitHub API returning malformed JSON", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github-token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await extractPrArtifact(task, mockUserId);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error checking PR status:",
        expect.any(Error)
      );
      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Complex Message Structures", () => {
    test("finds PULL_REQUEST artifact among multiple artifact types", async () => {
      const codeArtifact = {
        id: "artifact-code",
        type: "CODE",
        content: { code: "test" },
      };
      const prArtifact = createMockPrArtifact({ status: "DONE" });
      const diffArtifact = {
        id: "artifact-diff",
        type: "DIFF",
        content: { diffs: [] },
      };

      const message = createMockChatMessage([
        codeArtifact,
        prArtifact,
        diffArtifact,
      ]);
      const task = createMockTask({ chatMessages: [message] });

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });
    });

    test("returns first PULL_REQUEST artifact when multiple exist", async () => {
      const prArtifact1 = createMockPrArtifact({ status: "DONE" });
      prArtifact1.id = "artifact-pr-1";

      const prArtifact2 = createMockPrArtifact({ status: "IN_PROGRESS" });
      prArtifact2.id = "artifact-pr-2";

      const message = createMockChatMessage([prArtifact1, prArtifact2]);
      const task = createMockTask({ chatMessages: [message] });

      const result = await extractPrArtifact(task, mockUserId);

      // Should return the first one found
      expect(result?.id).toBe(prArtifact1.id);
    });

    test("searches through multiple messages to find PULL_REQUEST artifact", async () => {
      const message1 = createMockChatMessage([
        { id: "artifact-1", type: "CODE", content: {} },
      ]);
      const message2 = createMockChatMessage([
        { id: "artifact-2", type: "DIFF", content: {} },
      ]);
      const prArtifact = createMockPrArtifact({ status: "DONE" });
      const message3 = createMockChatMessage([prArtifact]);

      const task = createMockTask({
        chatMessages: [message1, message2, message3],
      });

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toEqual({
        id: prArtifact.id,
        type: prArtifact.type,
        content: prArtifact.content,
      });
    });

    test("handles deeply nested message structures", async () => {
      const prArtifact = createMockPrArtifact({
        status: "DONE",
        url: "https://github.com/owner/repo/pull/123",
        repository: {
          owner: "owner",
          name: "repo",
        },
        prNumber: 123,
        title: "Test PR",
        mergedAt: "2024-01-15T10:30:00Z",
      });

      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({
        id: "task-complex",
        status: TaskStatus.IN_PROGRESS,
        chatMessages: [message],
      });

      const result = await extractPrArtifact(task, mockUserId);

      expect(result).toBeDefined();
      expect(result?.content).toEqual(prArtifact.content);
      expect(result?.content.repository).toBeDefined();
      expect(result?.content.mergedAt).toBe("2024-01-15T10:30:00Z");
    });
  });

  describe("Database Operation Edge Cases", () => {
    test("handles db.artifact.update failure gracefully", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github-token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ state: "open", merged_at: null }),
      });
      vi.mocked(db.artifact.update).mockRejectedValue(
        new Error("Database error")
      );

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await extractPrArtifact(task, mockUserId);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error checking PR status:",
        expect.any(Error)
      );

      // Function should still return the artifact with updated content in memory
      expect(result).toBeDefined();
      expect(result?.content.status).toBe("IN_PROGRESS");

      consoleErrorSpy.mockRestore();
    });

    test("handles db.task.update failure when PR merged", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({
        status: TaskStatus.IN_PROGRESS,
        chatMessages: [message],
      });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github-token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "closed",
          merged_at: "2024-01-15T10:30:00Z",
        }),
      });
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);
      vi.mocked(db.task.update).mockRejectedValue(
        new Error("Task update failed")
      );

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await extractPrArtifact(task, mockUserId);

      // Artifact update should succeed
      expect(db.artifact.update).toHaveBeenCalled();
      // Task update attempted but failed
      expect(db.task.update).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();

      expect(result?.content.status).toBe("DONE");

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Business Logic Validation", () => {
    test("correctly maps GitHub PR state to internal status: open -> IN_PROGRESS", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ state: "open", merged_at: null }),
      });
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);

      const result = await extractPrArtifact(task, mockUserId);

      expect(result?.content.status).toBe("IN_PROGRESS");
    });

    test("correctly maps GitHub PR state to internal status: merged -> DONE", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "closed",
          merged_at: "2024-01-15T10:30:00Z",
        }),
      });
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);

      const result = await extractPrArtifact(task, mockUserId);

      expect(result?.content.status).toBe("DONE");
    });

    test("correctly maps GitHub PR state to internal status: closed (not merged) -> CANCELLED", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ state: "closed", merged_at: null }),
      });
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);

      const result = await extractPrArtifact(task, mockUserId);

      expect(result?.content.status).toBe("CANCELLED");
    });

    test("preserves artifact content fields during status update", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
        status: "IN_PROGRESS",
        repository: { owner: "owner", name: "repo" },
        prNumber: 42,
        title: "Test PR",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "token",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "closed",
          merged_at: "2024-01-15T10:30:00Z",
        }),
      });
      vi.mocked(db.artifact.update).mockResolvedValue({} as any);

      const result = await extractPrArtifact(task, mockUserId);

      // All original fields should be preserved
      expect(result?.content).toEqual({
        url: prArtifact.content.url,
        status: "DONE", // Updated
        repository: prArtifact.content.repository,
        prNumber: prArtifact.content.prNumber,
        title: prArtifact.content.title,
      });
    });

    test("verifies GitHub API headers include required authentication", async () => {
      const prArtifact = createMockPrArtifact({
        url: "https://github.com/owner/repo/pull/42",
      });
      const message = createMockChatMessage([prArtifact]);
      const task = createMockTask({ chatMessages: [message] });

      const testToken = "ghs_test_token_12345";
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: testToken,
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ state: "open", merged_at: null }),
      });

      await extractPrArtifact(task, mockUserId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${testToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        })
      );
    });
  });
});

import { extractPublishArtifact } from "@/lib/helpers/tasks";

describe("extractPublishArtifact", () => {
  function makeTask(chatMessages: Array<{ artifacts?: Array<{ id: string; type: string; content: Record<string, unknown> }> }> = []) {
    return { id: "task-1", status: TaskStatus.IN_PROGRESS, chatMessages };
  }

  test("returns null when task has no chatMessages", () => {
    expect(extractPublishArtifact({ id: "t", status: TaskStatus.TODO, chatMessages: undefined })).toBeNull();
  });

  test("returns null when chatMessages is empty", () => {
    expect(extractPublishArtifact(makeTask([]))).toBeNull();
  });

  test("returns null when no publish artifacts exist", () => {
    const task = makeTask([{ artifacts: [{ id: "a1", type: "CODE", content: {} }] }]);
    expect(extractPublishArtifact(task)).toBeNull();
  });

  test("returns null for PUBLISH_SKILL (explicitly excluded)", () => {
    const task = makeTask([{ artifacts: [{ id: "a1", type: "PUBLISH_SKILL", content: { published: true } }] }]);
    expect(extractPublishArtifact(task)).toBeNull();
  });

  test("returns artifact for PUBLISH_WORKFLOW", () => {
    const task = makeTask([{ artifacts: [{ id: "a1", type: "PUBLISH_WORKFLOW", content: { published: true, workflowName: "My Flow" } }] }]);
    const result = extractPublishArtifact(task);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("PUBLISH_WORKFLOW");
    expect(result?.content.published).toBe(true);
    expect(result?.content.name).toBe("My Flow");
  });

  test("returns artifact for PUBLISH_SCRIPT", () => {
    const task = makeTask([{ artifacts: [{ id: "a1", type: "PUBLISH_SCRIPT", content: { published: false, scriptName: "My Script" } }] }]);
    const result = extractPublishArtifact(task);
    expect(result?.type).toBe("PUBLISH_SCRIPT");
    expect(result?.content.published).toBe(false);
    expect(result?.content.name).toBe("My Script");
  });

  test("returns artifact for PUBLISH_PROMPT", () => {
    const task = makeTask([{ artifacts: [{ id: "a1", type: "PUBLISH_PROMPT", content: { published: true, promptName: "My Prompt" } }] }]);
    const result = extractPublishArtifact(task);
    expect(result?.type).toBe("PUBLISH_PROMPT");
    expect(result?.content.name).toBe("My Prompt");
  });

  test("returns the LAST publish artifact when multiple exist across messages", () => {
    const task = makeTask([
      { artifacts: [{ id: "a1", type: "PUBLISH_WORKFLOW", content: { published: false } }] },
      { artifacts: [{ id: "a2", type: "PUBLISH_SCRIPT", content: { published: true } }] },
    ]);
    const result = extractPublishArtifact(task);
    expect(result?.id).toBe("a2");
    expect(result?.type).toBe("PUBLISH_SCRIPT");
  });

  test("returns the last artifact when multiple publish artifacts exist within a single message", () => {
    const task = makeTask([{
      artifacts: [
        { id: "a1", type: "PUBLISH_WORKFLOW", content: { published: false } },
        { id: "a2", type: "PUBLISH_PROMPT", content: { published: true } },
      ],
    }]);
    const result = extractPublishArtifact(task);
    expect(result?.id).toBe("a2");
  });

  test("returns correct published boolean (false)", () => {
    const task = makeTask([{ artifacts: [{ id: "a1", type: "PUBLISH_WORKFLOW", content: { published: false } }] }]);
    expect(extractPublishArtifact(task)?.content.published).toBe(false);
  });

  test("returns undefined name when no name fields are present", () => {
    const task = makeTask([{ artifacts: [{ id: "a1", type: "PUBLISH_PROMPT", content: { published: true } }] }]);
    expect(extractPublishArtifact(task)?.content.name).toBeUndefined();
  });

  test("ignores non-publish artifacts alongside publish artifacts and still returns the publish one", () => {
    const task = makeTask([{
      artifacts: [
        { id: "a0", type: "PULL_REQUEST", content: { url: "http://x", status: "IN_PROGRESS" } },
        { id: "a1", type: "PUBLISH_SCRIPT", content: { published: true, scriptName: "S" } },
      ],
    }]);
    const result = extractPublishArtifact(task);
    expect(result?.id).toBe("a1");
  });
});

import { allWorkflowArtifactsPublished } from "@/lib/helpers/tasks";

describe("allWorkflowArtifactsPublished", () => {
  function makeMessages(
    artifacts: Array<{ id: string; type: string; content?: Record<string, unknown> }>,
  ) {
    return [{ artifacts }];
  }

  test("returns true when chatMessages is undefined", () => {
    expect(allWorkflowArtifactsPublished(undefined, "any-id")).toBe(true);
  });

  test("returns true when chatMessages is empty array", () => {
    expect(allWorkflowArtifactsPublished([], "any-id")).toBe(true);
  });

  test("returns true when there are no WORKFLOW or PUBLISH_WORKFLOW artifacts", () => {
    const messages = makeMessages([
      { id: "a1", type: "CODE", content: { published: false } },
      { id: "a2", type: "PULL_REQUEST", content: {} },
    ]);
    expect(allWorkflowArtifactsPublished(messages, "x")).toBe(true);
  });

  test("returns true when the only matching artifact is the just-published one", () => {
    const messages = makeMessages([
      { id: "artifact-1", type: "PUBLISH_WORKFLOW", content: { published: false } },
    ]);
    // artifact-1 was just published — treat it as done
    expect(allWorkflowArtifactsPublished(messages, "artifact-1")).toBe(true);
  });

  test("returns true when all PUBLISH_WORKFLOW artifacts are published", () => {
    const messages = makeMessages([
      { id: "a1", type: "PUBLISH_WORKFLOW", content: { published: true } },
      { id: "a2", type: "PUBLISH_WORKFLOW", content: { published: true } },
    ]);
    expect(allWorkflowArtifactsPublished(messages, "non-existent-id")).toBe(true);
  });

  test("returns true when all WORKFLOW artifacts are published", () => {
    const messages = makeMessages([
      { id: "a1", type: "WORKFLOW", content: { published: true } },
    ]);
    expect(allWorkflowArtifactsPublished(messages, "non-existent-id")).toBe(true);
  });

  test("returns false when one PUBLISH_WORKFLOW artifact is unpublished", () => {
    const messages = makeMessages([
      { id: "a1", type: "PUBLISH_WORKFLOW", content: { published: true } },
      { id: "a2", type: "PUBLISH_WORKFLOW", content: { published: false } },
    ]);
    expect(allWorkflowArtifactsPublished(messages, "non-existent-id")).toBe(false);
  });

  test("returns false when one WORKFLOW artifact has no published field", () => {
    const messages = makeMessages([
      { id: "a1", type: "WORKFLOW", content: {} },
    ]);
    expect(allWorkflowArtifactsPublished(messages, "non-existent-id")).toBe(false);
  });

  test("returns true when last unpublished artifact is the just-published one", () => {
    const messages = makeMessages([
      { id: "a1", type: "PUBLISH_WORKFLOW", content: { published: true } },
      { id: "a2", type: "PUBLISH_WORKFLOW", content: { published: false } }, // just published
    ]);
    expect(allWorkflowArtifactsPublished(messages, "a2")).toBe(true);
  });

  test("ignores non-matching artifact types when evaluating", () => {
    const messages = makeMessages([
      { id: "a1", type: "PUBLISH_SCRIPT", content: { published: false } },
      { id: "a2", type: "PUBLISH_WORKFLOW", content: { published: true } },
    ]);
    expect(allWorkflowArtifactsPublished(messages, "non-existent-id")).toBe(true);
  });

  test("works across multiple messages", () => {
    const messages = [
      { artifacts: [{ id: "a1", type: "PUBLISH_WORKFLOW", content: { published: true } }] },
      { artifacts: [{ id: "a2", type: "PUBLISH_WORKFLOW", content: { published: false } }] },
    ];
    expect(allWorkflowArtifactsPublished(messages, "non-existent-id")).toBe(false);
    expect(allWorkflowArtifactsPublished(messages, "a2")).toBe(true);
  });
});
