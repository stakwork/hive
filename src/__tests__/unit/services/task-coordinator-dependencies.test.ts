import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { Task, ChatMessage, Artifact } from "@prisma/client";

// Mock dependencies at module level
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findMany: vi.fn(),
    },
  },
}));

// Import mocked modules
const { db: mockDb } = await import("@/lib/db");

// Import function under test
const { areDependenciesSatisfied } = await import("@/services/task-coordinator-cron");

// Test Helpers - Mock data factories
const TestHelpers = {
  createMockTask: (
    id: string,
    status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "BLOCKED" = "TODO",
    chatMessages: Array<ChatMessage & { artifacts: Artifact[] }> = []
  ): Task & { chatMessages: Array<ChatMessage & { artifacts: Artifact[] }> } => {
    return {
      id,
      title: `Test Task ${id}`,
      description: `Description for task ${id}`,
      status,
      priority: "MEDIUM",
      sourceType: "USER",
      workflowStatus: null,
      workspaceId: "workspace-1",
      createdById: "user-1",
      updatedById: "user-1",
      assigneeId: null,
      systemAssigneeType: null,
      featureId: null,
      phaseId: null,
      repositoryId: null,
      order: 0,
      dependsOnTaskIds: [],
      testFilePath: null,
      testFileUrl: null,
      stakworkProjectId: null,
      stakworkTicketUUID: null,
      deleted: false,
      podId: null,
      agentUrl: null,
      agentPassword: null,
      workflowCompletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      chatMessages,
    } as Task & { chatMessages: Array<ChatMessage & { artifacts: Artifact[] }> };
  },

  createMockChatMessage: (
    id: string,
    taskId: string,
    artifacts: Artifact[] = [],
    createdAt: Date = new Date()
  ): ChatMessage & { artifacts: Artifact[] } => {
    return {
      id,
      taskId,
      message: `Test message ${id}`,
      role: "ASSISTANT",
      contextTags: null,
      createdAt,
      updatedAt: new Date(),
      artifacts,
    } as ChatMessage & { artifacts: Artifact[] };
  },

  createMockPRArtifact: (
    id: string,
    messageId: string,
    status: "IN_PROGRESS" | "DONE" | "CANCELLED" = "DONE",
    url: string = "https://github.com/org/repo/pull/123",
    createdAt: Date = new Date()
  ): Artifact => {
    return {
      id,
      messageId,
      type: "PULL_REQUEST",
      content: {
        url,
        status,
      },
      icon: null,
      createdAt,
      updatedAt: new Date(),
    } as Artifact;
  },

  setupMockTasksInDatabase: (tasks: Array<Task & { chatMessages: any[] }>) => {
    vi.mocked(mockDb.task.findMany).mockResolvedValue(tasks as any);
  },
};

