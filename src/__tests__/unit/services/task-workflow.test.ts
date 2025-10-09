import { describe, test, expect, beforeEach, vi } from "vitest";
import { callStakworkAPI } from "@/services/task-workflow";

// Mock all external dependencies at module level
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://stakwork.example.com",
    STAKWORK_WORKFLOW_ID: "123,456,789", // live,test,unit
  },
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Import mocked modules
const { config: mockConfig } = await import("@/lib/env");
const { getBaseUrl: mockGetBaseUrl } = await import("@/lib/utils");
const mockFetch = fetch as vi.MockedFunction<typeof fetch>;

describe("callStakworkAPI", () => {
  const mockParams = {
    taskId: "test-task-id",
    message: "Test message",
    contextTags: [{ type: "file", value: "test.ts" }],
    userName: "testuser",
    accessToken: "github-token",
    swarmUrl: "https://swarm.example.com:8444/api",
    swarmSecretAlias: "test-alias",
    poolName: "test-pool",
    repo2GraphUrl: "https://repo2graph.example.com:3355",
    attachments: ["https://s3.example.com/file1.pdf"],
    mode: "test",
    taskSource: "USER",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset config to default values
    mockConfig.STAKWORK_API_KEY = "test-api-key";
    mockConfig.STAKWORK_BASE_URL = "https://stakwork.example.com";
    mockConfig.STAKWORK_WORKFLOW_ID = "123,456,789";

    // Reset getBaseUrl mock
    mockGetBaseUrl.mockReturnValue("http://localhost:3000");
  });

  describe("Configuration Validation", () => {
    test("should throw error when STAKWORK_API_KEY is missing", async () => {
      mockConfig.STAKWORK_API_KEY = undefined as any;

      await expect(callStakworkAPI(mockParams)).rejects.toThrow(
        "Stakwork configuration missing"
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should throw error when STAKWORK_WORKFLOW_ID is missing", async () => {
      mockConfig.STAKWORK_WORKFLOW_ID = undefined as any;

      await expect(callStakworkAPI(mockParams)).rejects.toThrow(
        "Stakwork configuration missing"
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should throw error when both config values are missing", async () => {
      mockConfig.STAKWORK_API_KEY = undefined as any;
      mockConfig.STAKWORK_WORKFLOW_ID = undefined as any;

      await expect(callStakworkAPI(mockParams)).rejects.toThrow(
        "Stakwork configuration missing"
      );
    });
  });

  describe("Successful API Calls", () => {
    test("should call Stakwork API with correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 123 } }),
      } as any);

      await callStakworkAPI(mockParams);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://stakwork.example.com/projects",
        expect.any(Object)
      );
    });

    test("should include correct Authorization header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 123 } }),
      } as any);

      await callStakworkAPI(mockParams);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Authorization: "Token token=test-api-key",
            "Content-Type": "application/json",
          },
        })
      );
    });

    test("should use POST method", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 123 } }),
      } as any);

      await callStakworkAPI(mockParams);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    test("should return success response with project_id", async () => {
      const mockResponse = { success: true, data: { project_id: 123 } };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const result = await callStakworkAPI(mockParams);

      expect(result).toEqual(mockResponse);
    });

    test("should parse JSON response correctly", async () => {
      const mockResponse = {
        success: true,
        data: {
          project_id: 456,
          status: "initiated",
          workflow_id: 123,
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const result = await callStakworkAPI(mockParams);

      expect(result).toEqual(mockResponse);
      expect(result.data.project_id).toBe(456);
    });
  });

  describe("Webhook URL Construction", () => {
    test("should construct webhookUrl correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI(mockParams);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.webhookUrl).toBe(
        "http://localhost:3000/api/chat/response"
      );
    });

    test("should construct workflowWebhookUrl with task_id", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI(mockParams);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.webhook_url).toBe(
        "http://localhost:3000/api/stakwork/webhook?task_id=test-task-id"
      );
    });

    test("should use getBaseUrl() for webhook URL construction", async () => {
      mockGetBaseUrl.mockReturnValue("https://custom-domain.com");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI(mockParams);

      expect(mockGetBaseUrl).toHaveBeenCalled();

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.webhook_url).toContain("https://custom-domain.com");
      expect(body.workflow_params.set_var.attributes.vars.webhookUrl).toContain(
        "https://custom-domain.com"
      );
    });
  });

  describe("Payload Construction", () => {
    test("should include all required vars in payload", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI(mockParams);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      const vars = body.workflow_params.set_var.attributes.vars;

      expect(vars).toMatchObject({
        taskId: "test-task-id",
        message: "Test message",
        contextTags: [{ type: "file", value: "test.ts" }],
        alias: "testuser",
        username: "testuser",
        accessToken: "github-token",
        swarmUrl: "https://swarm.example.com:8444/api",
        swarmSecretAlias: "test-alias",
        poolName: "test-pool",
        repo2graph_url: "https://repo2graph.example.com:3355",
        attachments: ["https://s3.example.com/file1.pdf"],
        taskMode: "test",
        taskSource: "user",
      });
    });

    test("should include workflow name as hive_autogen", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI(mockParams);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.name).toBe("hive_autogen");
    });

    test("should handle null values in params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({
        ...mockParams,
        userName: null,
        accessToken: null,
        swarmSecretAlias: null,
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      const vars = body.workflow_params.set_var.attributes.vars;

      expect(vars.username).toBeNull();
      expect(vars.accessToken).toBeNull();
      expect(vars.swarmSecretAlias).toBeNull();
    });

    test("should use default values for optional params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      const minimalParams = {
        taskId: "test-task-id",
        message: "Test message",
        userName: null,
        accessToken: null,
        swarmUrl: "https://swarm.example.com:8444/api",
        swarmSecretAlias: null,
        poolName: null,
        repo2GraphUrl: "https://repo2graph.example.com:3355",
      };

      await callStakworkAPI(minimalParams);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      const vars = body.workflow_params.set_var.attributes.vars;

      expect(vars.contextTags).toEqual([]);
      expect(vars.attachments).toEqual([]);
      expect(vars.taskMode).toBe("default");
      expect(vars.taskSource).toBe("user");
    });

    test("should lowercase taskSource value", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({
        ...mockParams,
        taskSource: "JANITOR",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.taskSource).toBe(
        "janitor"
      );
    });
  });

  describe("Workflow Mode Selection", () => {
    test.each([
      ["live", "123"],
      ["test", "456"],
      ["unit", "789"],
      ["integration", "789"],
      ["default", "456"],
      [undefined, "456"],
    ])("should use workflow ID %s for mode %s", async (mode, expectedWorkflowId) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({
        ...mockParams,
        mode: mode as string | undefined,
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_id).toBe(parseInt(expectedWorkflowId));
    });

    test("should parse workflow ID from comma-separated config", async () => {
      mockConfig.STAKWORK_WORKFLOW_ID = "111,222,333";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({ ...mockParams, mode: "live" });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_id).toBe(111);
    });

    test("should fallback to first workflow ID when mode is unrecognized", async () => {
      mockConfig.STAKWORK_WORKFLOW_ID = "111,222,333";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({ ...mockParams, mode: "production" });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_id).toBe(222);
    });

    test("should fallback to first ID when test mode ID is missing", async () => {
      mockConfig.STAKWORK_WORKFLOW_ID = "111";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({ ...mockParams, mode: "test" });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_id).toBe(111);
    });
  });

  describe("Error Handling", () => {
    test("should return error when fetch response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
      } as any);

      const result = await callStakworkAPI(mockParams);

      expect(result).toEqual({
        success: false,
        error: "Internal Server Error",
      });
    });

    test("should log error when fetch fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Gateway",
      } as any);

      await callStakworkAPI(mockParams);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to send message to Stakwork: Bad Gateway"
      );

      consoleErrorSpy.mockRestore();
    });

    test("should handle network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await callStakworkAPI(mockParams);

      expect(result).toEqual({
        success: false,
        error: "Error: Network error",
      });
    });

    test("should handle JSON parsing errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as any);

      const result = await callStakworkAPI(mockParams);

      expect(result).toEqual({
        success: false,
        error: "Error: Invalid JSON",
      });
    });

    test("should handle timeout errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      const result = await callStakworkAPI(mockParams);

      expect(result).toEqual({
        success: false,
        error: "Error: Request timeout",
      });
    });

    test("should log caught errors", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      await callStakworkAPI(mockParams);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error calling Stakwork:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    test("should handle 401 Unauthorized", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Unauthorized",
        status: 401,
      } as any);

      const result = await callStakworkAPI(mockParams);

      expect(result).toEqual({
        success: false,
        error: "Unauthorized",
      });
    });

    test("should handle 404 Not Found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Not Found",
        status: 404,
      } as any);

      const result = await callStakworkAPI(mockParams);

      expect(result).toEqual({
        success: false,
        error: "Not Found",
      });
    });

    test("should handle 500 Internal Server Error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
        status: 500,
      } as any);

      const result = await callStakworkAPI(mockParams);

      expect(result).toEqual({
        success: false,
        error: "Internal Server Error",
      });
    });
  });

  describe("Response Handling", () => {
    test("should extract project_id from response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 789 } }),
      } as any);

      const result = await callStakworkAPI(mockParams);

      expect(result.data.project_id).toBe(789);
    });

    test("should handle response without project_id", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      const result = await callStakworkAPI(mockParams);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    test("should handle response with additional metadata", async () => {
      const mockResponse = {
        success: true,
        data: {
          project_id: 123,
          workflow_id: 456,
          status: "initiated",
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const result = await callStakworkAPI(mockParams);

      expect(result).toEqual(mockResponse);
    });

    test("should return full response object", async () => {
      const mockResponse = {
        success: true,
        data: { project_id: 123 },
        message: "Workflow initiated",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const result = await callStakworkAPI(mockParams);

      expect(result).toEqual(mockResponse);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({
        ...mockParams,
        message: "",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.message).toBe("");
    });

    test("should handle empty contextTags array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({
        ...mockParams,
        contextTags: [],
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.contextTags).toEqual([]);
    });

    test("should handle empty attachments array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({
        ...mockParams,
        attachments: [],
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.attachments).toEqual([]);
    });

    test("should handle very long message", async () => {
      const longMessage = "A".repeat(10000);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({
        ...mockParams,
        message: longMessage,
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.message).toBe(longMessage);
    });

    test("should handle special characters in message", async () => {
      const specialMessage = "Test <script>alert('xss')</script> & quotes \"'";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({
        ...mockParams,
        message: specialMessage,
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.message).toBe(specialMessage);
    });

    test("should handle multiple attachments", async () => {
      const attachments = [
        "https://s3.example.com/file1.pdf",
        "https://s3.example.com/file2.docx",
        "https://s3.example.com/file3.png",
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      await callStakworkAPI({
        ...mockParams,
        attachments,
      });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.workflow_params.set_var.attributes.vars.attachments).toEqual(attachments);
    });
  });
});