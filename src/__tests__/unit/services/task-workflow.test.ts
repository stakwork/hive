import { describe, test, expect, vi, beforeEach } from "vitest";
import { createTaskWithStakworkWorkflow } from "@/services/task-workflow";
import { db } from "@/lib/db";
import { config } from "@/lib/env";
import { getBaseUrl } from "@/lib/utils";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

// Mock all dependencies
vi.mock("@/lib/db");
vi.mock("@/lib/utils");
vi.mock("@/lib/auth/nextauth");

const mockedDb = vi.mocked(db);
const mockedGetBaseUrl = vi.mocked(getBaseUrl);
const mockedGetGithubUsernameAndPAT = vi.mocked(getGithubUsernameAndPAT);

// Mock global fetch
global.fetch = vi.fn();
const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

describe("createTaskWithStakworkWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock implementations
    Object.assign(db, {
      task: {
        create: vi.fn(),
        update: vi.fn(),
      },
      chatMessage: {
        create: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
    });

    // Mock utility functions with defaults
    mockedGetBaseUrl.mockReturnValue("http://localhost:3000");
    mockedGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "github_pat_test_token",
    });

    // Mock Stakwork config
    vi.mocked(config).STAKWORK_API_KEY = "test-stakwork-key";
    vi.mocked(config).STAKWORK_BASE_URL = "https://api.stakwork.com/api/v1";
    vi.mocked(config).STAKWORK_WORKFLOW_ID = "111,222,333"; // live, test, unit/integration
  });

  describe("Successful Task Creation", () => {
    test("should create task with minimal required parameters", async () => {
      const mockTask = {
        id: generateUniqueId("task"),
        title: "Test Task",
        description: "Test description",
        workspaceId: "workspace-1",
        status: "TODO",
        priority: "MEDIUM",
        sourceType: "USER",
        createdById: "user-1",
        updatedById: "user-1",
        assigneeId: null,
        repositoryId: null,
        workspace: {
          id: "workspace-1",
          name: "Test Workspace",
          slug: "test-workspace",
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-1",
          },
        },
        assignee: null,
        repository: null,
        createdBy: {
          id: "user-1",
          name: "Test User",
          email: "test@example.com",
          image: null,
          githubAuth: null,
        },
      };

      const mockChatMessage = {
        id: generateUniqueId("message"),
        taskId: mockTask.id,
        message: "Initial message",
        role: "USER",
        contextTags: "[]",
        status: "SENT",
        task: {
          id: mockTask.id,
          title: mockTask.title,
        },
      };

      const mockUser = {
        id: "user-1",
        name: "Test User",
      };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      // Mock successful Stakwork API call
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            project_id: 12345,
            workflow_id: 67890,
            status: "queued",
          },
        }),
      } as Response);

      const result = await createTaskWithStakworkWorkflow({
        title: "Test Task",
        description: "Test description",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "MEDIUM",
        initialMessage: "Initial message",
      });

      // Verify task creation
      expect(db.task.create).toHaveBeenCalledWith({
        data: {
          title: "Test Task",
          description: "Test description",
          workspaceId: "workspace-1",
          status: "TODO",
          priority: "MEDIUM",
          assigneeId: null,
          repositoryId: null,
          sourceType: "USER",
          createdById: "user-1",
          updatedById: "user-1",
        },
        include: expect.objectContaining({
          assignee: expect.any(Object),
          repository: expect.any(Object),
          createdBy: expect.any(Object),
          workspace: expect.any(Object),
        }),
      });

      // Verify chat message creation
      expect(db.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: mockTask.id,
          message: "Initial message",
          role: "USER",
          contextTags: "[]",
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

      // Verify return structure
      expect(result).toEqual({
        task: mockTask,
        stakworkResult: expect.objectContaining({
          success: true,
          data: {
            project_id: 12345,
            workflow_id: 67890,
            status: "queued",
          },
        }),
        chatMessage: mockChatMessage,
      });
    });

    test("should create task with all optional parameters", async () => {
      const mockTask = {
        id: generateUniqueId("task"),
        title: "Test Task",
        description: "Test description",
        workspaceId: "workspace-1",
        status: "TODO",
        priority: "HIGH",
        sourceType: "JANITOR",
        createdById: "user-1",
        updatedById: "user-1",
        assigneeId: "assignee-1",
        repositoryId: "repo-1",
        workspace: {
          id: "workspace-1",
          name: "Test Workspace",
          slug: "test-workspace",
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-1",
          },
        },
        assignee: {
          id: "assignee-1",
          name: "Assignee User",
          email: "assignee@example.com",
        },
        repository: {
          id: "repo-1",
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
        },
        createdBy: {
          id: "user-1",
          name: "Test User",
          email: "test@example.com",
          image: null,
          githubAuth: {
            githubUsername: "testuser",
          },
        },
      };

      const mockChatMessage = {
        id: generateUniqueId("message"),
        taskId: mockTask.id,
        message: "Initial message with all params",
        role: "USER",
        contextTags: "[]",
        status: "SENT",
        task: {
          id: mockTask.id,
          title: mockTask.title,
        },
      };

      const mockUser = {
        id: "user-1",
        name: "Test User",
      };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { project_id: 12345 },
        }),
      } as Response);

      const result = await createTaskWithStakworkWorkflow({
        title: "Test Task",
        description: "Test description",
        workspaceId: "workspace-1",
        assigneeId: "assignee-1",
        repositoryId: "repo-1",
        priority: "HIGH",
        sourceType: "JANITOR",
        userId: "user-1",
        initialMessage: "Initial message with all params",
        status: "TODO",
        mode: "live",
      });

      // Verify task creation with all optional parameters
      expect(db.task.create).toHaveBeenCalledWith({
        data: {
          title: "Test Task",
          description: "Test description",
          workspaceId: "workspace-1",
          status: "TODO",
          priority: "HIGH",
          assigneeId: "assignee-1",
          repositoryId: "repo-1",
          sourceType: "JANITOR",
          createdById: "user-1",
          updatedById: "user-1",
        },
        include: expect.any(Object),
      });

      expect(result.task).toEqual(mockTask);
      expect(result.task.assigneeId).toBe("assignee-1");
      expect(result.task.repositoryId).toBe("repo-1");
      expect(result.task.priority).toBe("HIGH");
      expect(result.task.sourceType).toBe("JANITOR");
    });
  });

  describe("Source Type Variations", () => {
    test("should create task with JANITOR source type", async () => {
      const mockTask = createMockTask({ sourceType: "JANITOR" });
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      const result = await createTaskWithStakworkWorkflow({
        title: "Janitor Task",
        description: "Auto-generated task",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "HIGH",
        sourceType: "JANITOR",
        initialMessage: "Janitor recommendation",
        mode: "live",
      });

      expect(result.task.sourceType).toBe("JANITOR");
      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType: "JANITOR",
          }),
        })
      );
    });

    test("should create task with USER source type (default)", async () => {
      const mockTask = createMockTask({ sourceType: "USER" });
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      const result = await createTaskWithStakworkWorkflow({
        title: "User Task",
        description: "Manually created task",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "MEDIUM",
        initialMessage: "User message",
      });

      expect(result.task.sourceType).toBe("USER");
    });

    test("should create task with SYSTEM source type", async () => {
      const mockTask = createMockTask({ sourceType: "SYSTEM" });
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      const result = await createTaskWithStakworkWorkflow({
        title: "System Task",
        description: "System-generated task",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "LOW",
        sourceType: "SYSTEM",
        initialMessage: "System message",
      });

      expect(result.task.sourceType).toBe("SYSTEM");
    });
  });

  describe("Workflow Mode Selection", () => {
    test("should use first workflow ID for live mode", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "Live Mode Task",
        description: "Production workflow",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "HIGH",
        initialMessage: "Live message",
        mode: "live",
      });

      // Verify Stakwork API was called with workflow_id from first position
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.com/api/v1/projects",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"workflow_id":111'),
        })
      );
    });

    test("should use second workflow ID for default/test mode", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "Default Mode Task",
        description: "Test workflow",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "MEDIUM",
        initialMessage: "Default message",
        // mode defaults to "default"
      });

      // Verify Stakwork API was called with workflow_id from second position
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.com/api/v1/projects",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"workflow_id":222'),
        })
      );
    });

    test("should use third workflow ID for unit mode", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "Unit Mode Task",
        description: "Unit test workflow",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "LOW",
        initialMessage: "Unit message",
        mode: "unit",
      });

      // Verify Stakwork API was called with workflow_id from third position
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.com/api/v1/projects",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"workflow_id":333'),
        })
      );
    });

    test("should use third workflow ID for integration mode", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "Integration Mode Task",
        description: "Integration test workflow",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "MEDIUM",
        initialMessage: "Integration message",
        mode: "integration",
      });

      // Verify Stakwork API was called with workflow_id from third position
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.com/api/v1/projects",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"workflow_id":333'),
        })
      );
    });
  });

  describe("Stakwork API Integration", () => {
    test("should handle successful Stakwork API response", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.task.update).mockResolvedValue(mockTask as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            project_id: 12345,
            workflow_id: 67890,
            status: "queued",
          },
        }),
      } as Response);

      const result = await createTaskWithStakworkWorkflow({
        title: "Stakwork Task",
        description: "Task with Stakwork integration",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "HIGH",
        initialMessage: "Stakwork message",
        mode: "live",
      });

      // Verify Stakwork API was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.com/api/v1/projects",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Token token=test-stakwork-key",
            "Content-Type": "application/json",
          },
        })
      );

      // Verify task was updated with workflow status and project ID
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: mockTask.id },
        data: {
          workflowStatus: "IN_PROGRESS",
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 12345,
        },
      });

      // Verify return includes Stakwork result
      expect(result.stakworkResult).toEqual({
        success: true,
        data: {
          project_id: 12345,
          workflow_id: 67890,
          status: "queued",
        },
      });
    });

    test("should handle Stakwork API failure and update task status to FAILED", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.task.update).mockResolvedValue(mockTask as any);

      // Mock failed Stakwork API response
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      const result = await createTaskWithStakworkWorkflow({
        title: "Failed Task",
        description: "Task with Stakwork failure",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "HIGH",
        initialMessage: "Failed message",
        mode: "live",
      });

      // Verify task was updated with FAILED status
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: mockTask.id },
        data: { workflowStatus: "FAILED" },
      });

      // Verify return includes error result
      expect(result.stakworkResult).toEqual({
        success: false,
        error: "Internal Server Error",
      });
    });

    test("should handle Stakwork API network error", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.task.update).mockResolvedValue(mockTask as any);

      // Mock network error
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await createTaskWithStakworkWorkflow({
        title: "Network Error Task",
        description: "Task with network failure",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "HIGH",
        initialMessage: "Network error message",
        mode: "live",
      });

      // Verify task was updated with FAILED status
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: mockTask.id },
        data: { workflowStatus: "FAILED" },
      });

      // Task and chat message should still be created
      expect(result.task).toBeDefined();
      expect(result.chatMessage).toBeDefined();
    });

    test("should skip Stakwork integration when configuration is missing", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      // Remove Stakwork configuration
      vi.mocked(config).STAKWORK_API_KEY = "";
      vi.mocked(config).STAKWORK_BASE_URL = "";

      const result = await createTaskWithStakworkWorkflow({
        title: "No Config Task",
        description: "Task without Stakwork config",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "MEDIUM",
        initialMessage: "No config message",
      });

      // Verify Stakwork API was not called
      expect(mockFetch).not.toHaveBeenCalled();

      // Verify task was still created
      expect(result.task).toBeDefined();
      expect(result.chatMessage).toBeDefined();
      expect(result.stakworkResult).toBeNull();
    });
  });

  describe("GitHub Authentication Integration", () => {
    test("should retrieve GitHub username and PAT for workflow", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      mockedGetGithubUsernameAndPAT.mockResolvedValue({
        username: "githubuser",
        token: "github_pat_12345",
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "GitHub Task",
        description: "Task with GitHub integration",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "HIGH",
        initialMessage: "GitHub message",
        mode: "live",
      });

      // Verify GitHub credentials were retrieved
      expect(getGithubUsernameAndPAT).toHaveBeenCalledWith("user-1", "test-workspace");

      // Verify credentials were included in Stakwork API call
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.workflow_params.set_var.attributes.vars.username).toBe("githubuser");
      expect(body.workflow_params.set_var.attributes.vars.accessToken).toBe("github_pat_12345");
    });

    test("should handle missing GitHub credentials gracefully", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      // Mock null GitHub credentials
      mockedGetGithubUsernameAndPAT.mockResolvedValue(null);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "No GitHub Task",
        description: "Task without GitHub credentials",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "MEDIUM",
        initialMessage: "No GitHub message",
      });

      // Verify workflow proceeds with null credentials
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.workflow_params.set_var.attributes.vars.username).toBeNull();
      expect(body.workflow_params.set_var.attributes.vars.accessToken).toBeNull();
    });
  });

  describe("Error Handling", () => {
    test("should throw error when user not found", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(null);

      await expect(
        createTaskWithStakworkWorkflow({
          title: "No User Task",
          description: "Task with missing user",
          workspaceId: "workspace-1",
          userId: "non-existent-user",
          priority: "MEDIUM",
          initialMessage: "No user message",
        })
      ).rejects.toThrow("User not found");
    });

    test("should handle database task creation failure", async () => {
      vi.mocked(db.task.create).mockRejectedValue(new Error("Database connection error"));

      await expect(
        createTaskWithStakworkWorkflow({
          title: "Failed Task",
          description: "Task with database failure",
          workspaceId: "workspace-1",
          userId: "user-1",
          priority: "HIGH",
          initialMessage: "Failed message",
        })
      ).rejects.toThrow("Database connection error");
    });

    test("should handle chat message creation failure", async () => {
      const mockTask = createMockTask();

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockRejectedValue(
        new Error("Chat message creation failed")
      );

      await expect(
        createTaskWithStakworkWorkflow({
          title: "Chat Fail Task",
          description: "Task with chat message failure",
          workspaceId: "workspace-1",
          userId: "user-1",
          priority: "MEDIUM",
          initialMessage: "Chat fail message",
        })
      ).rejects.toThrow("Chat message creation failed");
    });

    test("should handle missing Stakwork workflow ID configuration", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      // Remove workflow ID configuration - this should skip Stakwork integration
      vi.mocked(config).STAKWORK_WORKFLOW_ID = "";

      const result = await createTaskWithStakworkWorkflow({
        title: "No Workflow ID Task", 
        description: "Task with missing workflow ID",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "HIGH",
        initialMessage: "No workflow ID message",
      });

      // Verify task was created successfully despite missing Stakwork config
      expect(result.task).toBeDefined();
      expect(result.chatMessage).toBeDefined();
      expect(result.stakworkResult).toBeNull();
      
      // Verify Stakwork API was not called
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Return Value Structure", () => {
    test("should return complete structure with task, stakworkResult, and chatMessage", async () => {
      const mockTask = createMockTask();
      const mockChatMessage = createMockChatMessage(mockTask.id);
      const mockUser = { id: "user-1", name: "Test User" };

      vi.mocked(db.task.create).mockResolvedValue(mockTask as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            project_id: 12345,
            workflow_id: 67890,
            status: "queued",
          },
        }),
      } as Response);

      const result = await createTaskWithStakworkWorkflow({
        title: "Complete Result Task",
        description: "Task with complete result",
        workspaceId: "workspace-1",
        userId: "user-1",
        priority: "HIGH",
        initialMessage: "Complete message",
        mode: "live",
      });

      // Verify all return properties are present
      expect(result).toHaveProperty("task");
      expect(result).toHaveProperty("stakworkResult");
      expect(result).toHaveProperty("chatMessage");

      // Verify task structure
      expect(result.task).toHaveProperty("id");
      expect(result.task).toHaveProperty("title");
      expect(result.task).toHaveProperty("workspaceId");
      expect(result.task).toHaveProperty("createdBy");
      expect(result.task).toHaveProperty("workspace");

      // Verify stakworkResult structure
      expect(result.stakworkResult).toHaveProperty("success");
      expect(result.stakworkResult).toHaveProperty("data");
      expect(result.stakworkResult.data).toHaveProperty("project_id");

      // Verify chatMessage structure
      expect(result.chatMessage).toHaveProperty("id");
      expect(result.chatMessage).toHaveProperty("taskId");
      expect(result.chatMessage).toHaveProperty("message");
    });
  });
});

