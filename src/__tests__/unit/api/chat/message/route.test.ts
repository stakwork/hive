import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all external dependencies
vi.mock("next-auth/next");
vi.mock("@/lib/auth/nextauth");
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/config/env");
vi.mock("@/services/s3");
vi.mock("@/lib/utils", async () => {
  const actual = await vi.importActual("@/lib/utils");
  return {
    ...actual,
    getBaseUrl: vi.fn(),
  };
});
vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn(),
}));

// Import modules after mocks are set up
import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/message/route";
import { ChatRole, ChatStatus, WorkflowStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { getS3Service } from "@/services/s3";
import { getBaseUrl } from "@/lib/utils";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";

describe("POST /api/chat/message - callStakwork Unit Tests", () => {
  const mockUserId = "user-123";
  const mockTaskId = "task-456";
  const mockWorkspaceId = "workspace-789";
  const mockMessageId = "message-abc";

  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: mockUserId },
    } as any);

    vi.mocked(getBaseUrl).mockReturnValue("http://localhost:3000");
    vi.mocked(transformSwarmUrlToRepo2Graph).mockReturnValue("http://test-swarm.com:3355");

    // Mock S3 service for attachment presigning
    vi.mocked(getS3Service).mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.test.com/presigned-url"),
    } as any);

    // Mock GitHub credentials
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
      username: "testuser",
      token: "github_pat_test123",
    } as any);

    // Mock global fetch for Stakwork API calls
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;

    // Setup default config values
    vi.mocked(config).STAKWORK_API_KEY = "test-stakwork-key";
    vi.mocked(config).STAKWORK_BASE_URL = "https://stakwork.test.com/api";
    vi.mocked(config).STAKWORK_WORKFLOW_ID = "101,102,103"; // live,test,unit/integration

    // Mock empty chat history for all tests by default
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    it("should return 401 when no session exists", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when user ID is missing", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {},
      } as any);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });

    it("should return 401 when session user has no ID", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id
      } as any);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Request Validation Tests", () => {
    it("should return 400 when message is missing and no artifacts", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: { swarmUrl: "https://test-swarm.com/api" },
        },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          // message missing and no artifacts
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Message is required");
    });

    it("should return 400 when taskId is missing", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          message: "Test message",
          // taskId missing
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("taskId is required");
    });

    it("should accept request with artifacts but no message", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = { id: mockUserId, name: "Test User" };
      const mockWorkspace = { id: mockWorkspaceId, slug: "test-workspace" };

      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [{ id: "artifact-1", type: "CODE", content: { code: "console.log('test')" } }],
        attachments: [],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
      vi.mocked(db.task.update).mockResolvedValue({} as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "", // Empty message
          artifacts: [{ type: "CODE", content: { code: "console.log('test')" } }],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });
  });

  describe("Database Access Control Tests", () => {
    it("should return 404 when task is not found", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue(null);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
      expect(vi.mocked(db.task.findFirst)).toHaveBeenCalledWith({
        where: {
          id: mockTaskId,
          deleted: false,
        },
        select: expect.any(Object),
      });
    });

    it("should return 404 when user is not found", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: "other-user",
          members: [],
          swarm: { swarmUrl: "https://test-swarm.com/api" },
        },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(null);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });

    it("should return 404 when workspace is not found", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: { swarmUrl: "https://test-swarm.com/api" },
        },
      };

      const mockUser = { id: mockUserId, name: "Test User" };

      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [],
        attachments: [],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
    });

    it("should return 403 when user lacks workspace access", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: "other-user",
          members: [], // User is not a member
          swarm: { swarmUrl: "https://test-swarm.com/api" },
        },
      };

      const mockUser = { id: mockUserId, name: "Test User" };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });

    it("should allow access for workspace owner", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId, // User is the owner
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = { id: mockUserId, name: "Test User" };
      const mockWorkspace = { id: mockWorkspaceId, slug: "test-workspace" };

      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [],
        attachments: [],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
      vi.mocked(db.task.update).mockResolvedValue({} as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });

    it("should allow access for workspace member", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: "other-user",
          members: [{ role: "DEVELOPER" }], // User is a member
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = { id: mockUserId, name: "Test User" };
      const mockWorkspace = { id: mockWorkspaceId, slug: "test-workspace" };

      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [],
        attachments: [],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
      vi.mocked(db.task.update).mockResolvedValue({} as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });
  });

  describe("Stakwork API Configuration Tests", () => {
    beforeEach(() => {
      // Setup default successful mocks
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = { id: mockUserId, name: "Test User" };
      const mockWorkspace = { id: mockWorkspaceId, slug: "test-workspace" };

      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [],
        attachments: [],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
      vi.mocked(db.task.update).mockResolvedValue({} as any);
    });

    it("should use mock service when STAKWORK_API_KEY is not present", async () => {
      vi.mocked(config).STAKWORK_API_KEY = "";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { mock: true } }),
      } as Response);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      // Without Stakwork config, should use mock service (calls /api/mock endpoint)
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/mock/chat",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    it("should validate STAKWORK_WORKFLOW_ID is present when using Stakwork", async () => {
      vi.mocked(config).STAKWORK_WORKFLOW_ID = "";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });

    it("should call Stakwork API with correct configuration", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      // Verify Stakwork API was called
      expect(mockFetch).toHaveBeenCalledWith(
        "https://stakwork.test.com/api/projects",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key",
            "Content-Type": "application/json",
          }),
        }),
      );
    });
  });

  describe("Workflow Mode Selection Tests", () => {
    beforeEach(() => {
      // Setup default successful mocks
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = { id: mockUserId, name: "Test User" };
      const mockWorkspace = { id: mockWorkspaceId, slug: "test-workspace" };

      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [],
        attachments: [],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
      vi.mocked(db.task.update).mockResolvedValue({} as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);
    });

    it("should use first workflow ID for live mode", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          mode: "live",
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);

      expect(requestBody.workflow_id).toBe(101); // First workflow ID
    });

    it("should use third workflow ID for unit mode", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          mode: "unit",
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);

      expect(requestBody.workflow_id).toBe(103); // Third workflow ID
    });

    it("should use third workflow ID for integration mode", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          mode: "integration",
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);

      expect(requestBody.workflow_id).toBe(103); // Third workflow ID
    });

    it("should use second workflow ID for default/test mode", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          mode: "test",
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);

      expect(requestBody.workflow_id).toBe(102); // Second workflow ID (default)
    });

    it("should use second workflow ID when mode is not specified", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);

      expect(requestBody.workflow_id).toBe(102); // Second workflow ID (default)
    });
  });

  describe("Task Messaging and Context Propagation Tests", () => {
    beforeEach(() => {
      // Setup default successful mocks
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = { id: mockUserId, name: "Test User" };
      const mockWorkspace = { id: mockWorkspaceId, slug: "test-workspace" };

      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [],
        attachments: [],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
      vi.mocked(db.task.update).mockResolvedValue({} as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);
    });

    it("should construct vars object with all required fields", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          contextTags: [{ type: "file", value: "test.js" }],
          mode: "live",
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);
      const vars = requestBody.workflow_params.set_var.attributes.vars;

      expect(vars).toMatchObject({
        taskId: mockTaskId,
        message: "Test message",
        alias: "testuser",
        username: "testuser",
        accessToken: "github_pat_test123",
        swarmUrl: "https://test-swarm.com:8444/api",
        swarmSecretAlias: "test-secret",
        poolName: "swarm-123",
        taskMode: "live",
        workspaceId: mockWorkspaceId,
      });

      expect(vars.contextTags).toEqual([{ type: "file", value: "test.js" }]);
      expect(vars.webhookUrl).toContain("/api/chat/response");
      expect(vars.repo2graph_url).toBe("http://test-swarm.com:3355");
    });

    it("should handle attachments with presigned URLs", async () => {
      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [],
        attachments: [
          {
            id: "att-1",
            path: "uploads/test/file.pdf",
            filename: "file.pdf",
            mimeType: "application/pdf",
            size: 1024,
          },
        ],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          attachments: [
            {
              path: "uploads/test/file.pdf",
              filename: "file.pdf",
              mimeType: "application/pdf",
              size: 1024,
            },
          ],
        }),
      });

      await POST(request);

      // Verify S3 service was called to generate presigned URL
      expect(vi.mocked(getS3Service)).toHaveBeenCalled();
      const s3Service = vi.mocked(getS3Service).mock.results[0].value;
      expect(s3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith("uploads/test/file.pdf");

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);
      const vars = requestBody.workflow_params.set_var.attributes.vars;

      expect(vars.attachments).toEqual(["https://s3.test.com/presigned-url"]);
    });

    it("should construct webhook URL with getBaseUrl", async () => {
      vi.mocked(getBaseUrl).mockReturnValue("https://production.example.com");

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        headers: { host: "production.example.com" },
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      await POST(request);

      // Service layer calls getBaseUrl without arguments (no request context)
      expect(vi.mocked(getBaseUrl)).toHaveBeenCalledWith();

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);
      const vars = requestBody.workflow_params.set_var.attributes.vars;

      expect(vars.webhookUrl).toBe("https://production.example.com/api/chat/response");
    });

    it("should override webhook URL with CUSTOM_WEBHOOK_URL env var", async () => {
      process.env.CUSTOM_WEBHOOK_URL = "https://custom-webhook.example.com";

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);
      const vars = requestBody.workflow_params.set_var.attributes.vars;

      expect(vars.webhookUrl).toBe("https://custom-webhook.example.com");

      delete process.env.CUSTOM_WEBHOOK_URL;
    });

    it("should include workflow status webhook URL", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);

      expect(requestBody.webhook_url).toBe(`http://localhost:3000/api/stakwork/webhook?task_id=${mockTaskId}`);
    });

    it("should transform swarm URL for repo2graph", async () => {
      vi.mocked(transformSwarmUrlToRepo2Graph).mockReturnValue("https://custom-graph.com:3355");

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      await POST(request);

      expect(vi.mocked(transformSwarmUrlToRepo2Graph)).toHaveBeenCalledWith("https://test-swarm.com/api");

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);
      const vars = requestBody.workflow_params.set_var.attributes.vars;

      expect(vars.repo2graph_url).toBe("https://custom-graph.com:3355");
    });
  });

  describe("Error Handling and Fault-Tolerant Design Tests", () => {
    beforeEach(() => {
      // Setup default successful mocks
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = { id: mockUserId, name: "Test User" };
      const mockWorkspace = { id: mockWorkspaceId, slug: "test-workspace" };

      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [],
        attachments: [],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
      vi.mocked(db.task.update).mockResolvedValue({} as any);
    });

    it("should handle Stakwork API HTTP failure (response.ok === false)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      // Fault-tolerant design: returns 201 with workflow: undefined (no data property in failure response)
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toBeUndefined();

      // Verify task workflow status was set to FAILED
      expect(vi.mocked(db.task.update)).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.FAILED,
        },
      });
    });

    it("should handle Stakwork API network error (fetch rejection)", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      // Fault-tolerant design: returns 201 with workflow: undefined (no data property in failure response)
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toBeUndefined();

      // Verify task workflow status was set to FAILED
      expect(vi.mocked(db.task.update)).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.FAILED,
        },
      });
    });

    it("should return 500 on database error", async () => {
      vi.mocked(db.task.findFirst).mockRejectedValue(new Error("Database connection error"));

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create chat message");
    });

    it("should handle malformed JSON in request body", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: "invalid json {",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create chat message");
    });

    it("should create chat message successfully even when Stakwork fails", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Service Unavailable",
      } as Response);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify chat message was still created
      expect(vi.mocked(db.chatMessage.create)).toHaveBeenCalled();
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
      expect(data.message.message).toBe("Test message");
    });
  });

  describe("Successful Workflow Execution Tests", () => {
    beforeEach(() => {
      // Setup default successful mocks
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = { id: mockUserId, name: "Test User" };
      const mockWorkspace = { id: mockWorkspaceId, slug: "test-workspace" };

      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [],
        attachments: [],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
      vi.mocked(db.task.update).mockResolvedValue({} as any);
    });

    it("should successfully create chat message and start workflow", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            project_id: 12345,
            workflow_id: "workflow-abc",
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          contextTags: [{ type: "file", value: "test.js" }],
          mode: "live",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
      expect(data.message.message).toBe("Test message");
      expect(data.workflow).toEqual({
        project_id: 12345,
        workflow_id: "workflow-abc",
      });

      // Verify database operations
      expect(vi.mocked(db.chatMessage.create)).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: mockTaskId,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
        }),
        include: expect.any(Object),
      });

      // Verify task was updated with workflow status
      expect(vi.mocked(db.task.update)).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 12345,
        },
      });
    });

    it("should store stakworkProjectId when available in response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            project_id: 67890,
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      await POST(request);

      expect(vi.mocked(db.task.update)).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 67890,
        },
      });
    });

    it("should handle workflow response without project_id", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            workflow_id: "workflow-xyz",
            // No project_id
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      // Verify task was updated without stakworkProjectId
      expect(vi.mocked(db.task.update)).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
        },
      });
    });
  });

  describe("Context Tags and Artifacts Tests", () => {
    beforeEach(() => {
      // Setup default successful mocks
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = { id: mockUserId, name: "Test User" };
      const mockWorkspace = { id: mockWorkspaceId, slug: "test-workspace" };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
      vi.mocked(db.task.update).mockResolvedValue({} as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]); // Mock empty chat history

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
      } as Response);
    });

    it("should handle multiple context tags", async () => {
      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: JSON.stringify([
          { type: "file", value: "src/utils.ts" },
          { type: "function", value: "processData" },
        ]),
        status: ChatStatus.SENT,
        artifacts: [],
        attachments: [],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          contextTags: [
            { type: "file", value: "src/utils.ts" },
            { type: "function", value: "processData" },
          ],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.contextTags).toEqual([
        { type: "file", value: "src/utils.ts" },
        { type: "function", value: "processData" },
      ]);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);
      const vars = requestBody.workflow_params.set_var.attributes.vars;

      expect(vars.contextTags).toEqual([
        { type: "file", value: "src/utils.ts" },
        { type: "function", value: "processData" },
      ]);
    });

    it("should handle artifacts in chat message", async () => {
      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [
          {
            id: "artifact-1",
            type: "CODE",
            content: { language: "javascript", code: "console.log('test')" },
          },
        ],
        attachments: [],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          artifacts: [
            {
              type: "CODE",
              content: { language: "javascript", code: "console.log('test')" },
            },
          ],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.artifacts).toHaveLength(1);
      expect(data.message.artifacts[0].type).toBe("CODE");

      // Verify database creation included artifacts
      expect(vi.mocked(db.chatMessage.create)).toHaveBeenCalledWith({
        data: expect.objectContaining({
          artifacts: {
            create: [
              {
                type: "CODE",
                content: { language: "javascript", code: "console.log('test')" },
              },
            ],
          },
        }),
        include: expect.any(Object),
      });
    });

    it("should handle multiple attachments with presigned URLs", async () => {
      const s3Service = {
        generatePresignedDownloadUrl: vi
          .fn()
          .mockResolvedValueOnce("https://s3.test.com/file1.pdf")
          .mockResolvedValueOnce("https://s3.test.com/file2.jpg"),
      };

      vi.mocked(getS3Service).mockReturnValue(s3Service as any);

      const mockCreatedMessage = {
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        artifacts: [],
        attachments: [
          { id: "att-1", path: "uploads/file1.pdf", filename: "file1.pdf", mimeType: "application/pdf", size: 1024 },
          { id: "att-2", path: "uploads/file2.jpg", filename: "file2.jpg", mimeType: "image/jpeg", size: 2048 },
        ],
        task: { id: mockTaskId, title: "Test Task" },
      };

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          attachments: [
            { path: "uploads/file1.pdf", filename: "file1.pdf", mimeType: "application/pdf", size: 1024 },
            { path: "uploads/file2.jpg", filename: "file2.jpg", mimeType: "image/jpeg", size: 2048 },
          ],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.attachments).toHaveLength(2);

      // Verify S3 service was called for each attachment
      expect(s3Service.generatePresignedDownloadUrl).toHaveBeenCalledTimes(2);
      expect(s3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith("uploads/file1.pdf");
      expect(s3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith("uploads/file2.jpg");

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);
      const vars = requestBody.workflow_params.set_var.attributes.vars;

      expect(vars.attachments).toEqual(["https://s3.test.com/file1.pdf", "https://s3.test.com/file2.jpg"]);
    });
  });
});
