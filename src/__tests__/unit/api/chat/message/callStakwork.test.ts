import { describe, test, expect, beforeEach, vi, Mock } from "vitest";
import { NextRequest } from "next/server";

// Mock dependencies before imports
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://test-stakwork.example.com",
    STAKWORK_WORKFLOW_ID: "100,200,300", // live, default, unit/integration
  },
}));

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(),
}));

vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(),
}));

// Import after mocks are set up
import { config } from "@/config/env";
import { getS3Service } from "@/services/s3";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { getBaseUrl } from "@/lib/utils";

// Get mocked instances
const mockGetS3Service = vi.mocked(getS3Service);
const mockTransformSwarmUrlToRepo2Graph = vi.mocked(transformSwarmUrlToRepo2Graph);
const mockGetBaseUrl = vi.mocked(getBaseUrl);
const mockFetch = vi.fn() as Mock;

// Set global fetch
global.fetch = mockFetch;

// Import the function to test (inline for testing purposes)
// In actual implementation, this would be extracted to a testable module
async function callStakwork(
  taskId: string,
  message: string,
  contextTags: Array<{ type: string; value: string }>,
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

    const baseUrl = getBaseUrl(request?.headers.get("host"));
    let webhookUrl = `${baseUrl}/api/chat/response`;
    if (process.env.CUSTOM_WEBHOOK_URL) {
      webhookUrl = process.env.CUSTOM_WEBHOOK_URL;
    }

    // New webhook URL for workflow status updates
    const workflowWebhookUrl = `${baseUrl}/api/stakwork/webhook?task_id=${taskId}`;

    // Generate presigned URLs for attachments
    const attachmentUrls = await Promise.all(
      attachmentPaths.map((path) => getS3Service().generatePresignedDownloadUrl(path)),
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

/**
 * Test Data Factory
 * Creates standardized mock data for tests
 */
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

  createStakworkErrorResponse: (statusText = "Internal Server Error") => ({
    success: false,
    error: statusText,
  }),

  createMockRequest: () => {
    return new NextRequest("http://localhost:3000/api/chat/message", {
      method: "POST",
      headers: { host: "localhost:3000" },
    });
  },

  createContextTags: () => [
    { type: "file", value: "src/app/api/test.ts" },
    { type: "function", value: "testFunction" },
  ],

  createAttachmentPaths: () => [
    "attachments/test-file-1.pdf",
    "attachments/test-file-2.png",
  ],

  createMockHistory: () => [
    { role: "user", message: "Previous message 1" },
    { role: "assistant", message: "Previous response 1" },
  ],
};

/**
 * Mock Setup Helpers
 * Provides pre-configured mock states for common scenarios
 */
const MockSetup = {
  setupSuccessfulCallStakwork: (projectId = 123) => {
    mockGetBaseUrl.mockReturnValue("http://localhost:3000");
    mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.example.com:3355");
    mockGetS3Service.mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
    } as any);
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
    } as any);
    mockFetch.mockResolvedValue({
      ok: false,
      statusText,
    } as Response);
  },

  setupNetworkError: () => {
    mockGetBaseUrl.mockReturnValue("http://localhost:3000");
    mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.example.com:3355");
    mockGetS3Service.mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
    } as any);
    mockFetch.mockRejectedValue(new Error("Network error"));
  },

  reset: () => {
    vi.clearAllMocks();
    mockGetBaseUrl.mockReturnValue("http://localhost:3000");
    mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.example.com:3355");
    mockGetS3Service.mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
    } as any);
    if (mockFetch) {
      mockFetch.mockClear();
    }
  },
};

/**
 * Test Helpers
 * Provides reusable assertion and verification utilities
 */
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

  expectFetchCalledWithHeaders: (expectedHeaders: Record<string, string>) => {
    expect(mockFetch).toHaveBeenCalled();
    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1]?.headers;
    Object.entries(expectedHeaders).forEach(([key, value]) => {
      expect(headers[key]).toBe(value);
    });
  },

  expectFetchCalledWithUrl: (expectedUrl: string) => {
    expect(mockFetch).toHaveBeenCalled();
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe(expectedUrl);
  },

  expectS3PresignedUrlsGenerated: (count: number) => {
    if (count === 0) {
      // When count is 0, S3 service should not have been called at all
      expect(mockGetS3Service).not.toHaveBeenCalled();
    } else {
      const s3Service = mockGetS3Service.mock.results[0]?.value;
      expect(s3Service.generatePresignedDownloadUrl).toHaveBeenCalledTimes(count);
    }
  },
};

