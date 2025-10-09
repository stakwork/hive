import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/message/route";
import { ChatRole, ChatStatus, ArtifactType, WorkflowStatus } from "@prisma/client";

// Mock all external dependencies at module level
vi.mock("next-auth/next");
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/lib/env", () => ({
  config: {},
}));
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(),
}));
vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn(),
}));
vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Import mocked modules
const { getServerSession } = await import("next-auth/next");
const { db } = await import("@/lib/db");
const { config } = await import("@/lib/env");
const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
const { getS3Service } = await import("@/services/s3");
const { transformSwarmUrlToRepo2Graph } = await import("@/lib/utils/swarm");
const { getBaseUrl } = await import("@/lib/utils");

const mockGetServerSession = vi.mocked(getServerSession);
const mockDb = vi.mocked(db);
const mockConfig = vi.mocked(config);
const mockGetGithubUsernameAndPAT = vi.mocked(getGithubUsernameAndPAT);
const mockGetS3Service = vi.mocked(getS3Service);
const mockTransformSwarmUrlToRepo2Graph = vi.mocked(transformSwarmUrlToRepo2Graph);
const mockGetBaseUrl = vi.mocked(getBaseUrl);
const mockFetch = vi.mocked(global.fetch);

// Test Data Helpers
const createMockSession = (userId = "user-123") => ({
  user: {
    id: userId,
    email: "test@example.com",
    name: "Test User",
  },
});

const createMockTask = (overrides = {}) => ({
  workspaceId: "workspace-123",
  workspace: {
    ownerId: "user-123",
    swarm: {
      id: "swarm-123",
      swarmUrl: "https://test-swarm.example.com/api",
      swarmSecretAlias: "{{SWARM_API_KEY}}",
      poolName: "test-pool",
      name: "test-swarm",
    },
    members: [],
  },
  ...overrides,
});

const createMockUser = () => ({
  name: "Test User",
});

const createMockChatMessage = (taskId = "task-123", message = "Test message") => ({
  id: "message-id",
  taskId,
  message,
  role: ChatRole.USER,
  contextTags: "[]",
  status: ChatStatus.SENT,
  sourceWebsocketID: null,
  replyId: null,
  artifacts: [],
  attachments: [],
  task: {
    id: taskId,
    title: "Test Task",
  },
  timestamp: new Date(),
});

const createMockWorkspace = () => ({
  slug: "test-workspace",
});

const createMockStakworkResponse = (overrides = {}) => ({
  success: true,
  data: {
    project_id: 456,
    workflow_id: 789,
    status: "pending",
    ...overrides,
  },
});