// Helper function to create mock task
function createMockTask(overrides: Partial<any> = {}) {
  return {
    id: generateUniqueId("task"),
    title: "Test Task",
    description: "Test description",
    workspaceId: "workspace-1",
    status: "TODO",
    priority: "MEDIUM",
    sourceType: "USER",
    createdById: "user-1",
    updatedById: "user-1",
    assigneeId: null,
    repositoryId: null,
    workspace: {
      id: "workspace-1",
      name: "Test Workspace",
      slug: "test-workspace",
      swarm: {
        swarmUrl: "https://test-swarm.com/api",
        swarmSecretAlias: "test-secret",
        poolName: "test-pool",
        name: "Test Swarm",
        id: "swarm-1",
      },
    },
    assignee: null,
    repository: null,
    createdBy: {
      id: "user-1",
      name: "Test User",
      email: "test@example.com",
      image: null,
      githubAuth: null,
    },
    ...overrides,
  };
}

// Helper function to create mock chat message
function createMockChatMessage(taskId: string, overrides: Partial<any> = {}) {
  return {
    id: generateUniqueId("message"),
    taskId,
    message: "Test message",
    role: "USER",
    contextTags: "[]",
    status: "SENT",
    task: {
      id: taskId,
      title: "Test Task",
    },
    ...overrides,
  };
}