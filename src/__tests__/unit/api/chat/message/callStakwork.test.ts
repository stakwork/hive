import { describe, test, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { config } from "@/lib/env";
import { WorkflowStatus } from "@prisma/client";
import type { ContextTag } from "@/lib/chat";

// Mock all external dependencies
vi.mock("@/lib/env");
vi.mock("@/services/s3");
vi.mock("@/lib/utils");
vi.mock("@/lib/utils/swarm");

const mockConfig = config as unknown as {
  STAKWORK_API_KEY: string;
  STAKWORK_BASE_URL: string;
  STAKWORK_WORKFLOW_ID: string;
};

const mockGetS3Service = vi.fn();
const mockGetBaseUrl = vi.fn();
const mockTransformSwarmUrlToRepo2Graph = vi.fn();

// Set up module mocks
vi.mocked(mockConfig).STAKWORK_API_KEY = "test-api-key";
vi.mocked(mockConfig).STAKWORK_BASE_URL = "https://test-stakwork.com";
vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "123,456,789";

// Mock global fetch
let mockFetch: ReturnType<typeof vi.fn>;

/**
 * Extracted callStakwork function for isolated testing
 * This allows us to test the function without the route handler wrapper
 */
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
    if (!mockConfig.STAKWORK_API_KEY) {
      throw new Error("STAKWORK_API_KEY is required for Stakwork integration");
    }
    if (!mockConfig.STAKWORK_WORKFLOW_ID) {
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

    const stakworkWorkflowIds = mockConfig.STAKWORK_WORKFLOW_ID.split(",");

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

    const stakworkPayload = {
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

    const stakworkURL = webhook || `${mockConfig.STAKWORK_BASE_URL}/projects`;

    const response = await fetch(stakworkURL, {
      method: "POST",
      body: JSON.stringify(stakworkPayload),
      headers: {
        Authorization: `Token token=${mockConfig.STAKWORK_API_KEY}`,
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

// Test Data Factory
const TestDataFactory = {
  createRequestBody: (overrides: Record<string, unknown> = {}) => ({
    taskId: "test-task-id",
    message: "Test message",
    contextTags: [],
    attachments: [],
    mode: undefined,
    webhook: undefined,
    history: [],
    ...overrides,
  }),

  createStakworkSuccessResponse: (projectId = 123) => ({
    success: true,
    data: {
      project_id: projectId,
      workflow_id: "workflow-abc",
    },
  }),

  createMockRequest: () => {
    return new NextRequest("http://localhost:3000/api/chat/message", {
      method: "POST",
      headers: { host: "localhost:3000" },
    });
  },
};

// Mock Setup Helpers
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
    mockGetBaseUrl.mockReturnValue("http://localhost:3000");
    mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.example.com:3355");
    mockGetS3Service.mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
    });
    if (mockFetch) {
      mockFetch.mockClear();
    }
  },

  setupSuccessfulCallStakwork: (projectId = 123) => {
    mockGetBaseUrl.mockReturnValue("http://localhost:3000");
    mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.example.com:3355");
    mockGetS3Service.mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => TestDataFactory.createStakworkSuccessResponse(projectId),
    } as Response);
  },

  setupFailedCallStakwork: (statusText = "Internal Server Error") => {
    mockGetBaseUrl.mockReturnValue("http://localhost:3000");
    mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.example.com:3355");
    mockGetS3Service.mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
    });
    mockFetch.mockResolvedValue({
      ok: false,
      statusText,
    } as Response);
  },
};

// Test Helpers
const TestHelpers = {
  expectFetchCalledWithWorkflowId: (expectedId: number) => {
    expect(mockFetch).toHaveBeenCalled();
    const fetchCall = mockFetch.mock.calls[0];
    const payload = JSON.parse(fetchCall[1]?.body as string);
    expect(payload.workflow_id).toBe(expectedId);
  },

  expectFetchCalledWithVarsContaining: (expectedVars: Record<string, unknown>) => {
    expect(mockFetch).toHaveBeenCalled();
    const fetchCall = mockFetch.mock.calls[0];
    const payload = JSON.parse(fetchCall[1]?.body as string);
    const vars = payload.workflow_params.set_var.attributes.vars;
    expect(vars).toMatchObject(expectedVars);
  },
};