describe("callStakwork", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  describe("Configuration Validation", () => {
    test("throws error when STAKWORK_API_KEY is missing", async () => {
      // Temporarily override config
      const originalApiKey = config.STAKWORK_API_KEY;
      (config as any).STAKWORK_API_KEY = "";

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_API_KEY is required");

      // Restore config
      (config as any).STAKWORK_API_KEY = originalApiKey;
    });

    test("throws error when STAKWORK_WORKFLOW_ID is missing", async () => {
      // Temporarily override config
      const originalWorkflowId = config.STAKWORK_WORKFLOW_ID;
      (config as any).STAKWORK_WORKFLOW_ID = "";

      const request = TestDataFactory.createMockRequest();
      const result = await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_WORKFLOW_ID is required");

      // Restore config
      (config as any).STAKWORK_WORKFLOW_ID = originalWorkflowId;
    });

    test("uses correct API key in Authorization header", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      TestHelpers.expectFetchCalledWithHeaders({
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      });
    });
  });

  describe("Workflow Selection", () => {
    test("selects workflow ID index 0 for 'live' mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
        [],
        undefined,
        "live",
      );

      TestHelpers.expectFetchCalledWithWorkflowId(100); // First ID in "100,200,300"
    });

    test("selects workflow ID index 2 for 'unit' mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
        [],
        undefined,
        "unit",
      );

      TestHelpers.expectFetchCalledWithWorkflowId(300); // Third ID in "100,200,300"
    });

    test("selects workflow ID index 2 for 'integration' mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
        [],
        undefined,
        "integration",
      );

      TestHelpers.expectFetchCalledWithWorkflowId(300); // Third ID in "100,200,300"
    });

    test("defaults to workflow ID index 1 when mode is undefined", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      TestHelpers.expectFetchCalledWithWorkflowId(200); // Second ID in "100,200,300"
    });

    test("defaults to workflow ID index 1 for unrecognized mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
        [],
        undefined,
        "unknown-mode",
      );

      TestHelpers.expectFetchCalledWithWorkflowId(200); // Second ID in "100,200,300"
    });
  });

  describe("Data Transformation & Context Propagation", () => {
    test("includes all required vars in workflow payload", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();
      const contextTags = TestDataFactory.createContextTags();
      const history = TestDataFactory.createMockHistory();

      await callStakwork(
        "test-task-123",
        "test message content",
        contextTags,
        "github-user",
        "github-pat-token",
        "http://swarm.example.com",
        "swarm-secret-alias",
        "pool-name-123",
        request,
        "http://repo2graph.example.com:3355",
        [],
        undefined,
        "live",
        history,
        "workspace-456",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        taskId: "test-task-123",
        message: "test message content",
        contextTags,
        alias: "github-user",
        username: "github-user",
        accessToken: "github-pat-token",
        swarmUrl: "http://swarm.example.com",
        swarmSecretAlias: "swarm-secret-alias",
        poolName: "pool-name-123",
        repo2graph_url: "http://repo2graph.example.com:3355",
        taskMode: "live",
        history,
        workspaceId: "workspace-456",
      });
    });

    test("constructs correct webhook URLs", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      mockGetBaseUrl.mockReturnValue("https://app.example.com");
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "task-xyz",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        webhookUrl: "https://app.example.com/api/chat/response",
      });

      // Verify workflow webhook URL includes task_id parameter
      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      expect(payload.webhook_url).toBe("https://app.example.com/api/stakwork/webhook?task_id=task-xyz");
    });

    test("uses custom webhook URL from environment variable", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const originalCustomWebhook = process.env.CUSTOM_WEBHOOK_URL;
      process.env.CUSTOM_WEBHOOK_URL = "https://custom-webhook.example.com/callback";
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        webhookUrl: "https://custom-webhook.example.com/callback",
      });

      // Restore environment
      if (originalCustomWebhook) {
        process.env.CUSTOM_WEBHOOK_URL = originalCustomWebhook;
      } else {
        delete process.env.CUSTOM_WEBHOOK_URL;
      }
    });

    test("includes empty arrays for missing optional fields", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        contextTags: [],
        attachments: [],
        history: [],
      });
    });

    test("handles null values for optional parameters", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        null, // userName
        null, // accessToken
        null, // swarmUrl
        null, // swarmSecretAlias
        null, // poolName
        request,
        "http://repo2graph.example.com",
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        alias: null,
        username: null,
        accessToken: null,
        swarmUrl: null,
        swarmSecretAlias: null,
        poolName: null,
      });
    });
  });

  describe("S3 Integration", () => {
    test("generates presigned URLs for all attachments", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();
      const attachmentPaths = TestDataFactory.createAttachmentPaths();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
        attachmentPaths,
      );

      TestHelpers.expectS3PresignedUrlsGenerated(2);
    });

    test("includes presigned URLs in workflow vars", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();
      const attachmentPaths = ["file1.pdf", "file2.png"];

      mockGetS3Service.mockReturnValue({
        generatePresignedDownloadUrl: vi
          .fn()
          .mockResolvedValueOnce("https://s3.example.com/file1-presigned")
          .mockResolvedValueOnce("https://s3.example.com/file2-presigned"),
      } as any);

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
        attachmentPaths,
      );

      TestHelpers.expectFetchCalledWithVarsContaining({
        attachments: [
          "https://s3.example.com/file1-presigned",
          "https://s3.example.com/file2-presigned",
        ],
      });
    });

    test("handles empty attachment array", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
        [],
      );

      TestHelpers.expectS3PresignedUrlsGenerated(0);
      TestHelpers.expectFetchCalledWithVarsContaining({
        attachments: [],
      });
    });
  });

  describe("API Integration", () => {
    test("sends POST request to correct Stakwork endpoint", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      TestHelpers.expectFetchCalledWithUrl("https://test-stakwork.example.com/projects");
      expect(mockFetch.mock.calls[0][1]?.method).toBe("POST");
    });

    test("uses custom webhook URL when provided", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();
      const customWebhook = "https://custom-stakwork.example.com/api/projects";

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
        [],
        customWebhook,
      );

      TestHelpers.expectFetchCalledWithUrl(customWebhook);
    });

    test("includes correct payload structure", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload).toMatchObject({
        name: "hive_autogen",
        workflow_id: expect.any(Number),
        webhook_url: expect.stringContaining("/api/stakwork/webhook?task_id=test-task"),
        workflow_params: {
          set_var: {
            attributes: {
              vars: expect.any(Object),
            },
          },
        },
      });
    });

    test("returns success response with project data", async () => {
      MockSetup.setupSuccessfulCallStakwork(456);
      const request = TestDataFactory.createMockRequest();

      const result = await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result).toEqual({
        success: true,
        data: {
          project_id: 456,
          workflow_id: "workflow-abc",
        },
      });
    });
  });

  describe("Error Handling", () => {
    test("handles HTTP error responses gracefully", async () => {
      MockSetup.setupFailedCallStakwork("Service Unavailable");
      const request = TestDataFactory.createMockRequest();

      const result = await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result).toEqual({
        success: false,
        error: "Service Unavailable",
      });
    });

    test("handles network errors gracefully", async () => {
      MockSetup.setupNetworkError();
      const request = TestDataFactory.createMockRequest();

      const result = await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });

    test("handles 400 Bad Request errors", async () => {
      MockSetup.setupFailedCallStakwork("Bad Request");
      const request = TestDataFactory.createMockRequest();

      const result = await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result).toEqual({
        success: false,
        error: "Bad Request",
      });
    });

    test("handles 500 Internal Server Error", async () => {
      MockSetup.setupFailedCallStakwork("Internal Server Error");
      const request = TestDataFactory.createMockRequest();

      const result = await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result).toEqual({
        success: false,
        error: "Internal Server Error",
      });
    });

    test("handles malformed JSON response", async () => {
      mockGetBaseUrl.mockReturnValue("http://localhost:3000");
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.example.com:3355");
      mockGetS3Service.mockReturnValue({
        generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
      } as any);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Unexpected token in JSON");
        },
      } as Response);

      const request = TestDataFactory.createMockRequest();

      const result = await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unexpected token in JSON");
    });

    test("logs error to console on failure", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      MockSetup.setupFailedCallStakwork("Gateway Timeout");
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send message to Stakwork"),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    test("handles very long messages", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();
      const longMessage = "x".repeat(10000);

      const result = await callStakwork(
        "test-task",
        longMessage,
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result.success).toBe(true);
      TestHelpers.expectFetchCalledWithVarsContaining({
        message: longMessage,
      });
    });

    test("handles special characters in message", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();
      const specialMessage = 'Test message with "quotes", \\backslashes, and \nnewlines';

      const result = await callStakwork(
        "test-task",
        specialMessage,
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result.success).toBe(true);
      TestHelpers.expectFetchCalledWithVarsContaining({
        message: specialMessage,
      });
    });

    test("handles large number of context tags", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();
      const manyTags = Array.from({ length: 100 }, (_, i) => ({
        type: `type-${i}`,
        value: `value-${i}`,
      }));

      const result = await callStakwork(
        "test-task",
        "test message",
        manyTags,
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result.success).toBe(true);
      TestHelpers.expectFetchCalledWithVarsContaining({
        contextTags: manyTags,
      });
    });

    test("handles empty string message", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      const result = await callStakwork(
        "test-task",
        "",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result.success).toBe(true);
      TestHelpers.expectFetchCalledWithVarsContaining({
        message: "",
      });
    });

    test("handles very long task IDs", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();
      const longTaskId = "a".repeat(500);

      const result = await callStakwork(
        longTaskId,
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
      );

      expect(result.success).toBe(true);
      // Verify webhook URL includes the long task ID
      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      expect(payload.webhook_url).toContain(`task_id=${longTaskId}`);
    });

    test("handles large history arrays", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();
      const largeHistory = Array.from({ length: 100 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        message: `Message ${i}`,
      }));

      const result = await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
        [],
        undefined,
        undefined,
        largeHistory,
      );

      expect(result.success).toBe(true);
      TestHelpers.expectFetchCalledWithVarsContaining({
        history: largeHistory,
      });
    });
  });

  describe("Orchestration Flow", () => {
    test("executes steps in correct order: S3 URLs → vars construction → API call", async () => {
      const executionOrder: string[] = [];

      mockGetBaseUrl.mockImplementation((host) => {
        executionOrder.push("getBaseUrl");
        return "http://localhost:3000";
      });

      mockGetS3Service.mockImplementation(() => {
        executionOrder.push("getS3Service");
        return {
          generatePresignedDownloadUrl: vi.fn().mockImplementation(async () => {
            executionOrder.push("generatePresignedDownloadUrl");
            return "https://s3.example.com/presigned-url";
          }),
        } as any;
      });

      mockFetch.mockImplementation(async () => {
        executionOrder.push("fetch");
        return {
          ok: true,
          json: async () => TestDataFactory.createStakworkSuccessResponse(),
        } as Response;
      });

      const request = TestDataFactory.createMockRequest();
      const attachmentPaths = ["file1.pdf"];

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
        attachmentPaths,
      );

      expect(executionOrder).toEqual([
        "getBaseUrl",
        "getS3Service",
        "generatePresignedDownloadUrl",
        "fetch",
      ]);
    });

    test("does not call S3 service when no attachments", async () => {
      MockSetup.setupSuccessfulCallStakwork();
      const request = TestDataFactory.createMockRequest();

      await callStakwork(
        "test-task",
        "test message",
        [],
        "test-user",
        "test-token",
        "http://swarm.example.com",
        "test-alias",
        "test-pool",
        request,
        "http://repo2graph.example.com",
        [],
      );

      // When no attachments, getS3Service should not be called at all
      // because Promise.all on an empty array resolves immediately
      expect(mockGetS3Service).not.toHaveBeenCalled();
    });
  });
});