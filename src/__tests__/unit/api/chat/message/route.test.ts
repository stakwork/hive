import { describe, it, expect, vi, beforeEach } from "vitest";
import { invokeRoute } from "@/__tests__/harness/route";
import { POST } from "@/app/api/chat/message/route";
import { ChatRole, ChatStatus, ArtifactType, WorkflowStatus } from "@prisma/client";

// Mock all dependencies at module level
vi.mock("@/lib/auth/nextauth");
vi.mock("@/lib/db");
vi.mock("@/lib/utils/swarm");
vi.mock("@/services/s3");
vi.mock("@/lib/env");

// Mock fetch globally for Stakwork API calls
global.fetch = vi.fn();

// Import mocked modules
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { getS3Service } from "@/services/s3";
import { config } from "@/lib/env";

// Import test helpers and factories
import {
  createMockSession,
  createMockUser,
  createMockWorkspace,
  createMockSwarm,
  createMockTask,
  createMockChatMessage,
  createMockGithubProfile,
  createMockStakworkResponse,
  createMockRequestBody,
  setupSuccessfulDatabaseMocks,
} from "@/__tests__/support/factories/chat-message-route-helpers";



describe("POST /api/chat/message - callStakwork Orchestration", () => {
  // Mock instances
  let mockGetGithubUsernameAndPAT: ReturnType<typeof vi.fn>;
  let mockDbTaskFindFirst: ReturnType<typeof vi.fn>;
  let mockDbUserFindUnique: ReturnType<typeof vi.fn>;
  let mockDbWorkspaceFindUnique: ReturnType<typeof vi.fn>;
  let mockDbChatMessageCreate: ReturnType<typeof vi.fn>;
  let mockDbTaskUpdate: ReturnType<typeof vi.fn>;
  let mockTransformSwarmUrlToRepo2Graph: ReturnType<typeof vi.fn>;
  let mockGetS3Service: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockConfig: typeof config;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Setup mock implementations
    mockGetGithubUsernameAndPAT = vi.mocked(getGithubUsernameAndPAT);
    mockDbTaskFindFirst = vi.fn();
    mockDbUserFindUnique = vi.fn();
    mockDbWorkspaceFindUnique = vi.fn();
    mockDbChatMessageCreate = vi.fn();
    mockDbTaskUpdate = vi.fn();
    mockTransformSwarmUrlToRepo2Graph = vi.mocked(transformSwarmUrlToRepo2Graph);
    mockGetS3Service = vi.mocked(getS3Service);
    mockFetch = vi.mocked(global.fetch);

    // Mock db methods
    vi.mocked(db).task = {
      findFirst: mockDbTaskFindFirst,
      update: mockDbTaskUpdate,
    } as any;

    vi.mocked(db).user = {
      findUnique: mockDbUserFindUnique,
    } as any;

    vi.mocked(db).workspace = {
      findUnique: mockDbWorkspaceFindUnique,
    } as any;

    vi.mocked(db).chatMessage = {
      create: mockDbChatMessageCreate,
    } as any;

    // Mock config
    mockConfig = vi.mocked(config);
    mockConfig.STAKWORK_API_KEY = "test-api-key";
    mockConfig.STAKWORK_BASE_URL = "https://stakwork-api.example.com";
    mockConfig.STAKWORK_WORKFLOW_ID = "123,456,789";

    // Mock S3 service
    mockGetS3Service.mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://presigned-url.com/file"),
    } as any);

    // Mock environment variables
    vi.stubEnv("STAKWORK_API_KEY", "test-api-key");
    vi.stubEnv("STAKWORK_BASE_URL", "https://stakwork-api.example.com");
    vi.stubEnv("STAKWORK_WORKFLOW_ID", "123,456,789");
  });

  describe("Authentication", () => {
    it("should return 401 when user is not authenticated", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: null,
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(401);
      const json = await result.json();
      expect(json).toEqual({ error: "Unauthorized" });
    });

    it("should return 401 when session has no user", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: { expires: new Date().toISOString() },
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(401);
      const json = await result.json();
      expect(json).toEqual({ error: "Unauthorized" });
    });

    it("should return 401 when user session has no id", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: {
          user: { email: "test@example.com" },
          expires: new Date().toISOString(),
        },
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(401);
      const json = await result.json();
      expect(json).toEqual({ error: "Invalid user session" });
    });
  });

  describe("Request Validation", () => {
    it("should return 400 when message is missing and no artifacts", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ message: undefined, artifacts: [] }),
      });

      expect(result.status).toBe(400);
      const json = await result.json();
      expect(json).toEqual({ error: "Message is required" });
    });

    it("should return 400 when message is empty string and no artifacts", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ message: "", artifacts: [] }),
      });

      expect(result.status).toBe(400);
      const json = await result.json();
      expect(json).toEqual({ error: "Message is required" });
    });

    it("should return 400 when taskId is missing", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ taskId: undefined }),
      });

      expect(result.status).toBe(400);
      const json = await result.json();
      expect(json).toEqual({ error: "taskId is required" });
    });

    it("should accept empty message if artifacts are provided", async () => {
      mockDbTaskFindFirst.mockResolvedValue(createMockTask());
      mockDbUserFindUnique.mockResolvedValue(createMockUser());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbChatMessageCreate.mockResolvedValue(createMockChatMessage());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({
          message: "",
          artifacts: [{ type: ArtifactType.CODE, content: { code: "test" } }],
        }),
      });

      expect(result.status).toBe(201);
    });
  });

  describe("Resource Access", () => {
    it("should return 404 when task is not found", async () => {
      mockDbTaskFindFirst.mockResolvedValue(null);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(404);
      const json = await result.json();
      expect(json).toEqual({ error: "Task not found" });
    });

    it("should return 404 when user is not found", async () => {
      mockDbTaskFindFirst.mockResolvedValue(createMockTask());
      mockDbUserFindUnique.mockResolvedValue(null);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(404);
      const json = await result.json();
      expect(json).toEqual({ error: "User not found" });
    });

    it("should return 403 when user is not workspace owner or member", async () => {
      const taskWithDifferentOwner = createMockTask({
        workspace: {
          ownerId: "different-user-id",
          swarm: createMockSwarm(),
          members: [],
        },
      });
      mockDbTaskFindFirst.mockResolvedValue(taskWithDifferentOwner);
      mockDbUserFindUnique.mockResolvedValue(createMockUser());

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(403);
      const json = await result.json();
      expect(json).toEqual({ error: "Access denied" });
    });

    it("should return 404 when workspace is not found after message creation", async () => {
      // Test reflects actual implementation behavior: after chat message creation,
      // a second workspace lookup is done for GitHub credentials. When workspace is null,
      // the route returns 404 with "Workspace not found" error
      mockDbTaskFindFirst.mockResolvedValue(createMockTask());
      mockDbUserFindUnique.mockResolvedValue(createMockUser());
      mockDbChatMessageCreate.mockResolvedValue(createMockChatMessage());
      mockDbWorkspaceFindUnique.mockResolvedValue(null);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(404);
      const json = await result.json();
      expect(json).toEqual({ error: "Workspace not found" });
    });
  });

  describe("callStakwork Configuration Validation", () => {
    beforeEach(() => {
      // Setup valid database responses
      mockDbTaskFindFirst.mockResolvedValue(createMockTask());
      mockDbUserFindUnique.mockResolvedValue(createMockUser());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbChatMessageCreate.mockResolvedValue(createMockChatMessage());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
    });

    it("should use mock service when STAKWORK_API_KEY is not configured", async () => {
      mockConfig.STAKWORK_API_KEY = "";
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
      // Verify mock endpoint was called instead of Stakwork
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/mock"),
        expect.any(Object)
      );
    });

    it("should call Stakwork when all config is present", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://stakwork-api.example.com/projects",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Token token=test-api-key",
            "Content-Type": "application/json",
          },
        })
      );
    });
  });

  describe("callStakwork Orchestration - Successful Flow", () => {
    beforeEach(() => {
      // Setup valid database responses
      mockDbTaskFindFirst.mockResolvedValue(createMockTask());
      mockDbUserFindUnique.mockResolvedValue(createMockUser());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbChatMessageCreate.mockResolvedValue(createMockChatMessage());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
    });

    it("should successfully orchestrate callStakwork with all parameters", async () => {
      const mockStakworkData = createMockStakworkResponse();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockStakworkData,
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json.success).toBe(true);
      expect(json.workflow).toEqual(mockStakworkData.data);

      // Verify GitHub credentials were retrieved
      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledWith("user-123", "test-workspace");

      // Verify swarm URL transformation was called
      expect(mockTransformSwarmUrlToRepo2Graph).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat/api"
      );

      // Verify task workflow status was updated
      expect(mockDbTaskUpdate).toHaveBeenCalledWith({
        where: { id: "task-123" },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 456,
        },
      });
    });

    it("should pass correct parameters to Stakwork API", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({
          message: "Test message",
          contextTags: [{ type: "file", id: "test.ts" }],
        }),
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);

      expect(payload).toMatchObject({
        name: "hive_autogen",
        workflow_id: expect.any(Number),
        workflow_params: {
          set_var: {
            attributes: {
              vars: {
                taskId: "task-123",
                message: "Test message",
                contextTags: [{ type: "file", id: "test.ts" }],
                alias: "testuser",
                username: "testuser",
                accessToken: "github_pat_test123",
                swarmUrl: expect.stringContaining("8444"),
                swarmSecretAlias: "{{SWARM_123_API_KEY}}",
                poolName: "swarm-123",
                repo2graph_url: "https://test-swarm.sphinx.chat:3355",
                attachments: [],
              },
            },
          },
        },
      });
    });

    it("should handle null GitHub credentials gracefully", async () => {
      mockGetGithubUsernameAndPAT.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);

      expect(payload.workflow_params.set_var.attributes.vars.username).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.accessToken).toBeNull();
    });

    it("should transform swarm URL correctly (replace /api with :8444/api)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);

      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);

      expect(payload.workflow_params.set_var.attributes.vars.swarmUrl).toContain(":8444/api");
      expect(payload.workflow_params.set_var.attributes.vars.swarmUrl).not.toContain(
        "sphinx.chat/api"
      );
    });
  });

  describe("callStakwork Mode-Based Workflow Selection", () => {
    beforeEach(() => {
      mockDbTaskFindFirst.mockResolvedValue(createMockTask());
      mockDbUserFindUnique.mockResolvedValue(createMockUser());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbChatMessageCreate.mockResolvedValue(createMockChatMessage());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);
    });

    it("should use workflow ID index 0 for live mode", async () => {
      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ mode: "live" }),
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_id).toBe(123); // First workflow ID
    });

    it("should use workflow ID index 2 for unit mode", async () => {
      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ mode: "unit" }),
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_id).toBe(789); // Third workflow ID
    });

    it("should use workflow ID index 2 for integration mode", async () => {
      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ mode: "integration" }),
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_id).toBe(789); // Third workflow ID
    });

    it("should use workflow ID index 1 for test mode (default)", async () => {
      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ mode: "test" }),
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_id).toBe(456); // Second workflow ID
    });

    it("should default to test mode when no mode specified", async () => {
      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ mode: undefined }),
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_id).toBe(456); // Second workflow ID (default)
    });
  });

  describe("callStakwork Attachment Handling", () => {
    beforeEach(() => {
      mockDbTaskFindFirst.mockResolvedValue(createMockTask());
      mockDbUserFindUnique.mockResolvedValue(createMockUser());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);
    });

    it("should generate presigned URLs for attachments", async () => {
      const mockMessage = createMockChatMessage({
        attachments: [
          { path: "uploads/file1.pdf", filename: "file1.pdf" },
          { path: "uploads/file2.jpg", filename: "file2.jpg" },
        ],
      });
      mockDbChatMessageCreate.mockResolvedValue(mockMessage);

      const mockS3 = {
        generatePresignedDownloadUrl: vi
          .fn()
          .mockResolvedValueOnce("https://s3.test.com/file1.pdf")
          .mockResolvedValueOnce("https://s3.test.com/file2.jpg"),
      };
      mockGetS3Service.mockReturnValue(mockS3 as any);

      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({
          attachments: [
            { path: "uploads/file1.pdf", filename: "file1.pdf", mimeType: "application/pdf", size: 1024 },
            { path: "uploads/file2.jpg", filename: "file2.jpg", mimeType: "image/jpeg", size: 2048 },
          ],
        }),
      });

      expect(mockS3.generatePresignedDownloadUrl).toHaveBeenCalledTimes(2);
      expect(mockS3.generatePresignedDownloadUrl).toHaveBeenCalledWith("uploads/file1.pdf");
      expect(mockS3.generatePresignedDownloadUrl).toHaveBeenCalledWith("uploads/file2.jpg");

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_params.set_var.attributes.vars.attachments).toEqual([
        "https://s3.test.com/file1.pdf",
        "https://s3.test.com/file2.jpg",
      ]);
    });

    it("should handle empty attachments array", async () => {
      mockDbChatMessageCreate.mockResolvedValue(createMockChatMessage({ attachments: [] }));

      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ attachments: [] }),
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_params.set_var.attributes.vars.attachments).toEqual([]);
    });
  });

  describe("callStakwork Error Handling", () => {
    beforeEach(() => {
      mockDbTaskFindFirst.mockResolvedValue(createMockTask());
      mockDbUserFindUnique.mockResolvedValue(createMockUser());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbChatMessageCreate.mockResolvedValue(createMockChatMessage());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
    });

    it("should handle Stakwork API response with ok: false", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      // Should still return 201 (graceful degradation)
      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json.success).toBe(true);

      // Verify task workflow status was set to FAILED
      expect(mockDbTaskUpdate).toHaveBeenCalledWith({
        where: { id: "task-123" },
        data: {
          workflowStatus: WorkflowStatus.FAILED,
        },
      });
    });

    it("should handle Stakwork API network error (fetch rejection)", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      // Should still return 201 (graceful degradation)
      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json.success).toBe(true);

      // Verify task workflow status was set to FAILED
      expect(mockDbTaskUpdate).toHaveBeenCalledWith({
        where: { id: "task-123" },
        data: {
          workflowStatus: WorkflowStatus.FAILED,
        },
      });
    });

    it("should return null workflow data when Stakwork fails", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Service Unavailable",
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      const json = await result.json();
      expect(json.workflow).toBeUndefined();
    });

    it("should handle Stakwork API returning success: false", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: "Workflow validation failed" }),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);

      expect(mockDbTaskUpdate).toHaveBeenCalledWith({
        where: { id: "task-123" },
        data: {
          workflowStatus: WorkflowStatus.FAILED,
        },
      });
    });

    it("should still create chat message even when Stakwork fails", async () => {
      mockFetch.mockRejectedValue(new Error("Network timeout"));

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
      expect(mockDbChatMessageCreate).toHaveBeenCalled();
    });
  });

  describe("callStakwork Webhook URL Construction", () => {
    beforeEach(() => {
      mockDbTaskFindFirst.mockResolvedValue(createMockTask());
      mockDbUserFindUnique.mockResolvedValue(createMockUser());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbChatMessageCreate.mockResolvedValue(createMockChatMessage());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);
    });

    it("should include workflow webhook URL with task_id parameter", async () => {
      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      
      expect(payload.webhook_url).toContain("/api/stakwork/webhook");
      expect(payload.webhook_url).toContain("task_id=task-123");
    });

    it("should include webhookUrl in workflow vars", async () => {
      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      
      expect(payload.workflow_params.set_var.attributes.vars.webhookUrl).toContain(
        "/api/chat/response"
      );
    });

    it("should use custom webhook URL when provided", async () => {
      const customWebhook = "https://custom-webhook.example.com/handler";
      
      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ webhook: customWebhook }),
      });

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe(customWebhook);
    });
  });

  describe("Database Error Handling", () => {
    it("should return 500 when database operations fail", async () => {
      mockDbTaskFindFirst.mockRejectedValue(new Error("Database connection failed"));

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(500);
      const json = await result.json();
      expect(json).toEqual({ error: "Failed to create chat message" });
    });

    it("should return 500 when chat message creation fails", async () => {
      mockDbTaskFindFirst.mockResolvedValue(createMockTask());
      mockDbUserFindUnique.mockResolvedValue(createMockUser());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockDbChatMessageCreate.mockRejectedValue(new Error("Insert failed"));

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(500);
      const json = await result.json();
      expect(json).toEqual({ error: "Failed to create chat message" });
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      mockDbTaskFindFirst.mockResolvedValue(createMockTask());
      mockDbUserFindUnique.mockResolvedValue(createMockUser());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbChatMessageCreate.mockResolvedValue(createMockChatMessage());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockStakworkResponse(),
      } as Response);
    });

    it("should handle task without swarm", async () => {
      const taskWithoutSwarm = createMockTask({
        workspace: {
          ownerId: "user-123",
          swarm: null,
          members: [],
        },
      });
      mockDbTaskFindFirst.mockResolvedValue(taskWithoutSwarm);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_params.set_var.attributes.vars.swarmUrl).toBe("");
      expect(payload.workflow_params.set_var.attributes.vars.swarmSecretAlias).toBeNull();
    });

    it("should allow workspace member access", async () => {
      const taskWithMember = createMockTask({
        workspace: {
          ownerId: "different-user-id",
          swarm: createMockSwarm(),
          members: [{ role: "DEVELOPER" }],
        },
      });
      mockDbTaskFindFirst.mockResolvedValue(taskWithMember);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
    });

    it("should handle very long message content", async () => {
      const longMessage = "a".repeat(10000);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ message: longMessage }),
      });

      expect(result.status).toBe(201);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_params.set_var.attributes.vars.message).toBe(longMessage);
    });

    it("should handle special characters in message", async () => {
      const specialMessage = "Test with 🚀 emojis and special chars: àáâäåæçèéêë & <html> tags";

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ message: specialMessage }),
      });

      expect(result.status).toBe(201);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_params.set_var.attributes.vars.message).toBe(specialMessage);
    });

    it("should handle undefined poolName (fallback to swarm.id)", async () => {
      const taskWithPoolNameNull = createMockTask({
        workspace: {
          ownerId: "user-123",
          swarm: { ...createMockSwarm(), poolName: null, id: "swarm-fallback-id" },
          members: [],
        },
      });
      mockDbTaskFindFirst.mockResolvedValue(taskWithPoolNameNull);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_params.set_var.attributes.vars.poolName).toBe("swarm-fallback-id");
    });
  });
});