describe("areDependenciesSatisfied", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe("Empty Dependencies", () => {
    test("should return true for empty array without database query", async () => {
      const result = await areDependenciesSatisfied([]);

      expect(result).toBe(true);
      expect(mockDb.task.findMany).not.toHaveBeenCalled();
    });

    test("should return true for empty array immediately", async () => {
      const result = await areDependenciesSatisfied([]);

      expect(result).toBe(true);
    });
  });

  describe("Missing Dependencies", () => {
    test("should return false when dependency not found in database", async () => {
      TestHelpers.setupMockTasksInDatabase([]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Expected 1 dependencies, found 0")
      );
    });

    test("should return false when only some dependencies found", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "DONE");
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1", "task-2", "task-3"]);

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Expected 3 dependencies, found 1")
      );
    });

    test("should log warning message with correct counts", async () => {
      TestHelpers.setupMockTasksInDatabase([]);

      await areDependenciesSatisfied(["task-1", "task-2"]);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[TaskCoordinator] Dependency validation warning: Expected 2 dependencies, found 0"
      );
    });

    test("should query database with correct task IDs", async () => {
      TestHelpers.setupMockTasksInDatabase([]);

      await areDependenciesSatisfied(["task-1", "task-2"]);

      expect(mockDb.task.findMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: ["task-1", "task-2"],
          },
        },
        include: {
          chatMessages: {
            include: {
              artifacts: {
                where: {
                  type: "PULL_REQUEST",
                },
              },
            },
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      });
    });
  });

  describe("Dependencies without PR Artifacts", () => {
    test("should return true when dependency status is DONE and no PR artifacts", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "DONE", []);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(true);
    });

    test("should return false when dependency status is TODO and no PR artifacts", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "TODO", []);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(false);
    });

    test("should return false when dependency status is IN_PROGRESS and no PR artifacts", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", []);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(false);
    });

    test("should return false when dependency status is BLOCKED and no PR artifacts", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "BLOCKED", []);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(false);
    });

    test("should return false when dependency status is CANCELLED and no PR artifacts", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "CANCELLED", []);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(false);
    });

    test("should log message when dependency not satisfied without PR", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "TODO", []);
      TestHelpers.setupMockTasksInDatabase([task1]);

      await areDependenciesSatisfied(["task-1"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "[TaskCoordinator] Dependency task-1 not satisfied - no PR artifact, status: TODO"
      );
    });

    test("should not log when dependency satisfied without PR", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "DONE", []);
      TestHelpers.setupMockTasksInDatabase([task1]);

      await areDependenciesSatisfied(["task-1"]);

      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("not satisfied")
      );
    });
  });

  describe("Dependencies with PR Artifacts", () => {
    test("should return true when latest PR artifact status is DONE", async () => {
      const artifact = TestHelpers.createMockPRArtifact("art-1", "msg-1", "DONE");
      const message = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(true);
    });

    test("should return false when latest PR artifact status is IN_PROGRESS", async () => {
      const artifact = TestHelpers.createMockPRArtifact("art-1", "msg-1", "IN_PROGRESS");
      const message = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(false);
    });

    test("should return false when latest PR artifact status is CANCELLED", async () => {
      const artifact = TestHelpers.createMockPRArtifact("art-1", "msg-1", "CANCELLED");
      const message = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(false);
    });

    test("should ignore task status when PR artifact exists", async () => {
      const artifact = TestHelpers.createMockPRArtifact("art-1", "msg-1", "DONE");
      const message = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact]);
      const task1 = TestHelpers.createMockTask("task-1", "TODO", [message]); // Task status TODO but PR DONE
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(true); // PR status takes precedence
    });

    test("should use latest PR artifact by createdAt when multiple exist", async () => {
      const oldDate = new Date("2024-01-01T10:00:00Z");
      const recentDate = new Date("2024-01-02T10:00:00Z");

      const oldArtifact = TestHelpers.createMockPRArtifact(
        "art-1",
        "msg-1",
        "IN_PROGRESS",
        "https://github.com/org/repo/pull/123",
        oldDate
      );
      const recentArtifact = TestHelpers.createMockPRArtifact(
        "art-2",
        "msg-2",
        "DONE",
        "https://github.com/org/repo/pull/124",
        recentDate
      );

      const message1 = TestHelpers.createMockChatMessage("msg-1", "task-1", [oldArtifact], oldDate);
      const message2 = TestHelpers.createMockChatMessage("msg-2", "task-1", [recentArtifact], recentDate);

      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message1, message2]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(true); // Latest PR (recentArtifact) is DONE
    });

    test("should return false when latest PR is not DONE even if older PR is DONE", async () => {
      const oldDate = new Date("2024-01-01T10:00:00Z");
      const recentDate = new Date("2024-01-02T10:00:00Z");

      const oldArtifact = TestHelpers.createMockPRArtifact(
        "art-1",
        "msg-1",
        "DONE",
        "https://github.com/org/repo/pull/123",
        oldDate
      );
      const recentArtifact = TestHelpers.createMockPRArtifact(
        "art-2",
        "msg-2",
        "IN_PROGRESS",
        "https://github.com/org/repo/pull/124",
        recentDate
      );

      const message1 = TestHelpers.createMockChatMessage("msg-1", "task-1", [oldArtifact], oldDate);
      const message2 = TestHelpers.createMockChatMessage("msg-2", "task-1", [recentArtifact], recentDate);

      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message1, message2]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(false); // Latest PR (recentArtifact) is IN_PROGRESS
    });

    test("should log message when PR dependency not satisfied", async () => {
      const artifact = TestHelpers.createMockPRArtifact(
        "art-1",
        "msg-1",
        "IN_PROGRESS",
        "https://github.com/org/repo/pull/123"
      );
      const message = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      await areDependenciesSatisfied(["task-1"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "[TaskCoordinator] Dependency task-1 not satisfied - has PR artifact (https://github.com/org/repo/pull/123), latest status: IN_PROGRESS"
      );
    });

    test("should handle PR artifact with missing URL in log", async () => {
      const artifact = TestHelpers.createMockPRArtifact("art-1", "msg-1", "IN_PROGRESS", "");
      artifact.content = { status: "IN_PROGRESS" }; // No URL
      const message = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      await areDependenciesSatisfied(["task-1"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("has PR artifact (unknown)")
      );
    });

    test("should handle PR artifact with missing status in log", async () => {
      const artifact = TestHelpers.createMockPRArtifact("art-1", "msg-1", "IN_PROGRESS");
      artifact.content = { url: "https://github.com/org/repo/pull/123" }; // No status
      const message = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      await areDependenciesSatisfied(["task-1"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("latest status: unknown")
      );
    });
  });

  describe("Multiple Dependencies", () => {
    test("should return true when all dependencies satisfied without PR", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "DONE", []);
      const task2 = TestHelpers.createMockTask("task-2", "DONE", []);
      const task3 = TestHelpers.createMockTask("task-3", "DONE", []);
      TestHelpers.setupMockTasksInDatabase([task1, task2, task3]);

      const result = await areDependenciesSatisfied(["task-1", "task-2", "task-3"]);

      expect(result).toBe(true);
    });

    test("should return true when all dependencies satisfied with PR", async () => {
      const artifact1 = TestHelpers.createMockPRArtifact("art-1", "msg-1", "DONE");
      const message1 = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact1]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message1]);

      const artifact2 = TestHelpers.createMockPRArtifact("art-2", "msg-2", "DONE");
      const message2 = TestHelpers.createMockChatMessage("msg-2", "task-2", [artifact2]);
      const task2 = TestHelpers.createMockTask("task-2", "IN_PROGRESS", [message2]);

      TestHelpers.setupMockTasksInDatabase([task1, task2]);

      const result = await areDependenciesSatisfied(["task-1", "task-2"]);

      expect(result).toBe(true);
    });

    test("should return false when first dependency not satisfied", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "TODO", []);
      const task2 = TestHelpers.createMockTask("task-2", "DONE", []);
      TestHelpers.setupMockTasksInDatabase([task1, task2]);

      const result = await areDependenciesSatisfied(["task-1", "task-2"]);

      expect(result).toBe(false);
    });

    test("should return false when middle dependency not satisfied", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "DONE", []);
      const task2 = TestHelpers.createMockTask("task-2", "TODO", []);
      const task3 = TestHelpers.createMockTask("task-3", "DONE", []);
      TestHelpers.setupMockTasksInDatabase([task1, task2, task3]);

      const result = await areDependenciesSatisfied(["task-1", "task-2", "task-3"]);

      expect(result).toBe(false);
    });

    test("should return false when last dependency not satisfied", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "DONE", []);
      const task2 = TestHelpers.createMockTask("task-2", "TODO", []);
      TestHelpers.setupMockTasksInDatabase([task1, task2]);

      const result = await areDependenciesSatisfied(["task-1", "task-2"]);

      expect(result).toBe(false);
    });

    test("should handle mixed PR and non-PR dependencies all satisfied", async () => {
      const artifact1 = TestHelpers.createMockPRArtifact("art-1", "msg-1", "DONE");
      const message1 = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact1]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message1]); // Has PR

      const task2 = TestHelpers.createMockTask("task-2", "DONE", []); // No PR, manual DONE

      TestHelpers.setupMockTasksInDatabase([task1, task2]);

      const result = await areDependenciesSatisfied(["task-1", "task-2"]);

      expect(result).toBe(true);
    });

    test("should handle mixed PR and non-PR dependencies with PR not satisfied", async () => {
      const artifact1 = TestHelpers.createMockPRArtifact("art-1", "msg-1", "IN_PROGRESS");
      const message1 = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact1]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message1]); // PR IN_PROGRESS

      const task2 = TestHelpers.createMockTask("task-2", "DONE", []); // Manual DONE

      TestHelpers.setupMockTasksInDatabase([task1, task2]);

      const result = await areDependenciesSatisfied(["task-1", "task-2"]);

      expect(result).toBe(false);
    });

    test("should handle mixed PR and non-PR dependencies with manual not satisfied", async () => {
      const artifact1 = TestHelpers.createMockPRArtifact("art-1", "msg-1", "DONE");
      const message1 = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact1]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message1]); // PR DONE

      const task2 = TestHelpers.createMockTask("task-2", "TODO", []); // Manual TODO

      TestHelpers.setupMockTasksInDatabase([task1, task2]);

      const result = await areDependenciesSatisfied(["task-1", "task-2"]);

      expect(result).toBe(false);
    });

    test("should stop checking after first unsatisfied dependency", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "TODO", []);
      const task2 = TestHelpers.createMockTask("task-2", "DONE", []);
      const task3 = TestHelpers.createMockTask("task-3", "DONE", []);
      TestHelpers.setupMockTasksInDatabase([task1, task2, task3]);

      await areDependenciesSatisfied(["task-1", "task-2", "task-3"]);

      // Only first dependency's log should appear
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Dependency task-1 not satisfied")
      );
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Dependency task-2")
      );
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Dependency task-3")
      );
    });
  });

  describe("Circular Dependencies", () => {
    test("should return false when circular dependency detected via missing tasks", async () => {
      // Circular reference: task-1 depends on task-2, task-2 depends on task-1
      // When checking task-1's dependencies, task-2 might not be found
      TestHelpers.setupMockTasksInDatabase([]);

      const result = await areDependenciesSatisfied(["task-1", "task-2"]);

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Expected 2 dependencies, found 0")
      );
    });

    test("should handle self-referencing dependency", async () => {
      // Task depends on itself - will fail due to missing dependency
      TestHelpers.setupMockTasksInDatabase([]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    test("should handle task with empty chatMessages array", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "DONE", []);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(true);
    });

    test("should handle task with chatMessages but no artifacts", async () => {
      const message = TestHelpers.createMockChatMessage("msg-1", "task-1", []);
      const task1 = TestHelpers.createMockTask("task-1", "DONE", [message]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(true);
    });

    test("should handle multiple messages with no PR artifacts", async () => {
      const message1 = TestHelpers.createMockChatMessage("msg-1", "task-1", []);
      const message2 = TestHelpers.createMockChatMessage("msg-2", "task-1", []);
      const task1 = TestHelpers.createMockTask("task-1", "DONE", [message1, message2]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(true);
    });

    test("should handle PR artifact with empty content object", async () => {
      const artifact = TestHelpers.createMockPRArtifact("art-1", "msg-1", "DONE");
      artifact.content = {}; // Empty content
      const message = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      // content.status is undefined, not "DONE", so dependency not satisfied
      expect(result).toBe(false);
    });

    test("should handle PR artifact with null content", async () => {
      const artifact = TestHelpers.createMockPRArtifact("art-1", "msg-1", "DONE");
      artifact.content = null as any;
      const message = TestHelpers.createMockChatMessage("msg-1", "task-1", [artifact]);
      const task1 = TestHelpers.createMockTask("task-1", "IN_PROGRESS", [message]);
      TestHelpers.setupMockTasksInDatabase([task1]);

      const result = await areDependenciesSatisfied(["task-1"]);

      expect(result).toBe(false);
    });

    test("should handle many dependencies efficiently", async () => {
      const tasks = Array.from({ length: 50 }, (_, i) =>
        TestHelpers.createMockTask(`task-${i}`, "DONE", [])
      );
      const taskIds = tasks.map((t) => t.id);
      TestHelpers.setupMockTasksInDatabase(tasks);

      const result = await areDependenciesSatisfied(taskIds);

      expect(result).toBe(true);
      expect(mockDb.task.findMany).toHaveBeenCalledTimes(1); // Single batch query
    });

    test("should handle duplicate dependency IDs", async () => {
      const task1 = TestHelpers.createMockTask("task-1", "DONE", []);
      TestHelpers.setupMockTasksInDatabase([task1, task1]); // Duplicate in response

      const result = await areDependenciesSatisfied(["task-1", "task-1"]);

      // Should warn about mismatch (expects 2, found 1 unique)
      // This tests defensive behavior against unexpected data
      expect(result).toBe(true); // Both references to same task, which is DONE
    });
  });

  describe("Database Query Structure", () => {
    test("should include chatMessages with artifacts in query", async () => {
      TestHelpers.setupMockTasksInDatabase([]);

      await areDependenciesSatisfied(["task-1"]);

      expect(mockDb.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            chatMessages: expect.objectContaining({
              include: expect.objectContaining({
                artifacts: expect.objectContaining({
                  where: {
                    type: "PULL_REQUEST",
                  },
                }),
              }),
            }),
          }),
        })
      );
    });

    test("should order chatMessages by createdAt desc", async () => {
      TestHelpers.setupMockTasksInDatabase([]);

      await areDependenciesSatisfied(["task-1"]);

      expect(mockDb.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            chatMessages: expect.objectContaining({
              orderBy: {
                createdAt: "desc",
              },
            }),
          }),
        })
      );
    });

    test("should filter artifacts to only PULL_REQUEST type", async () => {
      TestHelpers.setupMockTasksInDatabase([]);

      await areDependenciesSatisfied(["task-1"]);

      expect(mockDb.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            chatMessages: expect.objectContaining({
              include: expect.objectContaining({
                artifacts: expect.objectContaining({
                  where: {
                    type: "PULL_REQUEST",
                  },
                }),
              }),
            }),
          }),
        })
      );
    });
  });
});