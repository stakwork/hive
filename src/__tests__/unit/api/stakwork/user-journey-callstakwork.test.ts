import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/stakwork/user-journey/route";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { getWorkspaceById } from "@/services/workspace";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getBaseUrl } from "@/lib/utils";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { config } from "@/config/env";

// Mock all external dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
    swarm: {
      findUnique: vi.fn(),
    },
    repository: {
      findFirst: vi.fn(),
    },
    task: {
      create: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/services/workspace", () => ({
  getWorkspaceById: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(),
}));

vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "",
    STAKWORK_USER_JOURNEY_WORKFLOW_ID: "",
    STAKWORK_BASE_URL: "",
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("callStakwork - Stakwork API Integration Logic", () => {
  const mockUserId = "test-user-id";
  const mockWorkspaceId = "test-workspace-id";
  const mockTaskId = "test-task-id";
  const mockTestName = "Login Test";
  const mockMessage = "test('login', async () => { ... })";
  
  const mockSession = {
    user: { id: mockUserId, email: "test@example.com" },
  };

  const mockWorkspace = {
    id: mockWorkspaceId,
    name: "Test Workspace",
    slug: "test-workspace",
  };

  const mockSwarm = {
    id: "swarm-id",
    swarmUrl: "https://test.sphinx.chat/api",
    swarmSecretAlias: "secret-alias",
    poolName: "test-pool",
  };

  const mockRepository = {
    id: "repo-id",
    repositoryUrl: "https://github.com/test/repo",
    branch: "main",
  };

  const mockGithubProfile = {
    token: "github-token",
    username: "testuser",
  };

  const createMockRequest = (body: any) => {
    return {
      json: vi.fn().mockResolvedValue(body),
    } as unknown as NextRequest;
  };

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Setup default mock implementations
    vi.mocked(getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(getWorkspaceById).mockResolvedValue(mockWorkspace as any);
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(mockGithubProfile);
    vi.mocked(getBaseUrl).mockReturnValue("https://test.hive.com");
    vi.mocked(transformSwarmUrlToRepo2Graph).mockReturnValue("https://test-repo2graph:3355");

    // Mock config with required env vars
    vi.mocked(config).STAKWORK_API_KEY = "test-api-key";
    vi.mocked(config).STAKWORK_USER_JOURNEY_WORKFLOW_ID = "123";
    vi.mocked(config).STAKWORK_BASE_URL = "https://test.stakwork.com";

    // Mock database operations
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      id: mockWorkspaceId,
      slug: "test-workspace",
    } as any);

    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);

    vi.mocked(db.repository.findFirst).mockResolvedValue(mockRepository as any);

    // Mock task creation with dynamic return based on input
    vi.mocked(db.task.create).mockImplementation((args: any) => {
      return Promise.resolve({
        id: mockTaskId,
        title: args.data.title,
        status: args.data.status,
        workflowStatus: args.data.workflowStatus,
        testFilePath: args.data.testFilePath,
        stakworkProjectId: args.data.stakworkProjectId,
      }) as any;
    });
    
    vi.mocked(db.task.update).mockImplementation((args: any) => {
      return Promise.resolve({
        id: args.where.id,
        title: mockTestName,
        status: "TODO",
        workflowStatus: "PENDING",
        testFilePath: null,
        stakworkProjectId: args.data.stakworkProjectId,
      }) as any;
    });

    // Mock chat message creation
    vi.mocked(db.chatMessage.create).mockResolvedValue({
      id: "message-id",
      taskId: mockTaskId,
    } as any);

    // Default successful fetch response
    mockFetch.mockResolvedValue({
      ok: true,
      statusText: "OK",
      json: vi.fn().mockResolvedValue({
        success: true,
        data: { project_id: 456, id: 456 },
      }),
    } as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Success Path - API Call Handling", () => {
    it("should successfully call Stakwork API with correct payload structure", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        title: mockTestName,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      // Verify fetch was called with correct URL
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.stakwork.com/projects",
        expect.any(Object)
      );
    });

    it("should construct correct StakworkWorkflowPayload with all required vars", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        title: mockTestName,
        testName: mockTestName,
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const fetchOptions = fetchCall[1] as RequestInit;
      const payload = JSON.parse(fetchOptions.body as string);

      // Verify payload structure
      expect(payload).toMatchObject({
        name: "hive_autogen",
        workflow_id: 123,
        workflow_params: {
          set_var: {
            attributes: {
              vars: expect.objectContaining({
                taskId: mockTaskId,
                message: mockMessage,
                workspaceId: mockWorkspaceId,
                testName: mockTestName,
              }),
            },
          },
        },
      });

      // Verify webhook URL includes task_id query parameter
      expect(payload.webhook_url).toContain(`task_id=${mockTaskId}`);

      // Verify vars include GitHub credentials
      const vars = payload.workflow_params.set_var.attributes.vars;
      expect(vars.accessToken).toBe("github-token");
      expect(vars.username).toBe("testuser");
    });

    it("should construct correct webhook URLs for callbacks", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse((fetchCall[1] as RequestInit).body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      // Verify workflow webhook URL
      expect(payload.webhook_url).toBe(
        `https://test.hive.com/api/stakwork/webhook?task_id=${mockTaskId}`
      );

      // Verify chat response webhook URL
      expect(vars.webhookUrl).toBe("https://test.hive.com/api/chat/response");
    });

    it("should include correct swarm configuration in payload", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse((fetchCall[1] as RequestInit).body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      // Verify swarm URL transformation (replace /api with :8444/api)
      expect(vars.swarmUrl).toBe("https://test.sphinx.chat:8444/api");
      expect(vars.swarmSecretAlias).toBe("secret-alias");
      expect(vars.poolName).toBe("test-pool");
      expect(vars.repo2graph_url).toBe("https://test-repo2graph:3355");
    });

    it("should set correct authorization header with API key", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const fetchOptions = fetchCall[1] as RequestInit;

      expect(fetchOptions.headers).toMatchObject({
        Authorization: "Token token=test-api-key",
        "Content-Type": "application/json",
      });
    });

    it("should return success with workflow data when API call succeeds", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        statusText: "OK",
        json: vi.fn().mockResolvedValue({
          success: true,
          data: { project_id: 789, workflow_status: "pending" },
        }),
      } as any);

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(responseData.success).toBe(true);
      expect(responseData.workflow).toEqual({
        project_id: 789,
        workflow_status: "pending",
      });
    });

    it("should update task with stakworkProjectId after successful API call", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        statusText: "OK",
        json: vi.fn().mockResolvedValue({
          success: true,
          data: { project_id: 999 },
        }),
      } as any);

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: { stakworkProjectId: 999 },
      });
    });
  });

  describe("Validation - Environment Variables", () => {
    it("should handle missing STAKWORK_API_KEY", async () => {
      vi.mocked(config).STAKWORK_API_KEY = "";

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      // Task should still be created but Stakwork call should fail
      expect(response.status).toBe(201);
      expect(responseData.workflow).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should handle missing STAKWORK_USER_JOURNEY_WORKFLOW_ID", async () => {
      vi.mocked(config).STAKWORK_USER_JOURNEY_WORKFLOW_ID = "";

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.workflow).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling - API Failures", () => {
    it("should handle non-ok response from Stakwork API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
        json: vi.fn().mockResolvedValue({}),
      } as any);

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.workflow).toBeNull();
    });

    it("should handle 401 Unauthorized response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Unauthorized",
        json: vi.fn().mockResolvedValue({}),
      } as any);

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(responseData.success).toBe(true);
      expect(responseData.workflow).toBeNull();
    });

    it("should handle 403 Forbidden response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Forbidden",
        json: vi.fn().mockResolvedValue({}),
      } as any);

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(responseData.workflow).toBeNull();
    });

    it("should handle network timeout errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(responseData.success).toBe(true);
      expect(responseData.workflow).toBeNull();
    });

    it("should handle fetch network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Failed to fetch"));

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      // Task should still be created even if Stakwork call fails
      expect(responseData.success).toBe(true);
      expect(responseData.task).toBeTruthy();
      expect(responseData.workflow).toBeNull();
    });
  });

  describe("Business Logic - Context Handling", () => {
    it("should handle null GitHub credentials gracefully", async () => {
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValueOnce(null);

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse((fetchCall[1] as RequestInit).body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.accessToken).toBeNull();
      expect(vars.username).toBeNull();
    });

    it("should set testFilePath and testFileUrl to null for new recordings", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse((fetchCall[1] as RequestInit).body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      // These should be null because Stakwork workflow determines actual path
      expect(vars.testFilePath).toBeNull();
      expect(vars.testFileUrl).toBeNull();
    });

    it("should default poolName to swarm.id when poolName is null", async () => {
      vi.mocked(db.swarm.findUnique).mockResolvedValueOnce({
        ...mockSwarm,
        poolName: null,
      } as any);

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse((fetchCall[1] as RequestInit).body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.poolName).toBe("swarm-id");
    });

    it("should use repository branch or default to 'main'", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse((fetchCall[1] as RequestInit).body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.baseBranch).toBe("main");
    });

    it("should handle missing repository gracefully", async () => {
      vi.mocked(db.repository.findFirst).mockResolvedValueOnce(null);

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse((fetchCall[1] as RequestInit).body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.baseBranch).toBe("main");
    });

    it("should use title over testName when both provided", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        title: "Custom Title",
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(responseData.task.title).toBe("Custom Title");
    });

    it("should use testName when title not provided", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(responseData.task.title).toBe(mockTestName);
    });

    it("should default to 'User Journey Test' when neither title nor testName provided", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(responseData.task.title).toBe("User Journey Test");
    });
  });

  describe("Business Logic - Task Creation", () => {
    it("should create task with sourceType USER_JOURNEY", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType: "USER_JOURNEY",
          }),
        })
      );
    });

    it("should create task with TODO status and PENDING workflowStatus", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "TODO",
            workflowStatus: "PENDING",
          }),
        })
      );
    });

    it("should save test code in ChatMessage for replay access", async () => {
      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      await POST(request);

      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskId: mockTaskId,
            role: "ASSISTANT",
            message: mockMessage,
          }),
        })
      );
    });

    it("should continue if ChatMessage creation fails (non-fatal)", async () => {
      vi.mocked(db.chatMessage.create).mockRejectedValueOnce(
        new Error("Database error")
      );

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      // Should still succeed even if chat message fails
      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
    });

    it("should continue if task update with stakworkProjectId fails (non-fatal)", async () => {
      vi.mocked(db.task.update).mockRejectedValueOnce(
        new Error("Database error")
      );

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
        testName: mockTestName,
      });

      const response = await POST(request);
      const responseData = await response.json();

      // Should still succeed even if update fails
      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
    });
  });

  describe("Error Propagation - Request Validation", () => {
    it("should return 401 when user not authenticated", async () => {
      vi.mocked(getServerSession).mockResolvedValueOnce(null);

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
    });

    it("should return 400 when message is missing", async () => {
      const request = createMockRequest({
        workspaceId: mockWorkspaceId,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it("should return 400 when workspaceId is missing", async () => {
      const request = createMockRequest({
        message: mockMessage,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it("should return 404 when workspace not found", async () => {
      vi.mocked(getWorkspaceById).mockResolvedValueOnce(null);

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
    });

    it("should return 404 when swarm not found", async () => {
      vi.mocked(db.swarm.findUnique).mockResolvedValueOnce(null);

      const request = createMockRequest({
        message: mockMessage,
        workspaceId: mockWorkspaceId,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData.error).toBe("No swarm found for this workspace");
    });
  });
});
