import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { sendMessageToStakwork } from "@/services/task-workflow";
import { db } from "@/lib/db";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock environment variables
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: null, // Disable Stakwork integration for tests
    STAKWORK_BASE_URL: null,
    STAKWORK_WORKFLOW_ID: null,
  },
}));

// Mock the auth module
vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue({ username: "testuser", token: "token123" }),
}));

// Mock utils
vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn().mockReturnValue("https://example.com"),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe("sendMessageToStakwork", () => {
  const mockDbTask = db.task as { findFirst: Mock; create: Mock; update: Mock };
  const mockDbChatMessage = db.chatMessage as { create: Mock };
  const mockDbUser = db.user as { findUnique: Mock };
  const mockFetch = fetch as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  const createMockTask = (overrides = {}) => ({
    id: "test-task-id",
    title: "Test Task",
    description: "Test task description",
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    workspaceId: "test-workspace-id",
    createdById: "test-user-id",
    updatedById: "test-user-id",
    deleted: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    workspace: {
      id: "test-workspace-id",
      name: "Test Workspace",
      slug: "test-workspace",
      ownerId: "test-owner-id",
      swarm: {
        id: "test-swarm-id",
        swarmUrl: "https://swarm.example.com/api",
        swarmSecretAlias: "test-secret-alias",
        poolName: "test-pool",
        name: "test-swarm",
      },
    },
    ...overrides,
  });

  const createMockChatMessage = () => ({
    id: "test-message-id",
    taskId: "test-task-id",
    message: "Test message",
    role: "USER",
    status: "SENT",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    task: {
      id: "test-task-id",
      title: "Test Task",
    },
  });

  const createMockUser = () => ({
    id: "test-user-id",
    name: "Test User",
  });

  describe("successful scenarios", () => {
    test("should successfully process message when task exists", async () => {
      // Arrange
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage();
      const mockUser = createMockUser();
      const testParams = {
        taskId: "test-task-id",
        message: "Hello, this is a test message",
        userId: "test-user-id",
        contextTags: [{ type: "file", value: "test.js" }],
        attachments: ["attachment1.pdf"],
      };

      mockDbTask.findFirst.mockResolvedValue(mockTask);
      mockDbChatMessage.create.mockResolvedValue(mockChatMessage);
      mockDbUser.findUnique.mockResolvedValue(mockUser);

      // Act
      const result = await sendMessageToStakwork(testParams);

      // Assert
      expect(mockDbTask.findFirst).toHaveBeenCalledWith({
        where: {
          id: "test-task-id",
          deleted: false,
        },
        include: {
          workspace: {
            include: {
              swarm: {
                select: {
                  swarmUrl: true,
                  swarmSecretAlias: true,
                  poolName: true,
                  name: true,
                  id: true,
                },
              },
            },
          },
        },
      });

      expect(mockDbChatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: "test-task-id",
          message: "Hello, this is a test message",
          role: "USER",
          contextTags: JSON.stringify([{ type: "file", value: "test.js" }]),
          status: "SENT",
        },
        include: {
          task: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });

      expect(result).toHaveProperty("chatMessage", mockChatMessage);
      expect(result).toHaveProperty("stakworkData", null); // Stakwork is disabled in tests
    });

    test("should handle minimal required parameters", async () => {
      // Arrange
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage();
      const mockUser = createMockUser();
      const testParams = {
        taskId: "test-task-id",
        message: "Minimal message",
        userId: "test-user-id",
      };

      mockDbTask.findFirst.mockResolvedValue(mockTask);
      mockDbChatMessage.create.mockResolvedValue(mockChatMessage);
      mockDbUser.findUnique.mockResolvedValue(mockUser);

      // Act
      const result = await sendMessageToStakwork(testParams);

      // Assert
      expect(mockDbChatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: "test-task-id",
          message: "Minimal message",
          role: "USER",
          contextTags: JSON.stringify([]),
          status: "SENT",
        },
        include: {
          task: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });

      expect(result).toHaveProperty("chatMessage", mockChatMessage);
    });

    test("should handle empty contextTags and attachments arrays", async () => {
      // Arrange
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage();
      const mockUser = createMockUser();
      const testParams = {
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
        contextTags: [],
        attachments: [],
      };

      mockDbTask.findFirst.mockResolvedValue(mockTask);
      mockDbChatMessage.create.mockResolvedValue(mockChatMessage);
      mockDbUser.findUnique.mockResolvedValue(mockUser);

      // Act
      const result = await sendMessageToStakwork(testParams);

      // Assert
      expect(mockDbChatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: "test-task-id",
          message: "Test message",
          role: "USER",
          contextTags: JSON.stringify([]),
          status: "SENT",
        },
        include: {
          task: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });

      expect(result).toHaveProperty("chatMessage", mockChatMessage);
    });

    test("should handle task without swarm data", async () => {
      // Arrange
      const mockTask = createMockTask({
        workspace: {
          id: "test-workspace-id",
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: "test-owner-id",
          swarm: null,
        },
      });
      const mockChatMessage = createMockChatMessage();
      const mockUser = createMockUser();
      const testParams = {
        taskId: "test-task-id",
        message: "No swarm test",
        userId: "test-user-id",
      };

      mockDbTask.findFirst.mockResolvedValue(mockTask);
      mockDbChatMessage.create.mockResolvedValue(mockChatMessage);
      mockDbUser.findUnique.mockResolvedValue(mockUser);

      // Act
      const result = await sendMessageToStakwork(testParams);

      // Assert
      expect(result).toHaveProperty("chatMessage", mockChatMessage);
    });
  });

  describe("error scenarios", () => {
    test("should throw error when task is not found", async () => {
      // Arrange
      const testParams = {
        taskId: "non-existent-task-id",
        message: "Test message",
        userId: "test-user-id",
      };

      mockDbTask.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(sendMessageToStakwork(testParams)).rejects.toThrow("Task not found");

      expect(mockDbTask.findFirst).toHaveBeenCalledWith({
        where: {
          id: "non-existent-task-id",
          deleted: false,
        },
        include: {
          workspace: {
            include: {
              swarm: {
                select: {
                  swarmUrl: true,
                  swarmSecretAlias: true,
                  poolName: true,
                  name: true,
                  id: true,
                },
              },
            },
          },
        },
      });

      expect(mockDbChatMessage.create).not.toHaveBeenCalled();
    });

    test("should throw error when user is not found", async () => {
      // Arrange
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage();
      const testParams = {
        taskId: "test-task-id",
        message: "Test message",
        userId: "non-existent-user-id",
      };

      mockDbTask.findFirst.mockResolvedValue(mockTask);
      mockDbChatMessage.create.mockResolvedValue(mockChatMessage);
      mockDbUser.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(sendMessageToStakwork(testParams)).rejects.toThrow("User not found");

      expect(mockDbUser.findUnique).toHaveBeenCalledWith({
        where: { id: "non-existent-user-id" },
        select: {
          name: true,
        },
      });
    });

    test("should propagate database connection errors", async () => {
      // Arrange
      const testParams = {
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      };
      const dbError = new Error("Database connection failed");

      mockDbTask.findFirst.mockRejectedValue(dbError);

      // Act & Assert
      await expect(sendMessageToStakwork(testParams)).rejects.toThrow("Database connection failed");
    });
  });

  describe("parameter validation", () => {
    test("should handle different taskId formats", async () => {
      // Arrange
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage();
      const mockUser = createMockUser();
      const testCases = [
        "uuid-format-task-id",
        "short-id",
        "very-long-task-id-with-multiple-dashes-and-characters",
        "123456789",
      ];

      for (const taskId of testCases) {
        mockDbTask.findFirst.mockResolvedValue({ ...mockTask, id: taskId });
        mockDbChatMessage.create.mockResolvedValue({ ...mockChatMessage, taskId });
        mockDbUser.findUnique.mockResolvedValue(mockUser);

        const testParams = {
          taskId,
          message: "Test message",
          userId: "test-user-id",
        };

        // Act
        const result = await sendMessageToStakwork(testParams);

        // Assert
        expect(mockDbTask.findFirst).toHaveBeenCalledWith({
          where: {
            id: taskId,
            deleted: false,
          },
          include: {
            workspace: {
              include: {
                swarm: {
                  select: {
                    swarmUrl: true,
                    swarmSecretAlias: true,
                    poolName: true,
                    name: true,
                    id: true,
                  },
                },
              },
            },
          },
        });

        expect(result).toHaveProperty("chatMessage");

        // Clear mocks for next iteration
        vi.clearAllMocks();
      }
    });

    test("should handle different message content types", async () => {
      // Arrange
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage();
      const mockUser = createMockUser();
      const testMessages = [
        "Simple message",
        "Message with special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?",
        "Multi-line\nmessage\nwith\nbreaks",
        "Message with émojis 🚀 and ünicode çharacters",
        "Very long message that exceeds normal length limits and contains lots of detailed information that might be typical in a development workflow context",
        "",
      ];

      for (const message of testMessages) {
        mockDbTask.findFirst.mockResolvedValue(mockTask);
        mockDbChatMessage.create.mockResolvedValue({ ...mockChatMessage, message });
        mockDbUser.findUnique.mockResolvedValue(mockUser);

        const testParams = {
          taskId: "test-task-id",
          message,
          userId: "test-user-id",
        };

        // Act
        const result = await sendMessageToStakwork(testParams);

        // Assert
        expect(mockDbChatMessage.create).toHaveBeenCalledWith({
          data: {
            taskId: "test-task-id",
            message,
            role: "USER",
            contextTags: JSON.stringify([]),
            status: "SENT",
          },
          include: {
            task: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        });

        expect(result).toHaveProperty("chatMessage");

        // Clear mocks for next iteration
        vi.clearAllMocks();
      }
    });

    test("should handle various contextTags structures", async () => {
      // Arrange
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage();
      const mockUser = createMockUser();
      const testContextTagCases = [
        [],
        [{ type: "file", value: "test.js" }],
        [
          { type: "file", value: "file1.ts" },
          { type: "directory", value: "src/components" },
          { type: "function", value: "processData" },
        ],
        [{ type: "custom", value: "custom-value", metadata: { extra: "data" } }],
        [{ unknownProperty: "test" }], // Test handling of unexpected structure
      ];

      for (const contextTags of testContextTagCases) {
        mockDbTask.findFirst.mockResolvedValue(mockTask);
        mockDbChatMessage.create.mockResolvedValue(mockChatMessage);
        mockDbUser.findUnique.mockResolvedValue(mockUser);

        const testParams = {
          taskId: "test-task-id",
          message: "Test message",
          userId: "test-user-id",
          contextTags,
        };

        // Act
        const result = await sendMessageToStakwork(testParams);

        // Assert
        expect(mockDbChatMessage.create).toHaveBeenCalledWith({
          data: {
            taskId: "test-task-id",
            message: "Test message",
            role: "USER",
            contextTags: JSON.stringify(contextTags),
            status: "SENT",
          },
          include: {
            task: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        });

        expect(result).toHaveProperty("chatMessage");

        // Clear mocks for next iteration
        vi.clearAllMocks();
      }
    });
  });

  describe("edge cases", () => {
    test("should handle task with partial workspace data", async () => {
      // Arrange
      const mockTask = createMockTask({
        workspace: {
          id: "test-workspace-id",
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: "test-owner-id",
          swarm: {
            id: "test-swarm-id",
            swarmUrl: null, // Null URL
            swarmSecretAlias: null, // Null alias
            poolName: "", // Empty pool name
            name: "minimal-swarm",
          },
        },
      });
      const mockChatMessage = createMockChatMessage();
      const mockUser = createMockUser();
      const testParams = {
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      };

      mockDbTask.findFirst.mockResolvedValue(mockTask);
      mockDbChatMessage.create.mockResolvedValue(mockChatMessage);
      mockDbUser.findUnique.mockResolvedValue(mockUser);

      // Act
      const result = await sendMessageToStakwork(testParams);

      // Assert
      expect(result).toHaveProperty("chatMessage", mockChatMessage);
    });

    test("should handle database timeout gracefully", async () => {
      // Arrange
      const testParams = {
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      };
      const timeoutError = new Error("Query timeout");
      timeoutError.name = "QueryTimeout";

      mockDbTask.findFirst.mockRejectedValue(timeoutError);

      // Act & Assert
      await expect(sendMessageToStakwork(testParams)).rejects.toThrow("Query timeout");
    });
  });
});
