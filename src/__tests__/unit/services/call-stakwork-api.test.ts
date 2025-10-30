import { vi, describe, beforeEach, test, expect } from "vitest";
import { callStakworkAPI } from "@/services/task-workflow";

// Mock dependencies
vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "https://test.example.com"),
}));

// Mock fetch globally
global.fetch = vi.fn();
const mockFetch = vi.mocked(global.fetch);

// Test data factories
const createTestParams = (overrides = {}) => ({
  taskId: "test-task-123",
  message: "Test message",
  contextTags: [],
  userName: "testuser",
  accessToken: "test-token",
  swarmUrl: "https://swarm.test.com",
  swarmSecretAlias: "test-alias",
  poolName: "test-pool",
  repo2GraphUrl: "https://repo2graph.test.com",
  attachments: [],
  mode: "default",
  taskSource: "USER",
  workspaceId: "test-workspace-123",
  ...overrides,
});

const createSuccessResponse = (projectId = 12345) => ({
  ok: true,
  json: async () => ({
    success: true,
    data: {
      project_id: projectId,
    },
  }),
});

const createErrorResponse = (statusText = "Internal Server Error") => ({
  ok: false,
  statusText,
  json: async () => ({}),
});

describe("callStakworkAPI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Configuration Validation", () => {
    test("throws error when STAKWORK_API_KEY is missing", async () => {
      const { config } = await import("@/lib/env");
      const originalApiKey = config.STAKWORK_API_KEY;
      
      // Temporarily unset the API key
      (config as any).STAKWORK_API_KEY = undefined;

      await expect(callStakworkAPI(createTestParams())).rejects.toThrow(
        "Stakwork configuration missing"
      );

      // Restore
      (config as any).STAKWORK_API_KEY = originalApiKey;
    });

    test("throws error when STAKWORK_WORKFLOW_ID is missing", async () => {
      const { config } = await import("@/lib/env");
      const originalWorkflowId = config.STAKWORK_WORKFLOW_ID;
      
      // Temporarily unset the workflow ID
      (config as any).STAKWORK_WORKFLOW_ID = undefined;

      await expect(callStakworkAPI(createTestParams())).rejects.toThrow(
        "Stakwork configuration missing"
      );

      // Restore
      (config as any).STAKWORK_WORKFLOW_ID = originalWorkflowId;
    });
  });

  describe("Workflow ID Selection", () => {
    test("selects first workflow ID for live mode", async () => {
      const { config } = await import("@/lib/env");
      // Set up multiple workflow IDs
      const originalWorkflowId = config.STAKWORK_WORKFLOW_ID;
      (config as any).STAKWORK_WORKFLOW_ID = "100,200,300";

      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams({ mode: "live" }));

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"workflow_id":100'),
        })
      );

      // Restore
      (config as any).STAKWORK_WORKFLOW_ID = originalWorkflowId;
    });

    test("selects third workflow ID for unit mode", async () => {
      const { config } = await import("@/lib/env");
      const originalWorkflowId = config.STAKWORK_WORKFLOW_ID;
      (config as any).STAKWORK_WORKFLOW_ID = "100,200,300";

      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams({ mode: "unit" }));

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"workflow_id":300'),
        })
      );

      // Restore
      (config as any).STAKWORK_WORKFLOW_ID = originalWorkflowId;
    });

    test("selects third workflow ID for integration mode", async () => {
      const { config } = await import("@/lib/env");
      const originalWorkflowId = config.STAKWORK_WORKFLOW_ID;
      (config as any).STAKWORK_WORKFLOW_ID = "100,200,300";

      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams({ mode: "integration" }));

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"workflow_id":300'),
        })
      );

      // Restore
      (config as any).STAKWORK_WORKFLOW_ID = originalWorkflowId;
    });

    test("selects second workflow ID for default mode when available", async () => {
      const { config } = await import("@/lib/env");
      const originalWorkflowId = config.STAKWORK_WORKFLOW_ID;
      (config as any).STAKWORK_WORKFLOW_ID = "100,200,300";

      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams({ mode: "default" }));

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"workflow_id":200'),
        })
      );

      // Restore
      (config as any).STAKWORK_WORKFLOW_ID = originalWorkflowId;
    });

    test("falls back to first workflow ID for default mode when second is not available", async () => {
      const { config } = await import("@/lib/env");
      const originalWorkflowId = config.STAKWORK_WORKFLOW_ID;
      (config as any).STAKWORK_WORKFLOW_ID = "100";

      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams({ mode: "default" }));

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"workflow_id":100'),
        })
      );

      // Restore
      (config as any).STAKWORK_WORKFLOW_ID = originalWorkflowId;
    });
  });

  describe("Request Construction", () => {
    test("constructs correct webhook URLs with task ID", async () => {
      const params = createTestParams({ taskId: "task-456" });
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(params);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining(
            "https://test.example.com/api/stakwork/webhook?task_id=task-456"
          ),
        })
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining(
            "https://test.example.com/api/chat/response"
          ),
        })
      );
    });

    test("includes all required variables in payload", async () => {
      const params = createTestParams({
        message: "Test message content",
        userName: "john-doe",
        accessToken: "secret-token",
        swarmUrl: "https://swarm.example.com",
        swarmSecretAlias: "swarm-alias",
        poolName: "production-pool",
        repo2GraphUrl: "https://repo2graph.example.com",
        attachments: ["file1.txt", "file2.pdf"],
        taskSource: "CODEBASE_RECOMMENDATION",
        workspaceId: "workspace-789",
      });

      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(params);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);

      expect(body.workflow_params.set_var.attributes.vars).toMatchObject({
        message: "Test message content",
        alias: "john-doe",
        username: "john-doe",
        accessToken: "secret-token",
        swarmUrl: "https://swarm.example.com",
        swarmSecretAlias: "swarm-alias",
        poolName: "production-pool",
        repo2graph_url: "https://repo2graph.example.com",
        attachments: ["file1.txt", "file2.pdf"],
        taskSource: "codebase_recommendation", // Should be lowercase
        workspaceId: "workspace-789",
      });
    });

    test("constructs payload with correct structure", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);

      expect(body).toHaveProperty("name", "hive_autogen");
      expect(body).toHaveProperty("workflow_id");
      expect(body).toHaveProperty("webhook_url");
      expect(body).toHaveProperty("workflow_params.set_var.attributes.vars");
    });

    test("converts taskSource to lowercase", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(
        createTestParams({ taskSource: "CODEBASE_RECOMMENDATION" })
      );

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);

      expect(body.workflow_params.set_var.attributes.vars.taskSource).toBe(
        "codebase_recommendation"
      );
    });
  });

  describe("HTTP Execution", () => {
    test("makes POST request to correct endpoint", async () => {
      const { config } = await import("@/lib/env");
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams());

      expect(mockFetch).toHaveBeenCalledWith(
        `${config.STAKWORK_BASE_URL}/projects`,
        expect.any(Object)
      );
    });

    test("includes correct Authorization header with API key", async () => {
      const { config } = await import("@/lib/env");
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams());

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Authorization: `Token token=${config.STAKWORK_API_KEY}`,
            "Content-Type": "application/json",
          },
        })
      );
    });

    test("uses POST method", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams());

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    test("sends JSON stringified body", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams());

      const fetchCall = mockFetch.mock.calls[0];
      const body = fetchCall[1]?.body;

      expect(typeof body).toBe("string");
      expect(() => JSON.parse(body as string)).not.toThrow();
    });
  });

  describe("Response Parsing", () => {
    test("returns raw JSON response on success", async () => {
      const expectedResponse = {
        success: true,
        data: {
          project_id: 54321,
          status: "created",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => expectedResponse,
      } as any);

      const result = await callStakworkAPI(createTestParams());

      expect(result).toEqual(expectedResponse);
    });

    test("returns success object with project_id", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(99999) as any);

      const result = await callStakworkAPI(createTestParams());

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("data.project_id", 99999);
    });
  });

  describe("Error Handling", () => {
    test("returns error object when response is not ok", async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse("Bad Request") as any
      );

      const result = await callStakworkAPI(createTestParams());

      expect(result).toEqual({
        success: false,
        error: "Bad Request",
      });
    });

    test("logs error message when API call fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      mockFetch.mockResolvedValueOnce(
        createErrorResponse("Service Unavailable") as any
      );

      await callStakworkAPI(createTestParams());

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send message to Stakwork")
      );

      consoleErrorSpy.mockRestore();
    });

    test("handles 404 Not Found responses", async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse("Not Found") as any);

      const result = await callStakworkAPI(createTestParams());

      expect(result).toEqual({
        success: false,
        error: "Not Found",
      });
    });

    test("handles 500 Internal Server Error responses", async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse("Internal Server Error") as any
      );

      const result = await callStakworkAPI(createTestParams());

      expect(result).toEqual({
        success: false,
        error: "Internal Server Error",
      });
    });

    test("handles network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(callStakworkAPI(createTestParams())).rejects.toThrow(
        "Network error"
      );
    });

    test("handles JSON parsing errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as any);

      await expect(callStakworkAPI(createTestParams())).rejects.toThrow(
        "Invalid JSON"
      );
    });

    test("handles timeout errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      await expect(callStakworkAPI(createTestParams())).rejects.toThrow(
        "Request timeout"
      );
    });
  });

  describe("Edge Cases", () => {
    test("handles empty contextTags array", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams({ contextTags: [] }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);

      expect(body.workflow_params.set_var.attributes.vars.contextTags).toEqual(
        []
      );
    });

    test("handles empty attachments array", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams({ attachments: [] }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);

      expect(body.workflow_params.set_var.attributes.vars.attachments).toEqual(
        []
      );
    });

    test("handles null userName", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams({ userName: null }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);

      expect(body.workflow_params.set_var.attributes.vars.alias).toBeNull();
      expect(body.workflow_params.set_var.attributes.vars.username).toBeNull();
    });

    test("handles null accessToken", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams({ accessToken: null }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);

      expect(body.workflow_params.set_var.attributes.vars.accessToken).toBeNull();
    });

    test("handles null swarmSecretAlias", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams({ swarmSecretAlias: null }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);

      expect(
        body.workflow_params.set_var.attributes.vars.swarmSecretAlias
      ).toBeNull();
    });

    test("handles null poolName", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse() as any);

      await callStakworkAPI(createTestParams({ poolName: null }));

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);

      expect(body.workflow_params.set_var.attributes.vars.poolName).toBeNull();
    });
  });
});