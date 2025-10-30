import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import type { ContextTag } from "@/lib/chat";

// Use shared environment mock
import "@/__tests__/support/mocks/env";
import { config } from "@/lib/env";

/**
 * Isolated callStakwork function for unit testing
 * This is extracted from src/app/api/chat/message/route.ts
 * for testing in isolation with mocked dependencies
 */

interface StakworkWorkflowPayload {
  name: string;
  workflow_id: number;
  webhook_url?: string;
  workflow_params: {
    set_var: {
      attributes: {
        vars: Record<string, unknown>;
      };
    };
  };
}

// Mock implementations that will be used by the extracted function
const mockGetBaseUrl = vi.fn();
const mockGetS3Service = vi.fn();

async function callStakwork(
  taskId: string,
  message: string,
  contextTags: ContextTag[],
  userName: string | null,
  accessToken: string | null,
  swarmUrl: string | null,
  swarmSecretAlias: string | null,
  poolName: string | null,
  request: NextRequest,
  repo2GraphUrl: string,
  attachmentPaths: string[] = [],
  webhook?: string,
  mode?: string,
  history?: Record<string, unknown>[],
  workspaceId?: string,
) {
  try {
    // Validate that all required Stakwork environment variables are set
    if (!config.STAKWORK_API_KEY) {
      throw new Error("STAKWORK_API_KEY is required for Stakwork integration");
    }
    if (!config.STAKWORK_WORKFLOW_ID) {
      throw new Error("STAKWORK_WORKFLOW_ID is required for Stakwork integration");
    }

    const baseUrl = mockGetBaseUrl(request?.headers?.get("host"));
    let webhookUrl = `${baseUrl}/api/chat/response`;
    if (process.env.CUSTOM_WEBHOOK_URL) {
      webhookUrl = process.env.CUSTOM_WEBHOOK_URL;
    }

    // New webhook URL for workflow status updates
    const workflowWebhookUrl = `${baseUrl}/api/stakwork/webhook?task_id=${taskId}`;

    // Generate presigned URLs for attachments
    const s3Service = mockGetS3Service();
    const attachmentUrls = await Promise.all(
      attachmentPaths.map((path) => s3Service.generatePresignedDownloadUrl(path)),
    );

    // stakwork workflow vars
    const vars = {
      taskId,
      message,
      contextTags,
      webhookUrl,
      alias: userName,
      username: userName,
      accessToken,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2graph_url: repo2GraphUrl,
      attachments: attachmentUrls,
      taskMode: mode,
      history: history || [],
      workspaceId,
    };

    const stakworkWorkflowIds = config.STAKWORK_WORKFLOW_ID.split(",");

    let workflowId: string;
    if (mode === "live") {
      workflowId = stakworkWorkflowIds[0];
    } else if (mode === "unit") {
      workflowId = stakworkWorkflowIds[2];
    } else if (mode === "integration") {
      workflowId = stakworkWorkflowIds[2];
    } else {
      workflowId = stakworkWorkflowIds[1]; // default to test mode
    }

    const stakworkPayload: StakworkWorkflowPayload = {
      name: "hive_autogen",
      workflow_id: parseInt(workflowId),
      webhook_url: workflowWebhookUrl,
      workflow_params: {
        set_var: {
          attributes: {
            vars,
          },
        },
      },
    };

    const stakworkURL = webhook || `${config.STAKWORK_BASE_URL}/projects`;

    const response = await fetch(stakworkURL, {
      method: "POST",
      body: JSON.stringify(stakworkPayload),
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`Failed to send message to Stakwork: ${response.statusText}`);
      return { success: false, error: response.statusText };
    }

    const result = await response.json();
    return { success: result.success, data: result.data };
  } catch (error) {
    console.error("Error calling Stakwork:", error);
    return { success: false, error: String(error) };
  }
}

