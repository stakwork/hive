import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { buildFeatureContext } from "@/services/task-coordinator";
import { TaskStatus, WorkflowStatus } from "@prisma/client";
import {
  createMockUser,
  createMockTask,
  createMockWorkspace,
  createMockChatMessage,
  createMockStakworkResponse,
  setupTaskWorkflowMocks,
} from "@/__tests__/support/fixtures/task-workflow-mocks";

// Mock all external dependencies - must be called before imports
vi.mock("@/lib/db", () => ({
  db: {
    chatMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    task: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-key",
    STAKWORK_BASE_URL: "https://stakwork.example.com",
    STAKWORK_WORKFLOW_ID: "123,456,789",
  },
}));
vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));
vi.mock("@/lib/auth/nextauth");
vi.mock("@/services/task-coordinator");

// Import the service after mocks are set up
const { createChatMessageAndTriggerStakwork } = await import(
  "@/services/task-workflow"
);

// Import db to get the mock
const { db: mockDb } = await import("@/lib/db");

describe("createChatMessageAndTriggerStakwork", () => {
  let mocks: ReturnType<typeof setupTaskWorkflowMocks>;
  let mockFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a proper mock for fetch that returns a Response-like object
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    mocks = setupTaskWorkflowMocks({
      mockDb: mockDb,
      mockFetch: mockFetch,
    });

    // Setup user mock
    mockDb.user.findUnique = vi.fn().mockResolvedValue(createMockUser());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Happy Path", () => {
    it("should create chat message and trigger Stakwork workflow successfully", async () => {
      // Arrange
      const task = createMockTask();
      const user = createMockUser();
      const message = "Implement user authentication";
      const chatMessage = createMockChatMessage({
        taskId: task.id,
        message,
        role: "USER",
        status: "SENT",
      });

      mockDb.task.findUnique = vi.fn()
        .mockResolvedValueOnce(task) // For fetching task
        .mockResolvedValueOnce({ status: TaskStatus.TODO }); // For status check before update
      
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(chatMessage);
      mockDb.task.update = vi.fn().mockResolvedValue({});
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        pat: "github_pat_test123",
      });
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      });

      // Act
      const result = await createChatMessageAndTriggerStakwork({
        taskId: task.id,
        userId: user.id,
        message,
        mode: "unit",
      });

      // Assert
      expect(result).toEqual({
        chatMessage: expect.any(Object),
        stakworkData: expect.objectContaining({
          success: true,
          data: expect.objectContaining({ project_id: 12345 }),
        }),
      });
      
      expect(mockDb.chatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: task.id,
          message,
          role: "USER",
          status: "SENT",
        }),
        include: expect.any(Object),
      });

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: task.id },
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 12345,
          status: TaskStatus.IN_PROGRESS,
        }),
      });
    });

    it("should serialize contextTags as JSON string", async () => {
      // Arrange
      const task = createMockTask();
      const contextTags = [
        { type: "file", path: "/src/auth.ts" },
        { type: "function", name: "login" },
      ];

      mockDb.task.findUnique = vi.fn().mockResolvedValue(task);
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        pat: "github_pat_test123",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      // Act
      await createChatMessageAndTriggerStakwork({
        taskId: task.id,
        userId: "user-123",
        message: "Test message",
        contextTags,
        mode: "unit",
      });

      // Assert
      expect(mockDb.chatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contextTags: JSON.stringify(contextTags),
        }),
        include: expect.any(Object),
      });
    });
  });

  describe("Task Not Found", () => {
    it("should throw error when task is not found", async () => {
      // Arrange
      mockDb.task.findUnique = vi.fn().mockResolvedValue(null);

      // Act & Assert
      await expect(
        createChatMessageAndTriggerStakwork({
          taskId: "non-existent-task",
          userId: "user-123",
          message: "Test",
          mode: "unit",
        })
      ).rejects.toThrow("Task not found");
    });
  });

  describe("User Not Found", () => {
    it("should throw error when user is not found", async () => {
      // Arrange
      const task = createMockTask();
      mockDb.task.findUnique = vi.fn().mockResolvedValue(task);
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
      mockDb.user.findUnique = vi.fn().mockResolvedValue(null);

      // Act & Assert
      await expect(
        createChatMessageAndTriggerStakwork({
          taskId: task.id,
          userId: "non-existent-user",
          message: "Test",
          mode: "unit",
        })
      ).rejects.toThrow("User not found");
    });
  });

  describe("GitHub Credentials", () => {
    it("should fetch GitHub credentials for the user", async () => {
      // Arrange
      const task = createMockTask();

      mockDb.task.findUnique = vi.fn().mockResolvedValue(task);
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        pat: "github_pat_test123",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      // Act
      await createChatMessageAndTriggerStakwork({
        taskId: task.id,
        userId: "user-123",
        message: "Test",
        mode: "unit",
      });

      // Assert
      expect(getGithubUsernameAndPAT).toHaveBeenCalledWith(
        "user-123",
        task.workspace.slug
      );
    });
  });

  describe("Stakwork API Integration", () => {
    it("should call Stakwork API with correct parameters", async () => {
      // Arrange
      const task = createMockTask();

      mockDb.task.findUnique = vi.fn().mockResolvedValue(task);
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        pat: "github_pat_test123",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      });

      // Act
      await createChatMessageAndTriggerStakwork({
        taskId: task.id,
        userId: "user-123",
        message: "Implement feature X",
        mode: "live",
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/projects"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Token token="),
            "Content-Type": "application/json",
          }),
          body: expect.any(String),
        })
      );

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.workflow_id).toBeDefined();
      expect(body.webhook_url).toContain("/api/stakwork/webhook");
    });

    it("should select correct workflow ID based on mode", async () => {
      // Arrange
      const task = createMockTask();

      mockDb.task.findUnique = vi.fn().mockResolvedValue(task);
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        pat: "github_pat_test123",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      // Act - Test each mode
      for (const mode of ["live", "unit", "integration"] as const) {
        vi.clearAllMocks();
        mockDb.task.findUnique = vi.fn().mockResolvedValue(task);
        mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
        
        await createChatMessageAndTriggerStakwork({
          taskId: task.id,
          userId: "user-123",
          message: "Test",
          mode,
        });

        // Assert
        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.workflow_id).toBeDefined();
        
        if (mode === "live") {
          expect(body.workflow_id).toBe(123); // First ID
        } else if (mode === "unit" || mode === "integration") {
          expect(body.workflow_id).toBe(789); // Third ID
        }
      }
    });
  });

  describe("Task Status Updates", () => {
    it("should update task status to IN_PROGRESS on successful trigger", async () => {
      // Arrange
      const task = createMockTask();
      const stakworkProjectId = 12345;

      mockDb.task.findUnique = vi.fn()
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce({ status: TaskStatus.TODO });
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
      mockDb.task.update = vi.fn().mockResolvedValue({});
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        pat: "github_pat_test123",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: stakworkProjectId } }),
      });

      // Act
      await createChatMessageAndTriggerStakwork({
        taskId: task.id,
        userId: "user-123",
        message: "Test",
        mode: "unit",
      });

      // Assert
      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: task.id },
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          stakworkProjectId,
          workflowStartedAt: expect.any(Date),
          status: TaskStatus.IN_PROGRESS,
        }),
      });
    });

    it("should set workflowStatus to FAILED on API error", async () => {
      // Arrange
      const task = createMockTask();

      mockDb.task.findUnique = vi.fn().mockResolvedValue(task);
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
      mockDb.task.update = vi.fn().mockResolvedValue({});
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        pat: "github_pat_test123",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: "API error" }),
      });

      // Act
      await createChatMessageAndTriggerStakwork({
        taskId: task.id,
        userId: "user-123",
        message: "Test",
        mode: "unit",
      });

      // Assert
      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: task.id },
        data: { workflowStatus: WorkflowStatus.FAILED },
      });
    });

    it("should not change task status if already IN_PROGRESS", async () => {
      // Arrange
      const task = createMockTask();

      mockDb.task.findUnique = vi.fn()
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce({ status: TaskStatus.IN_PROGRESS });
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
      mockDb.task.update = vi.fn().mockResolvedValue({});
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        pat: "github_pat_test123",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      // Act
      await createChatMessageAndTriggerStakwork({
        taskId: task.id,
        userId: "user-123",
        message: "Test",
        mode: "unit",
      });

      // Assert
      const updateCall = mockDb.task.update.mock.calls[0];
      expect(updateCall[0].data.status).toBeUndefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle network failures gracefully", async () => {
      // Arrange
      const task = createMockTask();

      mockDb.task.findUnique = vi.fn().mockResolvedValue(task);
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
      mockDb.task.update = vi.fn().mockResolvedValue({});
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        pat: "github_pat_test123",
      });
      mockFetch.mockRejectedValue(new Error("Network error"));

      // Act
      const result = await createChatMessageAndTriggerStakwork({
        taskId: task.id,
        userId: "user-123",
        message: "Test",
        mode: "unit",
      });

      // Assert
      expect(result.stakworkData).toEqual({
        success: false,
        error: "Error: Network error",
      });
      
      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: task.id },
        data: { workflowStatus: WorkflowStatus.FAILED },
      });
    });

    it("should handle Stakwork API HTTP errors", async () => {
      // Arrange
      const task = createMockTask();

      mockDb.task.findUnique = vi.fn().mockResolvedValue(task);
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
      mockDb.task.update = vi.fn().mockResolvedValue({});
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        pat: "github_pat_test123",
      });
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Bad Request",
      });

      // Act
      const result = await createChatMessageAndTriggerStakwork({
        taskId: task.id,
        userId: "user-123",
        message: "Test",
        mode: "unit",
      });

      // Assert
      expect(result.stakworkData).toEqual({
        success: false,
        error: "Bad Request",
      });
    });
  });

  describe("Feature Context Integration", () => {
    it("should include feature context in Stakwork API call when provided", async () => {
      // Arrange
      const task = createMockTask();
      const featureContext = {
        phase: "DEVELOPMENT",
        feature: "Payment Integration",
        requirements: "Implement Stripe checkout",
      };

      mockDb.task.findUnique = vi.fn().mockResolvedValue(task);
      mockDb.chatMessage.create = vi.fn().mockResolvedValue(createMockChatMessage());
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        pat: "github_pat_test123",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      // Act
      await createChatMessageAndTriggerStakwork({
        taskId: task.id,
        userId: "user-123",
        message: "Implement payment flow",
        featureContext,
        mode: "unit",
      });

      // Assert - Feature context should be included in the Stakwork API call
      expect(mockFetch).toHaveBeenCalled();
      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.workflow_params.set_var.attributes.vars.featureContext).toEqual(featureContext);
    });
  });
});
