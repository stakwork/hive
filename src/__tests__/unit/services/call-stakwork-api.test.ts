import { describe, test, expect, beforeEach, vi } from "vitest";
import { callStakworkAPI } from "@/services/task-workflow";
import {
  createStakworkAPIParams,
  createStakworkResponse,
  setupStakworkMocks,
  extractStakworkPayload,
  validateWebhookUrls,
  WORKFLOW_MODE_TEST_CASES,
  ERROR_SCENARIOS,
  EDGE_CASE_DATA,
  STAKWORK_TEST_CONFIG,
} from "@/__tests__/support/mocks/stakwork";

// Mock all external dependencies at module level
vi.mock("@/lib/env", () => ({
  config: STAKWORK_TEST_CONFIG,
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Import mocked modules
const { config } = await import("@/lib/env");
const { getBaseUrl } = await import("@/lib/utils");
const mockFetch = vi.mocked(global.fetch);
const mockGetBaseUrl = vi.mocked(getBaseUrl);

// Test Data Factories
const createMockParams = (overrides = {}) => ({
  taskId: "task-123",
  message: "Test message",
  contextTags: [],
  userName: "testuser",
  accessToken: "github_pat_test_token",
  swarmUrl: "https://test-swarm.sphinx.chat/api",
  swarmSecretAlias: "{{SWARM_123_API_KEY}}",
  poolName: "test-pool",
  repo2GraphUrl: "https://test-swarm.sphinx.chat:3355",
  attachments: [],
  mode: "default",
  taskSource: "USER",
  ...overrides,
});

describe("callStakworkAPI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset config to default values
    vi.mocked(config).STAKWORK_API_KEY = "test-stakwork-key";
    vi.mocked(config).STAKWORK_BASE_URL = "https://test-stakwork.com/api/v1";
    vi.mocked(config).STAKWORK_WORKFLOW_ID = "123,456,789";
    
    mockGetBaseUrl.mockReturnValue("http://localhost:3000");
  });

  describe("Configuration Validation", () => {
    test("should throw error when STAKWORK_API_KEY is missing", async () => {
      vi.mocked(config).STAKWORK_API_KEY = "";

      await expect(callStakworkAPI(createMockParams())).rejects.toThrow(
        "Stakwork configuration missing"
      );
    });

    test("should throw error when STAKWORK_WORKFLOW_ID is missing", async () => {
      vi.mocked(config).STAKWORK_WORKFLOW_ID = "";

      await expect(callStakworkAPI(createMockParams())).rejects.toThrow(
        "Stakwork configuration missing"
      );
    });

    test("should throw error when both config values are missing", async () => {
      vi.mocked(config).STAKWORK_API_KEY = "";
      vi.mocked(config).STAKWORK_WORKFLOW_ID = "";

      await expect(callStakworkAPI(createMockParams())).rejects.toThrow(
        "Stakwork configuration missing"
      );
    });
  });

  describe("Request Construction", () => {
    test("should construct correct payload structure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 123 } }),
      } as Response);

      const params = createMockParams();
      await callStakworkAPI(params);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-stakwork.com/api/v1/projects",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Token token=test-stakwork-key",
            "Content-Type": "application/json",
          },
        })
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody).toEqual({
        name: "hive_autogen",
        workflow_id: 456,
        webhook_url: "http://localhost:3000/api/stakwork/webhook?task_id=task-123",
        workflow_params: {
          set_var: {
            attributes: {
              vars: {
                taskId: "task-123",
                message: "Test message",
                contextTags: [],
                webhookUrl: "http://localhost:3000/api/chat/response",
                alias: "testuser",
                username: "testuser",
                accessToken: "github_pat_test_token",
                swarmUrl: "https://test-swarm.sphinx.chat/api",
                swarmSecretAlias: "{{SWARM_123_API_KEY}}",
                poolName: "test-pool",
                repo2graph_url: "https://test-swarm.sphinx.chat:3355",
                attachments: [],
                taskMode: "default",
                taskSource: "user",
              },
            },
          },
        },
      });
    });

    test("should include all parameters in vars object", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      const params = createMockParams({
        contextTags: [{ type: "file", value: "test.js" }],
        attachments: ["uploads/file1.pdf", "uploads/file2.png"],
      });

      await callStakworkAPI(params);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      const vars = callBody.workflow_params.set_var.attributes.vars;

      expect(vars.contextTags).toEqual([{ type: "file", value: "test.js" }]);
      expect(vars.attachments).toEqual(["uploads/file1.pdf", "uploads/file2.png"]);
      expect(vars.taskId).toBe("task-123");
      expect(vars.message).toBe("Test message");
      expect(vars.alias).toBe("testuser");
      expect(vars.username).toBe("testuser");
      expect(vars.accessToken).toBe("github_pat_test_token");
    });

    test("should construct correct webhook URLs using getBaseUrl", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      mockGetBaseUrl.mockReturnValue("https://example.com");

      await callStakworkAPI(createMockParams());

      expect(mockGetBaseUrl).toHaveBeenCalled();

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.webhook_url).toBe(
        "https://example.com/api/stakwork/webhook?task_id=task-123"
      );
      expect(callBody.workflow_params.set_var.attributes.vars.webhookUrl).toBe(
        "https://example.com/api/chat/response"
      );
    });

    test("should include Authorization header with correct format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams());

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key",
          }),
        })
      );
    });

    test("should include Content-Type header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams());

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("should convert taskSource to lowercase", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ taskSource: "JANITOR" }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_params.set_var.attributes.vars.taskSource).toBe("janitor");
    });
  });

  describe("Workflow ID Selection", () => {
    test("should select first workflow ID for live mode", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ mode: "live" }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_id).toBe(123);
    });

    test("should select third workflow ID for unit mode", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ mode: "unit" }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_id).toBe(789);
    });

    test("should select third workflow ID for integration mode", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ mode: "integration" }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_id).toBe(789);
    });

    test("should select second workflow ID for default mode", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ mode: "default" }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_id).toBe(456);
    });

    test("should fallback to first workflow ID when only one is configured", async () => {
      vi.mocked(config).STAKWORK_WORKFLOW_ID = "999";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ mode: "default" }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_id).toBe(999);
    });

    test("should use first workflow ID when second is not available", async () => {
      vi.mocked(config).STAKWORK_WORKFLOW_ID = "111";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ mode: "default" }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_id).toBe(111);
    });

    test("should parse workflow ID as integer", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ mode: "live" }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(typeof callBody.workflow_id).toBe("number");
      expect(callBody.workflow_id).toBe(123);
    });
  });

  describe("Error Handling", () => {
    test("should return error object when response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      const result = await callStakworkAPI(createMockParams());

      expect(result).toEqual({
        success: false,
        error: "Internal Server Error",
      });
    });

    test("should log error message on HTTP failure", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Request",
      } as Response);

      await callStakworkAPI(createMockParams());

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to send message to Stakwork: Bad Request"
      );

      consoleErrorSpy.mockRestore();
    });

    test("should handle different HTTP error status codes", async () => {
      const errorCases = [
        { statusText: "Bad Request", code: 400 },
        { statusText: "Unauthorized", code: 401 },
        { statusText: "Forbidden", code: 403 },
        { statusText: "Not Found", code: 404 },
        { statusText: "Internal Server Error", code: 500 },
      ];

      for (const errorCase of errorCases) {
        vi.clearAllMocks();

        mockFetch.mockResolvedValueOnce({
          ok: false,
          statusText: errorCase.statusText,
        } as Response);

        const result = await callStakworkAPI(createMockParams());

        expect(result).toEqual({
          success: false,
          error: errorCase.statusText,
        });
      }
    });

    test("should propagate network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(callStakworkAPI(createMockParams())).rejects.toThrow("Network error");
    });

    test("should propagate fetch timeout errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      await expect(callStakworkAPI(createMockParams())).rejects.toThrow("Request timeout");
    });

    test("should propagate JSON parsing errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as Response);

      await expect(callStakworkAPI(createMockParams())).rejects.toThrow("Invalid JSON");
    });
  });

  describe("Success Response", () => {
    test("should return JSON response directly on success", async () => {
      const mockResponse = {
        success: true,
        data: {
          project_id: 12345,
          workflow_id: 456,
          status: "pending",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await callStakworkAPI(createMockParams());

      expect(result).toEqual(mockResponse);
    });

    test("should include project_id in response data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { project_id: 99999 },
        }),
      } as Response);

      const result = await callStakworkAPI(createMockParams());

      expect(result).toHaveProperty("data.project_id");
      expect(result.data.project_id).toBe(99999);
    });

    test("should handle response without project_id", async () => {
      const mockResponse = {
        success: true,
        data: {
          workflow_id: 456,
          status: "completed",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await callStakworkAPI(createMockParams());

      expect(result).toEqual(mockResponse);
      expect(result.data).not.toHaveProperty("project_id");
    });

    test("should handle minimal success response", async () => {
      const mockResponse = { success: true };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await callStakworkAPI(createMockParams());

      expect(result).toEqual(mockResponse);
    });
  });

  describe("Edge Cases", () => {
    test("should handle null userName and accessToken", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(
        createMockParams({
          userName: null,
          accessToken: null,
        })
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      const vars = callBody.workflow_params.set_var.attributes.vars;

      expect(vars.alias).toBeNull();
      expect(vars.username).toBeNull();
      expect(vars.accessToken).toBeNull();
    });

    test("should handle empty contextTags array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ contextTags: [] }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_params.set_var.attributes.vars.contextTags).toEqual([]);
    });

    test("should handle empty attachments array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ attachments: [] }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_params.set_var.attributes.vars.attachments).toEqual([]);
    });

    test("should handle empty swarmSecretAlias", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ swarmSecretAlias: null }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_params.set_var.attributes.vars.swarmSecretAlias).toBeNull();
    });

    test("should handle empty poolName", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams({ poolName: null }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_params.set_var.attributes.vars.poolName).toBeNull();
    });

    test("should handle very long message content", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      const longMessage = "a".repeat(10000);
      await callStakworkAPI(createMockParams({ message: longMessage }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_params.set_var.attributes.vars.message).toBe(longMessage);
    });

    test("should handle special characters in message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      const specialMessage = "Test with 🚀 emojis and chars: àáâäåæçèéêë & <html>";
      await callStakworkAPI(createMockParams({ message: specialMessage }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.workflow_params.set_var.attributes.vars.message).toBe(specialMessage);
    });
  });

  describe("API Integration", () => {
    test("should make POST request to correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams());

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-stakwork.com/api/v1/projects",
        expect.any(Object)
      );
    });

    test("should use configured STAKWORK_BASE_URL", async () => {
      vi.mocked(config).STAKWORK_BASE_URL = "https://custom-stakwork.com";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams());

      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom-stakwork.com/projects",
        expect.any(Object)
      );
    });

    test("should make exactly one fetch call per invocation", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await callStakworkAPI(createMockParams());

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("should not retry on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Server Error",
      } as Response);

      await callStakworkAPI(createMockParams());

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});