describe("callStakwork (Chat Message API) - Unit Tests", () => {
  let fetchSpy: any;
  let consoleErrorSpy: any;
  let mockRequest: Partial<NextRequest>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock console.error to prevent test output pollution
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Mock NextRequest
    mockRequest = {
      headers: {
        get: vi.fn().mockReturnValue("localhost:3000"),
      } as any,
    };

    // Mock getBaseUrl
    mockGetBaseUrl.mockReturnValue("http://localhost:3000");

    // Mock S3Service
    mockGetS3Service.mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.amazonaws.com/presigned-url"),
    });

    // Mock successful fetch by default
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          workflow_id: 12345,
          status: "queued",
          project_id: 67890,
        },
      }),
      statusText: "OK",
    } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe("Environment Variable Validation", () => {
    it("should throw error when STAKWORK_API_KEY is missing", async () => {
      const originalApiKey = config.STAKWORK_API_KEY;
      (config as any).STAKWORK_API_KEY = "";

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "github-token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_API_KEY is required");

      (config as any).STAKWORK_API_KEY = originalApiKey;
    });

    it("should throw error when STAKWORK_WORKFLOW_ID is missing", async () => {
      const originalWorkflowId = config.STAKWORK_WORKFLOW_ID;
      (config as any).STAKWORK_WORKFLOW_ID = "";

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "github-token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_WORKFLOW_ID is required");

      (config as any).STAKWORK_WORKFLOW_ID = originalWorkflowId;
    });

    it("should validate workflow ID is not empty string", async () => {
      const originalWorkflowId = config.STAKWORK_WORKFLOW_ID;
      (config as any).STAKWORK_WORKFLOW_ID = "";

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "github-token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_WORKFLOW_ID is required");

      (config as any).STAKWORK_WORKFLOW_ID = originalWorkflowId;
    });
  });

  describe("Payload Construction", () => {
    it("should construct correct payload with all 14 parameters", async () => {
      const testParams = {
        taskId: "task-abc-123",
        message: "User sent a chat message",
        contextTags: [{ type: "file", value: "src/app.ts" }] as ContextTag[],
        userName: "test-user",
        accessToken: "github-token-456",
        swarmUrl: "https://test-swarm.com/api",
        swarmSecretAlias: "{{SWARM_API_KEY}}",
        poolName: "test-pool",
        repo2GraphUrl: "https://test-swarm.com:3355",
        attachmentPaths: ["uploads/file1.png", "uploads/file2.pdf"],
        webhook: undefined,
        mode: "live",
        history: [{ id: "msg-1", message: "Previous message", role: "USER" }],
      };

      await callStakwork(
        testParams.taskId,
        testParams.message,
        testParams.contextTags,
        testParams.userName,
        testParams.accessToken,
        testParams.swarmUrl,
        testParams.swarmSecretAlias,
        testParams.poolName,
        mockRequest as NextRequest,
        testParams.repo2GraphUrl,
        testParams.attachmentPaths,
        testParams.webhook,
        testParams.mode,
        testParams.history,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];

      expect(url).toBe("https://api.stakwork.com/api/v1/projects");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({
        Authorization: "Token token=test-api-key",
        "Content-Type": "application/json",
      });

      const payload = JSON.parse(options.body);
      expect(payload).toMatchObject({
        name: "hive_autogen",
        workflow_id: 111, // First workflow ID from comma-separated list for 'live' mode
        webhook_url: `http://localhost:3000/api/stakwork/webhook?task_id=${testParams.taskId}`,
        workflow_params: {
          set_var: {
            attributes: {
              vars: {
                taskId: testParams.taskId,
                message: testParams.message,
                contextTags: testParams.contextTags,
                webhookUrl: "http://localhost:3000/api/chat/response",
                alias: testParams.userName,
                username: testParams.userName,
                accessToken: testParams.accessToken,
                swarmUrl: testParams.swarmUrl,
                swarmSecretAlias: testParams.swarmSecretAlias,
                poolName: testParams.poolName,
                repo2graph_url: testParams.repo2GraphUrl,
                attachments: ["https://s3.amazonaws.com/presigned-url", "https://s3.amazonaws.com/presigned-url"],
                taskMode: testParams.mode,
                history: testParams.history,
              },
            },
          },
        },
      });
    });

    it("should handle null GitHub credentials in payload", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        null,
        null,
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.username).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.accessToken).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.alias).toBeNull();
    });

    it("should handle null swarm parameters in payload", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        null,
        null,
        null,
        mockRequest as NextRequest,
        "",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.swarmUrl).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.swarmSecretAlias).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.poolName).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.repo2graph_url).toBe("");
    });

    it("should include contextTags array in payload", async () => {
      const contextTags: ContextTag[] = [
        { type: "file", value: "src/index.ts" },
        { type: "function", value: "handleSubmit" },
      ];

      await callStakwork(
        "task-123",
        "Test message",
        contextTags,
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.contextTags).toEqual(contextTags);
    });

    it("should include empty history array when not provided", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
        undefined,
        undefined,
        undefined,
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.history).toEqual([]);
    });

    it("should include workflow name as hive_autogen", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.name).toBe("hive_autogen");
    });

    it("should include workspaceId in payload when provided", async () => {
      const workspaceId = "workspace-test-123";

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
        undefined,
        undefined,
        undefined,
        workspaceId,
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.workspaceId).toBe(workspaceId);
    });

    it("should handle undefined workspaceId in payload", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
        undefined,
        undefined,
        undefined,
        undefined,
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.workspaceId).toBeUndefined();
    });
  });

  describe("Mode-Based Workflow ID Selection", () => {
    it("should select first workflow ID for 'live' mode", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
        undefined,
        "live",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_id).toBe(111); // First ID from "111,222,333"
    });

    it("should select third workflow ID for 'unit' mode", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
        undefined,
        "unit",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_id).toBe(333); // Third ID from "111,222,333"
    });

    it("should select third workflow ID for 'integration' mode", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
        undefined,
        "integration",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_id).toBe(333); // Third ID from "111,222,333"
    });

    it("should select second workflow ID for default/test mode", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
        undefined,
        undefined,
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_id).toBe(222); // Second ID from "111,222,333" (default)
    });

    it("should parse workflow ID as integer", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(typeof payload.workflow_id).toBe("number");
    });
  });

  describe("Webhook URL Generation", () => {
    it("should generate correct webhook URL with taskId", async () => {
      const taskId = "task-xyz-789";

      await callStakwork(
        taskId,
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.webhook_url).toBe(`http://localhost:3000/api/stakwork/webhook?task_id=${taskId}`);
    });

    it("should use base URL from request headers", async () => {
      mockGetBaseUrl.mockReturnValue("https://production.com");

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.webhook_url).toContain("https://production.com");
      expect(payload.workflow_params.set_var.attributes.vars.webhookUrl).toBe(
        "https://production.com/api/chat/response",
      );
    });

    it("should override webhookUrl with CUSTOM_WEBHOOK_URL env var", async () => {
      const originalCustomWebhook = process.env.CUSTOM_WEBHOOK_URL;
      process.env.CUSTOM_WEBHOOK_URL = "https://custom-webhook.com/callback";

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.webhookUrl).toBe(
        "https://custom-webhook.com/callback",
      );

      if (originalCustomWebhook) {
        process.env.CUSTOM_WEBHOOK_URL = originalCustomWebhook;
      } else {
        delete process.env.CUSTOM_WEBHOOK_URL;
      }
    });
  });

  describe("Attachment Handling", () => {
    it("should generate presigned URLs for attachments", async () => {
      const attachmentPaths = ["uploads/workspace-1/task-1/file1.png", "uploads/workspace-1/task-1/file2.pdf"];

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        attachmentPaths,
      );

      const s3Service = mockGetS3Service();
      expect(s3Service.generatePresignedDownloadUrl).toHaveBeenCalledTimes(2);
      expect(s3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(attachmentPaths[0]);
      expect(s3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(attachmentPaths[1]);
    });

    it("should include presigned URLs in payload attachments", async () => {
      const mockS3Service = {
        generatePresignedDownloadUrl: vi
          .fn()
          .mockResolvedValueOnce("https://s3.amazonaws.com/presigned-url-1")
          .mockResolvedValueOnce("https://s3.amazonaws.com/presigned-url-2"),
      };
      mockGetS3Service.mockReturnValue(mockS3Service);

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        ["uploads/file1.png", "uploads/file2.pdf"],
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.attachments).toEqual([
        "https://s3.amazonaws.com/presigned-url-1",
        "https://s3.amazonaws.com/presigned-url-2",
      ]);
    });

    it("should handle empty attachments array", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.attachments).toEqual([]);

      const s3Service = mockGetS3Service();
      expect(s3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it("should handle attachments with special characters in paths", async () => {
      const specialPath = "uploads/workspace-1/task-1/file with spaces & special.pdf";

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [specialPath],
      );

      const s3Service = mockGetS3Service();
      expect(s3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(specialPath);
    });
  });

  describe("History Array Handling", () => {
    it("should include chat history in payload", async () => {
      const history = [
        { id: "msg-1", message: "First message", role: "USER", timestamp: "2024-01-01T00:00:00Z" },
        { id: "msg-2", message: "Second message", role: "ASSISTANT", timestamp: "2024-01-01T00:01:00Z" },
      ];

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
        undefined,
        undefined,
        history,
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.history).toEqual(history);
    });

    it("should handle empty history array", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
        undefined,
        undefined,
        [],
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.history).toEqual([]);
    });

    it("should handle large chat history arrays", async () => {
      const largeHistory = Array.from({ length: 100 }, (_, i) => ({
        id: `msg-${i}`,
        message: `Message ${i}`,
        role: i % 2 === 0 ? "USER" : "ASSISTANT",
      }));

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
        undefined,
        undefined,
        largeHistory,
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.history).toHaveLength(100);
    });
  });

  describe("Successful API Responses", () => {
    it("should return success with workflow data when API responds successfully", async () => {
      const mockResponse = {
        workflow_id: 12345,
        status: "queued",
        project_id: 67890,
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockResponse,
        }),
        statusText: "OK",
      } as Response);

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
    });

    it("should handle API response with nested success flag", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          data: null,
        }),
        statusText: "OK",
      } as Response);

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
    });

    it("should propagate project_id from successful API response", async () => {
      const mockData = {
        workflow_id: 99999,
        status: "running",
        project_id: 11111,
        custom_field: "test-value",
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockData,
        }),
        statusText: "OK",
      } as Response);

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.data).toEqual(mockData);
      expect(result.data?.project_id).toBe(11111);
    });
  });

  describe("Failed API Responses", () => {
    it("should return error when API response is not ok", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
        json: async () => ({ error: "Workflow execution failed" }),
      } as Response);

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Internal Server Error");
      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to send message to Stakwork: Internal Server Error");
    });

    it("should handle 401 Unauthorized response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: "Unauthorized",
        json: async () => ({ error: "Invalid API key" }),
      } as Response);

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unauthorized");
    });

    it("should handle 404 Not Found response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: "Not Found",
        json: async () => ({ error: "Workflow not found" }),
      } as Response);

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not Found");
    });

    it("should handle 500 Internal Server Error response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
        json: async () => ({ error: "Database connection failed" }),
      } as Response);

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Internal Server Error");
    });
  });

  describe("Network Errors", () => {
    it("should handle network error during fetch", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error calling Stakwork:", expect.any(Error));
    });

    it("should handle timeout error", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Request timeout"));

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Request timeout");
    });

    it("should handle DNS resolution error", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("ENOTFOUND: DNS lookup failed"));

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("DNS lookup failed");
    });

    it("should handle JSON parsing error in response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
        statusText: "OK",
      } as Response);

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid JSON");
    });

    it("should handle S3 presigned URL generation failure", async () => {
      const mockS3Service = {
        generatePresignedDownloadUrl: vi.fn().mockRejectedValue(new Error("S3 access denied")),
      };
      mockGetS3Service.mockReturnValue(mockS3Service);

      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        ["uploads/file1.png"],
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("S3 access denied");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty message string", async () => {
      const result = await callStakwork(
        "task-123",
        "",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(true);
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.message).toBe("");
    });

    it("should handle very long message", async () => {
      const longMessage = "A".repeat(10000);

      const result = await callStakwork(
        "task-123",
        longMessage,
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(true);
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.message).toBe(longMessage);
    });

    it("should handle special characters in message", async () => {
      const messageWithSpecialChars = "Test <script>alert('xss')</script> & special chars: ü ñ 中文";

      const result = await callStakwork(
        "task-123",
        messageWithSpecialChars,
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(true);
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.message).toBe(messageWithSpecialChars);
    });

    it("should handle Unicode characters in URLs", async () => {
      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://тест.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://тест.com:3355",
      );

      expect(result.success).toBe(true);
    });

    it("should handle empty repo2GraphUrl", async () => {
      const result = await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "",
      );

      expect(result.success).toBe(true);
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.repo2graph_url).toBe("");
    });

    it("should handle large contextTags array", async () => {
      const largeContextTags: ContextTag[] = Array.from({ length: 50 }, (_, i) => ({
        type: "file",
        value: `src/file-${i}.ts`,
      }));

      const result = await callStakwork(
        "task-123",
        "Test message",
        largeContextTags,
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(true);
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.contextTags).toHaveLength(50);
    });

    it("should handle empty taskId", async () => {
      const result = await callStakwork(
        "",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(result.success).toBe(true);
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.taskId).toBe("");
      expect(payload.webhook_url).toContain("task_id=");
    });
  });

  describe("Authorization Header", () => {
    it("should include correct authorization header format", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers.Authorization).toBe("Token token=test-api-key");
    });

    it("should use API key from config", async () => {
      const originalApiKey = config.STAKWORK_API_KEY;
      (config as any).STAKWORK_API_KEY = "custom-api-key-123";

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers.Authorization).toBe("Token token=custom-api-key-123");

      (config as any).STAKWORK_API_KEY = originalApiKey;
    });

    it("should include Content-Type application/json header", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("URL Construction", () => {
    it("should construct correct Stakwork API URL", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.stakwork.com/api/v1/projects");
    });

    it("should use base URL from config", async () => {
      const originalBaseUrl = config.STAKWORK_BASE_URL;
      (config as any).STAKWORK_BASE_URL = "https://custom-stakwork.com/v2";

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://custom-stakwork.com/v2/projects");

      (config as any).STAKWORK_BASE_URL = originalBaseUrl;
    });

    it("should use custom webhook URL when provided", async () => {
      const customWebhook = "https://custom-webhook.com/api/callback";

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
        [],
        customWebhook,
      );

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe(customWebhook);
    });
  });

  describe("Error Logging", () => {
    it("should log error when API response is not ok", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Request",
        json: async () => ({ error: "Invalid workflow" }),
      } as Response);

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to send message to Stakwork: Bad Request");
    });

    it("should log error when exception is thrown", async () => {
      const testError = new Error("Test error");
      fetchSpy.mockRejectedValueOnce(testError);

      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith("Error calling Stakwork:", testError);
    });

    it("should not log sensitive data in errors", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("API call failed"));

      await callStakwork(
        "task-123",
        "Test message with sensitive data",
        [],
        "testuser",
        "github-pat-secret-token",
        "https://swarm.com/api",
        "{{SUPER_SECRET_KEY}}",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0];
      expect(errorCall[0]).not.toContain("github-pat-secret-token");
      expect(errorCall[0]).not.toContain("SUPER_SECRET_KEY");
    });
  });

  describe("Request Body Validation", () => {
    it("should send POST request with correct method", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.method).toBe("POST");
    });

    it("should stringify payload as JSON", async () => {
      await callStakwork(
        "task-123",
        "Test message",
        [],
        "testuser",
        "token",
        "https://swarm.com/api",
        "secret-alias",
        "pool-name",
        mockRequest as NextRequest,
        "https://swarm.com:3355",
      );

      const [, options] = fetchSpy.mock.calls[0];
      expect(typeof options.body).toBe("string");
      expect(() => JSON.parse(options.body)).not.toThrow();
    });
  });
});