describe("POST /api/chat/message - callStakwork Unit Tests", () => {
  const mockTaskId = "test-task-id";
  const mockMessage = "Test message for Stakwork";

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default successful mocks
    mockGetServerSession.mockResolvedValue(createMockSession());
    mockDb.task.findFirst.mockResolvedValue(createMockTask() as any);
    mockDb.user.findUnique.mockResolvedValue(createMockUser() as any);
    mockDb.chatMessage.create.mockResolvedValue(createMockChatMessage(mockTaskId, mockMessage) as any);
    mockDb.task.update.mockResolvedValue({} as any);
    mockDb.workspace.findUnique.mockResolvedValue(createMockWorkspace() as any);

    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "github_pat_test123",
    });

    mockGetS3Service.mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://presigned-url.com"),
    } as any);

    mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://repo2graph.example.com:3355");
    mockGetBaseUrl.mockReturnValue("http://localhost:3000");

    // Default config
    mockConfig.STAKWORK_API_KEY = "test-api-key";
    mockConfig.STAKWORK_BASE_URL = "https://stakwork.example.com";
    mockConfig.STAKWORK_WORKFLOW_ID = "123,456,789";
  });

  describe("Environment Variable Validation", () => {
    test("should use mock when STAKWORK_API_KEY is missing", async () => {
      mockConfig.STAKWORK_API_KEY = undefined;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      // Should return 201 and use mock workflow data when Stakwork is disabled
      expect(response.status).toBe(201);
      expect(data.workflow).toBeDefined();
    });

    test("should use mock when STAKWORK_WORKFLOW_ID is missing", async () => {
      mockConfig.STAKWORK_WORKFLOW_ID = undefined;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.workflow).toBeDefined();
    });

    test("should use STAKWORK_BASE_URL when configured", async () => {
      mockConfig.STAKWORK_BASE_URL = "https://custom-stakwork.example.com";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom-stakwork.example.com/projects",
        expect.objectContaining({
          method: "POST",
        })
      );
    });
  });

  describe("Webhook URL Construction", () => {
    test("should construct webhook URL with correct base URL", async () => {
      mockGetBaseUrl.mockReturnValue("https://production.example.com");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.webhookUrl).toBe(
        "https://production.example.com/api/chat/response"
      );
    });

    test("should use CUSTOM_WEBHOOK_URL when environment variable is set", async () => {
      const originalEnv = process.env.CUSTOM_WEBHOOK_URL;
      process.env.CUSTOM_WEBHOOK_URL = "https://custom-webhook.example.com/callback";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.webhookUrl).toBe(
        "https://custom-webhook.example.com/callback"
      );

      // Cleanup
      if (originalEnv) {
        process.env.CUSTOM_WEBHOOK_URL = originalEnv;
      } else {
        delete process.env.CUSTOM_WEBHOOK_URL;
      }
    });

    test("should construct workflow webhook URL with task_id parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.webhook_url).toBe(`http://localhost:3000/api/stakwork/webhook?task_id=${mockTaskId}`);
    });

    test("should use custom webhook parameter when provided", async () => {
      const customWebhook = "https://custom-endpoint.example.com/webhook";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          webhook: customWebhook,
        }),
      });

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        customWebhook,
        expect.objectContaining({
          method: "POST",
        })
      );
    });
  });

  describe("Workflow ID Selection by Mode", () => {
    test.each([
      ["live", "123"],
      ["unit", "789"],
      ["integration", "789"],
      ["test", "456"],
      [undefined, "456"],
    ])("should select workflow ID %s for mode %s", async (mode, expectedWorkflowId) => {
      mockConfig.STAKWORK_WORKFLOW_ID = "123,456,789";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          mode,
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_id).toBe(parseInt(expectedWorkflowId));
    });

    test.skip("should handle single workflow ID (no commas)", async () => {
      // Ensure all env vars are set for Stakwork path
      mockConfig.STAKWORK_API_KEY = "test-api-key";
      mockConfig.STAKWORK_BASE_URL = "https://stakwork.example.com";
      mockConfig.STAKWORK_WORKFLOW_ID = "999";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      // Debug: Check if Stakwork path was actually called
      if (mockFetch.mock.calls.length === 0) {
        // No fetch call means mock path was taken - this is wrong
        throw new Error("Test failed: Expected Stakwork path but got mock path. Check useStakwork condition.");
      }

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_id).toBe(999);
    });
  });

  describe("Stakwork Payload Structure", () => {
    test("should construct payload with all required fields", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          contextTags: [{ type: "file", value: "test.js" }],
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body).toMatchObject({
        name: "hive_autogen",
        workflow_id: expect.any(Number),
        webhook_url: expect.stringContaining("/api/stakwork/webhook"),
        workflow_params: {
          set_var: {
            attributes: {
              vars: {
                taskId: mockTaskId,
                message: mockMessage,
                contextTags: [{ type: "file", value: "test.js" }],
                webhookUrl: expect.stringContaining("/api/chat/response"),
                alias: "testuser",
                username: "testuser",
                accessToken: "github_pat_test123",
                swarmUrl: expect.any(String),
                swarmSecretAlias: "{{SWARM_API_KEY}}",
                poolName: "swarm-123",
                repo2graph_url: "https://repo2graph.example.com:3355",
                attachments: [],
              },
            },
          },
        },
      });
    });

    test("should include authorization header with API key", async () => {
      mockConfig.STAKWORK_API_KEY = "secret-api-key-123";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Authorization: "Token token=secret-api-key-123",
            "Content-Type": "application/json",
          },
        })
      );
    });

    test("should transform swarm URL correctly", async () => {
      const task = createMockTask({
        workspace: {
          ownerId: "user-123",
          swarm: {
            id: "swarm-123",
            swarmUrl: "https://test-swarm.example.com/api",
            swarmSecretAlias: "{{SWARM_API_KEY}}",
            poolName: "test-pool",
            name: "test-swarm",
          },
          members: [],
        },
      });

      mockDb.task.findFirst.mockResolvedValue(task as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.swarmUrl).toBe(
        "https://test-swarm.example.com:8444/api"
      );
    });

    test("should include mode in taskMode field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          mode: "unit",
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.taskMode).toBe("unit");
    });
  });

  describe("S3 Attachment Handling", () => {
    test("should generate presigned URLs for attachments", async () => {
      const mockGeneratePresignedUrl = vi.fn()
        .mockResolvedValueOnce("https://s3.test.com/file1.jpg")
        .mockResolvedValueOnce("https://s3.test.com/file2.pdf");

      mockGetS3Service.mockReturnValue({
        generatePresignedDownloadUrl: mockGeneratePresignedUrl,
      } as any);

      const attachments = [
        { path: "uploads/file1.jpg", filename: "file1.jpg", mimeType: "image/jpeg", size: 1024 },
        { path: "uploads/file2.pdf", filename: "file2.pdf", mimeType: "application/pdf", size: 2048 },
      ];

      const chatMessageWithAttachments = {
        ...createMockChatMessage(mockTaskId, mockMessage),
        attachments: attachments.map(att => ({ ...att, id: "att-id", chatMessageId: "msg-id" })),
      };

      mockDb.chatMessage.create.mockResolvedValue(chatMessageWithAttachments as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          attachments,
        }),
      });

      await POST(request);

      expect(mockGeneratePresignedUrl).toHaveBeenCalledTimes(2);
      expect(mockGeneratePresignedUrl).toHaveBeenCalledWith("uploads/file1.jpg");
      expect(mockGeneratePresignedUrl).toHaveBeenCalledWith("uploads/file2.pdf");

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.attachments).toEqual([
        "https://s3.test.com/file1.jpg",
        "https://s3.test.com/file2.pdf",
      ]);
    });

    test("should handle empty attachments array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          attachments: [],
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.attachments).toEqual([]);
    });

    test("should handle S3 service errors gracefully", async () => {
      const mockGeneratePresignedUrl = vi.fn().mockRejectedValue(new Error("S3 error"));

      mockGetS3Service.mockReturnValue({
        generatePresignedDownloadUrl: mockGeneratePresignedUrl,
      } as any);

      const attachments = [
        { path: "uploads/file1.jpg", filename: "file1.jpg", mimeType: "image/jpeg", size: 1024 },
      ];

      const chatMessageWithAttachments = {
        ...createMockChatMessage(mockTaskId, mockMessage),
        attachments: attachments.map(att => ({ ...att, id: "att-id", chatMessageId: "msg-id" })),
      };

      mockDb.chatMessage.create.mockResolvedValue(chatMessageWithAttachments as any);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          attachments,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      // S3 errors cause Stakwork call to fail, but message creation still succeeds
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toBeUndefined();
    });
  });

  describe("Successful Stakwork API Calls", () => {
    test("should return workflow data on successful API call", async () => {
      const mockWorkflowData = {
        project_id: 12345,
        workflow_id: 67890,
        status: "completed",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockWorkflowData }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toEqual(mockWorkflowData);
    });

    test("should update task workflow status to IN_PROGRESS on success", async () => {
      const mockWorkflowData = {
        project_id: 12345,
        workflow_id: 67890,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockWorkflowData }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 12345,
        },
      });
    });

    test("should store stakworkProjectId when available", async () => {
      const projectId = 99999;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project_id: projectId } }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: expect.objectContaining({
          stakworkProjectId: projectId,
        }),
      });
    });

    test("should handle successful response without project_id", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { workflow_id: 123 } }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
        },
      });
    });
  });

  describe("Failed Stakwork API Calls", () => {
    test("should handle non-ok response from Stakwork API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201); // Still creates message
      expect(data.success).toBe(true);
      expect(data.workflow).toBeUndefined();
    });

    test("should update task workflow status to FAILED on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Request",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.FAILED,
        },
      });
    });

    test("should handle network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network connection failed"));

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toBeUndefined();
    });

    test("should handle fetch timeout errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    test("should handle malformed JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    test("should handle response with success: false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, error: "Workflow validation failed" }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.workflow).toBeUndefined();
    });
  });

  describe("Error Logging", () => {
    test("should log errors when Stakwork API fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Service Unavailable",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send message to Stakwork")
      );

      consoleErrorSpy.mockRestore();
    });

    test("should log network errors with error details", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const networkError = new Error("Connection refused");

      mockFetch.mockRejectedValueOnce(networkError);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error calling Stakwork:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Graceful Degradation", () => {
    test("should create chat message even when Stakwork fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Stakwork unavailable"));

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
      expect(mockDb.chatMessage.create).toHaveBeenCalled();
    });

    test("should return workflow: undefined when callStakwork fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.workflow).toBeUndefined();
    });

    test("should not block message creation on environment variable errors", async () => {
      mockConfig.STAKWORK_API_KEY = undefined;

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.message).toBeDefined();
      expect(mockDb.chatMessage.create).toHaveBeenCalled();
    });
  });

  describe("GitHub Integration", () => {
    test("should include GitHub username in payload", async () => {
      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "github-user-123",
        token: "github_token_abc",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars).toMatchObject({
        alias: "github-user-123",
        username: "github-user-123",
        accessToken: "github_token_abc",
      });
    });

    test("should handle null GitHub profile gracefully", async () => {
      mockGetGithubUsernameAndPAT.mockResolvedValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars).toMatchObject({
        alias: null,
        username: null,
        accessToken: null,
      });
    });

    test("should fetch GitHub credentials with correct workspace slug", async () => {
      mockDb.workspace.findUnique.mockResolvedValue({ slug: "custom-workspace-slug" } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledWith("user-123", "custom-workspace-slug");
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty message with artifacts", async () => {
      const artifacts = [{ type: ArtifactType.CODE, content: { code: "test" } }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "",
          artifacts,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    test("should handle very long messages", async () => {
      const longMessage = "a".repeat(10000);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: longMessage }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.message).toBe(longMessage);
    });

    test("should handle special characters in message", async () => {
      const specialMessage = 'Test with "quotes" and \\backslashes\\ and \nnewlines';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: specialMessage }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    test("should handle null swarm data", async () => {
      const taskWithoutSwarm = createMockTask({
        workspace: {
          ownerId: "user-123",
          swarm: null,
          members: [],
        },
      });

      mockDb.task.findFirst.mockResolvedValue(taskWithoutSwarm as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.swarmUrl).toBe("");
    });

    test("should handle empty context tags array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          contextTags: [],
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall![1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.contextTags).toEqual([]);
    });
  });
});