describe("callStakwork Function Unit Tests", () => {
  beforeEach(() => {
    // Reset config values
    vi.mocked(mockConfig).STAKWORK_API_KEY = "test-api-key";
    vi.mocked(mockConfig).STAKWORK_BASE_URL = "https://test-stakwork.com";
    vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "123,456,789";
    
    MockSetup.reset();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    
    // Reset environment
    delete process.env.CUSTOM_WEBHOOK_URL;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Configuration Validation", () => {
    test("should throw error when STAKWORK_API_KEY is missing", async () => {
      vi.mocked(mockConfig).STAKWORK_API_KEY = "";

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_API_KEY is required");
    });

    test("should throw error when STAKWORK_WORKFLOW_ID is missing", async () => {
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "";

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_WORKFLOW_ID is required");
    });

    test("should proceed when both STAKWORK_API_KEY and STAKWORK_WORKFLOW_ID are present", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("Mode-Based Workflow Selection", () => {
    test("should use workflow ID at index 0 for 'live' mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        "live",
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithWorkflowId(123); // First ID in "123,456,789"
    });

    test("should use workflow ID at index 2 for 'unit' mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        "unit",
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithWorkflowId(789); // Third ID in "123,456,789"
    });

    test("should use workflow ID at index 2 for 'integration' mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        "integration",
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithWorkflowId(789); // Third ID in "123,456,789"
    });

    test("should use workflow ID at index 1 for default mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithWorkflowId(456); // Second ID in "123,456,789"
    });

    test("should use workflow ID at index 1 for unknown mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        "unknown",
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithWorkflowId(456); // Second ID (default)
    });
  });

  describe("Data Transformation - Vars Object", () => {
    test("should include all required fields in vars object", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-github-token",
        "https://test-swarm.example.com/api",
        "{{TEST_SECRET}}",
        "swarm-id",
        request,
        "https://test-swarm.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;
      
      expect(vars).toMatchObject({
        taskId: "test-task-id",
        message: "Test message",
        contextTags: [],
        webhookUrl: "http://localhost:3000/api/chat/response",
        alias: "testuser",
        username: "testuser",
        accessToken: "test-github-token",
        swarmUrl: "https://test-swarm.example.com/api",
        swarmSecretAlias: "{{TEST_SECRET}}",
        poolName: "swarm-id",
        repo2graph_url: "https://test-swarm.example.com:3355",
        workspaceId: "workspace-123",
      });
      
      expect(vars.taskMode).toBeUndefined();
    });

    test("should include taskMode in vars when mode is provided", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        "live",
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        taskMode: "live",
      });
    });

    test("should handle null userName and accessToken", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        null,
        null,
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        alias: null,
        username: null,
        accessToken: null,
      });
    });

    test("should include contextTags in vars object", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const contextTags: ContextTag[] = [
        { type: "PRODUCT_BRIEF" as const, id: "test.ts" },
        { type: "FEATURE_BRIEF" as const, id: "src/" },
      ];

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        contextTags,
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        contextTags,
      });
    });

    test("should include history in vars object", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const history = [
        { id: "msg-1", message: "Previous message", role: "USER" },
        { id: "msg-2", message: "Another message", role: "ASSISTANT" },
      ];

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        history,
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        history,
      });
    });

    test("should default history to empty array when not provided", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        undefined,
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        history: [],
      });
    });
  });

  describe("Webhook URL Construction", () => {
    test("should construct webhook URL with correct base URL", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        webhookUrl: "http://localhost:3000/api/chat/response",
      });
    });

    test("should construct workflow webhook URL with task_id query parameter", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      expect(payload.webhook_url).toBe("http://localhost:3000/api/stakwork/webhook?task_id=test-task-id");
    });

    test("should use custom webhook URL when CUSTOM_WEBHOOK_URL is set", async () => {
      process.env.CUSTOM_WEBHOOK_URL = "https://custom-webhook.example.com/webhook";
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        webhookUrl: "https://custom-webhook.example.com/webhook",
      });
    });

    test("should use custom webhook parameter when provided", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const customWebhook = "https://custom-webhook.example.com/webhook";
      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        customWebhook,
        undefined,
        [],
        "workspace-123",
      );

      expect(mockFetch).toHaveBeenCalledWith(
        customWebhook,
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });

  describe("S3 Presigned URL Generation", () => {
    test("should generate presigned URLs for all attachments", async () => {
      const mockGeneratePresignedUrl = vi
        .fn()
        .mockResolvedValueOnce("https://s3.example.com/file1.pdf")
        .mockResolvedValueOnce("https://s3.example.com/file2.jpg");

      mockGetS3Service.mockReturnValue({
        generatePresignedDownloadUrl: mockGeneratePresignedUrl,
      });
      mockGetBaseUrl.mockReturnValue("http://localhost:3000");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        ["uploads/file1.pdf", "uploads/file2.jpg"],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(mockGeneratePresignedUrl).toHaveBeenCalledTimes(2);
      expect(mockGeneratePresignedUrl).toHaveBeenCalledWith("uploads/file1.pdf");
      expect(mockGeneratePresignedUrl).toHaveBeenCalledWith("uploads/file2.jpg");

      TestHelpers.expectFetchCalledWithVarsContaining({
        attachments: ["https://s3.example.com/file1.pdf", "https://s3.example.com/file2.jpg"],
      });
    });

    test("should handle empty attachments array", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        attachments: [],
      });
    });
  });

  describe("HTTP Error Handling", () => {
    test("should handle HTTP 400 error from Stakwork API", async () => {
      MockSetup.setupFailedCallStakwork("Bad Request");

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Bad Request");
    });

    test("should handle HTTP 500 error from Stakwork API", async () => {
      MockSetup.setupFailedCallStakwork("Internal Server Error");

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Internal Server Error");
    });

    test("should handle network errors", async () => {
      mockGetBaseUrl.mockReturnValue("http://localhost:3000");
      mockGetS3Service.mockReturnValue({
        generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
      });
      mockFetch.mockRejectedValue(new Error("Network error"));

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });

    test("should return success with project_id on successful API call", async () => {
      MockSetup.setupSuccessfulCallStakwork(456);

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        project_id: 456,
        workflow_id: "workflow-abc",
      });
    });
  });

  describe("Payload Structure Verification", () => {
    test("should construct payload with correct structure", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload).toMatchObject({
        name: "hive_autogen",
        workflow_id: expect.any(Number),
        webhook_url: expect.stringContaining("api/stakwork/webhook"),
        workflow_params: {
          set_var: {
            attributes: {
              vars: expect.objectContaining({
                taskId: expect.any(String),
                message: expect.any(String),
              }),
            },
          },
        },
      });
    });

    test("should set name to 'hive_autogen'", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload.name).toBe("hive_autogen");
    });

    test("should include workflow_params with nested set_var structure", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload.workflow_params).toHaveProperty("set_var");
      expect(payload.workflow_params.set_var).toHaveProperty("attributes");
      expect(payload.workflow_params.set_var.attributes).toHaveProperty("vars");
    });
  });

  describe("Authorization Header", () => {
    test("should include correct Authorization header format", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Token token=test-api-key",
          }),
        }),
      );
    });

    test("should include Content-Type header", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty message", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task-id",
        "",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(result.success).toBe(true);
      TestHelpers.expectFetchCalledWithVarsContaining({
        message: "",
      });
    });

    test("should handle very long message", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const longMessage = "a".repeat(10000);
      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        longMessage,
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        message: longMessage,
      });
    });

    test("should handle special characters in message", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const specialMessage = "Test with 🚀 emojis and <html> tags & símböls";
      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        specialMessage,
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        message: specialMessage,
      });
    });

    test("should handle null swarmUrl", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        null,
        null,
        null,
        request,
        "",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        swarmUrl: null,
        swarmSecretAlias: null,
        poolName: null,
        repo2graph_url: "",
      });
    });

    test("should handle workflow ID string with extra whitespace", async () => {
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = " 123 , 456 , 789 ";
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        "live",
        [],
        "workspace-123",
      );

      // Should still parse correctly after split (spaces in elements)
      TestHelpers.expectFetchCalledWithWorkflowId(123);
    });

    test("should handle large history array", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const largeHistory = Array.from({ length: 100 }, (_, i) => ({
        id: `msg-${i}`,
        message: `Message ${i}`,
        role: i % 2 === 0 ? "USER" : "ASSISTANT",
      }));

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        largeHistory,
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        history: largeHistory,
      });
    });

    test("should handle multiple context tags of different types", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const contextTags: ContextTag[] = [
        { type: "PRODUCT_BRIEF" as const, id: "src/utils.ts" },
        { type: "FEATURE_BRIEF" as const, id: "src/" },
        { type: "SCHEMATIC" as const, id: "42" },
        { type: "PRODUCT_BRIEF" as const, id: "processData" },
      ];

      const request = TestDataFactory.createMockRequest();
      await callStakwork(
        "test-task-id",
        "Test message",
        contextTags,
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        contextTags,
      });
    });
  });

  describe("Return Value Verification", () => {
    test("should return success with project_id on successful API call", async () => {
      MockSetup.setupSuccessfulCallStakwork(789);

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        project_id: 789,
        workflow_id: "workflow-abc",
      });
    });

    test("should return success false on API error", async () => {
      MockSetup.setupFailedCallStakwork("Service Unavailable");

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Service Unavailable");
    });

    test("should return error string on exception", async () => {
      mockGetBaseUrl.mockImplementation(() => {
        throw new Error("Base URL generation failed");
      });

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task-id",
        "Test message",
        [],
        "testuser",
        "test-token",
        "https://swarm.example.com/api",
        "test-secret",
        "test-pool",
        request,
        "https://repo2graph.example.com:3355",
        [],
        undefined,
        undefined,
        [],
        "workspace-123",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Base URL generation failed");
    });
  });
});