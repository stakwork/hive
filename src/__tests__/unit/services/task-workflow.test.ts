import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { callStakworkAPI } from "@/services/task-workflow";

// Mock dependencies
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_WORKFLOW_ID: "123,456,789",
    STAKWORK_BASE_URL: "https://stakwork-api.example.com",
  },
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

import { config } from "@/lib/env";
import { getBaseUrl } from "@/lib/utils";

const mockGetBaseUrl = getBaseUrl as Mock;
const mockFetch = global.fetch as Mock;

// Test Data Factory - Centralized test data creation
const TestDataFactory = {
  createValidParams: (overrides = {}) => ({
    taskId: "task-123",
    message: "Test message",
    contextTags: [{ tag: "test", value: "value" }],
    userName: "testuser",
    accessToken: "github_pat_test123",
    swarmUrl: "https://test-swarm.sphinx.chat:8444/api",
    swarmSecretAlias: "{{SWARM_API_KEY}}",
    poolName: "test-pool",
    repo2GraphUrl: "https://test-swarm.sphinx.chat:3355",
    attachments: ["https://s3.amazonaws.com/file1.txt"],
    mode: "test",
    taskSource: "USER",
    ...overrides,
  }),

  createStakworkSuccessResponse: (overrides = {}) => ({
    success: true,
    data: {
      project_id: 456,
      workflow_id: 789,
      status: "pending",
      ...overrides,
    },
  }),

  createStakworkErrorResponse: (overrides = {}) => ({
    success: false,
    error: "API error occurred",
    ...overrides,
  }),

  createFetchResponse: (body: unknown, ok = true, status = 200, statusText?: string) => ({
    ok,
    status,
    statusText: statusText || (ok ? "OK" : "Internal Server Error"),
    json: async () => body,
  }),
};

// Test Helpers - Reusable assertion utilities
const TestHelpers = {
  expectSuccessfulResponse: (result: unknown, expectedData: unknown) => {
    expect(result).toEqual(expectedData);
  },

  expectErrorResponse: (result: unknown) => {
    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error");
  },

  expectFetchCalledWithCorrectPayload: (
    taskId: string,
    workflowId: number,
    expectedVars: Record<string, unknown>
  ) => {
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toBe("https://stakwork-api.example.com/projects");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({
      Authorization: "Token token=test-api-key",
      "Content-Type": "application/json",
    });

    const payload = JSON.parse(options.body);
    expect(payload.name).toBe("hive_autogen");
    expect(payload.workflow_id).toBe(workflowId);
    expect(payload.webhook_url).toContain(`task_id=${taskId}`);
    expect(payload.workflow_params.set_var.attributes.vars).toMatchObject(
      expectedVars
    );
  },

  expectWebhookUrlsInPayload: (taskId: string, baseUrl: string) => {
    const [, options] = mockFetch.mock.calls[0];
    const payload = JSON.parse(options.body);

    expect(payload.webhook_url).toBe(
      `${baseUrl}/api/stakwork/webhook?task_id=${taskId}`
    );
    expect(payload.workflow_params.set_var.attributes.vars.webhookUrl).toBe(
      `${baseUrl}/api/chat/response`
    );
  },

  expectAuthorizationHeader: () => {
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Token token=test-api-key");
  },
};

// Mock Setup Utilities - Complex mocking scenarios
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
    mockGetBaseUrl.mockReturnValue("http://localhost:3000");
    // Reset config values to defaults
    vi.mocked(config).STAKWORK_API_KEY = "test-api-key";
    vi.mocked(config).STAKWORK_WORKFLOW_ID = "123,456,789";
    vi.mocked(config).STAKWORK_BASE_URL = "https://stakwork-api.example.com";
  },

  setupSuccessfulApiCall: (responseData = {}) => {
    const response = TestDataFactory.createStakworkSuccessResponse(responseData);
    mockFetch.mockResolvedValue(
      TestDataFactory.createFetchResponse(response, true)
    );
    return response;
  },

  setupFailedApiCall: (statusText = "Internal Server Error") => {
    mockFetch.mockResolvedValue(
      TestDataFactory.createFetchResponse({}, false, 500, statusText)
    );
    return { success: false, error: statusText };
  },

  setupNetworkError: (errorMessage = "Network timeout") => {
    mockFetch.mockRejectedValue(new Error(errorMessage));
  },

  setupMissingConfig: (key: "STAKWORK_API_KEY" | "STAKWORK_WORKFLOW_ID") => {
    vi.mocked(config)[key] = "";
  },
};

describe("callStakworkAPI - Unit Tests", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  describe("Configuration Validation", () => {
    test("should throw error when STAKWORK_API_KEY is missing", async () => {
      MockSetup.setupMissingConfig("STAKWORK_API_KEY");

      const params = TestDataFactory.createValidParams();

      await expect(callStakworkAPI(params)).rejects.toThrow(
        "Stakwork configuration missing"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should throw error when STAKWORK_WORKFLOW_ID is missing", async () => {
      MockSetup.setupMissingConfig("STAKWORK_WORKFLOW_ID");

      const params = TestDataFactory.createValidParams();

      await expect(callStakworkAPI(params)).rejects.toThrow(
        "Stakwork configuration missing"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should proceed with valid configuration", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams();
      await callStakworkAPI(params);

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("Mode-Based Workflow Selection", () => {
    test("should select first workflow ID for live mode", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({ mode: "live" });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.workflow_id).toBe(123); // First ID in "123,456,789"
    });

    test("should select third workflow ID for unit mode", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({ mode: "unit" });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.workflow_id).toBe(789); // Third ID in "123,456,789"
    });

    test("should select third workflow ID for integration mode", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({
        mode: "integration",
      });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.workflow_id).toBe(789); // Third ID in "123,456,789"
    });

    test("should select second workflow ID for default mode", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({ mode: "default" });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.workflow_id).toBe(456); // Second ID in "123,456,789"
    });

    test("should fallback to second workflow ID for unknown mode", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({ mode: "unknown" });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.workflow_id).toBe(456); // Second ID (default fallback)
    });

    test("should fallback to first workflow ID when array is too short", async () => {
      vi.mocked(config).STAKWORK_WORKFLOW_ID = "111";
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({ mode: "unit" });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.workflow_id).toBe(111); // Only one ID available, fallback logic
    });
  });

  describe("Webhook URL Construction", () => {
    test("should construct webhook URLs using getBaseUrl", async () => {
      mockGetBaseUrl.mockReturnValue("https://example.com");
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({
        taskId: "task-456",
      });
      await callStakworkAPI(params);

      TestHelpers.expectWebhookUrlsInPayload(
        "task-456",
        "https://example.com"
      );
    });

    test("should include task_id in workflow webhook URL", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({
        taskId: "task-789",
      });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.webhook_url).toContain("task_id=task-789");
    });

    test("should construct chat response webhook URL", async () => {
      mockGetBaseUrl.mockReturnValue("https://example.com");
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams();
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(
        payload.workflow_params.set_var.attributes.vars.webhookUrl
      ).toBe("https://example.com/api/chat/response");
    });
  });

  describe("Payload Structure Verification", () => {
    test("should include all required fields in vars object", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({
        taskId: "task-001",
        message: "Test message content",
        userName: "johndoe",
        accessToken: "token123",
        swarmUrl: "https://swarm.test.com:8444/api",
        swarmSecretAlias: "{{SECRET}}",
        poolName: "pool-001",
        repo2GraphUrl: "https://repo2graph.test.com:3355",
        attachments: ["https://s3.aws.com/file1.txt", "https://s3.aws.com/file2.txt"],
        mode: "test",
        taskSource: "USER",
      });

      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars).toMatchObject({
        taskId: "task-001",
        message: "Test message content",
        alias: "johndoe",
        username: "johndoe",
        accessToken: "token123",
        swarmUrl: "https://swarm.test.com:8444/api",
        swarmSecretAlias: "{{SECRET}}",
        poolName: "pool-001",
        repo2graph_url: "https://repo2graph.test.com:3355",
        attachments: ["https://s3.aws.com/file1.txt", "https://s3.aws.com/file2.txt"],
        taskMode: "test",
        taskSource: "user", // Lowercase conversion
      });
    });

    test("should convert taskSource to lowercase", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({
        taskSource: "SYSTEM",
      });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(
        payload.workflow_params.set_var.attributes.vars.taskSource
      ).toBe("system");
    });

    test("should include contextTags in vars object", async () => {
      MockSetup.setupSuccessfulApiCall();

      const contextTags = [
        { tag: "priority", value: "high" },
        { tag: "category", value: "bug" },
      ];
      const params = TestDataFactory.createValidParams({ contextTags });

      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(
        payload.workflow_params.set_var.attributes.vars.contextTags
      ).toEqual(contextTags);
    });

    test("should set name to hive_autogen", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams();
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.name).toBe("hive_autogen");
    });

    test("should handle empty attachments array", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({
        attachments: [],
      });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(
        payload.workflow_params.set_var.attributes.vars.attachments
      ).toEqual([]);
    });

    test("should handle null userName and accessToken", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({
        userName: null,
        accessToken: null,
      });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      const vars = payload.workflow_params.set_var.attributes.vars;
      expect(vars.username).toBeNull();
      expect(vars.alias).toBeNull();
      expect(vars.accessToken).toBeNull();
    });
  });

  describe("Authorization Header", () => {
    test("should include correct Authorization header format", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams();
      await callStakworkAPI(params);

      TestHelpers.expectAuthorizationHeader();
    });

    test("should use STAKWORK_API_KEY from config", async () => {
      vi.mocked(config).STAKWORK_API_KEY = "custom-api-key-123";
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams();
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBe(
        "Token token=custom-api-key-123"
      );
    });

    test("should include Content-Type header", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams();
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("Successful API Responses", () => {
    test("should return response data on successful API call", async () => {
      const responseData = {
        project_id: 999,
        workflow_id: 888,
        status: "completed",
      };
      const mockResponse =
        MockSetup.setupSuccessfulApiCall(responseData);

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      TestHelpers.expectSuccessfulResponse(result, mockResponse);
    });

    test("should return success: true when API responds with success", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      expect(result).toHaveProperty("success", true);
    });

    test("should return data field from API response", async () => {
      const mockResponse = MockSetup.setupSuccessfulApiCall({
        custom_field: "custom_value",
      });

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      expect(result).toEqual(mockResponse);
    });

    test("should handle response with additional fields", async () => {
      const mockResponse = MockSetup.setupSuccessfulApiCall({
        project_id: 123,
        workflow_id: 456,
        metadata: { key: "value" },
        timestamp: "2024-01-01T00:00:00Z",
      });

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      expect(result).toEqual(mockResponse);
    });
  });

  describe("HTTP Error Responses", () => {
    test("should return error object when response.ok is false", async () => {
      MockSetup.setupFailedApiCall("Bad Request");

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      TestHelpers.expectErrorResponse(result);
      expect(result).toHaveProperty("error", "Bad Request");
    });

    test("should log error when response.ok is false", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      MockSetup.setupFailedApiCall("Service Unavailable");

      const params = TestDataFactory.createValidParams();
      await callStakworkAPI(params);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send message to Stakwork")
      );

      consoleErrorSpy.mockRestore();
    });

    test("should handle 500 Internal Server Error", async () => {
      mockFetch.mockResolvedValue(
        TestDataFactory.createFetchResponse(
          { error: "Internal error" },
          false,
          500
        )
      );

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error");
    });

    test("should handle 503 Service Unavailable", async () => {
      mockFetch.mockResolvedValue(
        TestDataFactory.createFetchResponse(
          { error: "Service unavailable" },
          false,
          503
        )
      );

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error");
    });

    test("should include statusText in error response", async () => {
      MockSetup.setupFailedApiCall("Forbidden");

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      expect(result).toHaveProperty("error", "Forbidden");
    });
  });

  describe("Network Error Handling", () => {
    test("should handle network timeout errors", async () => {
      MockSetup.setupNetworkError("Network timeout");

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      TestHelpers.expectErrorResponse(result);
      expect(result.error).toContain("Network timeout");
    });

    test("should handle fetch rejection", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      expect(result).toHaveProperty("success", false);
      expect(result.error).toContain("Connection refused");
    });

    test("should log error when fetch throws exception", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      MockSetup.setupNetworkError("DNS resolution failed");

      const params = TestDataFactory.createValidParams();
      await callStakworkAPI(params);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error calling Stakwork"),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    test("should convert error to string in response", async () => {
      const errorMessage = "Custom network error";
      mockFetch.mockRejectedValue(new Error(errorMessage));

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      expect(result.error).toContain(errorMessage);
    });

    test("should handle non-Error exceptions", async () => {
      mockFetch.mockRejectedValue("String error");

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      expect(result).toHaveProperty("success", false);
      expect(result.error).toBe("String error");
    });
  });

  describe("Return Value Verification", () => {
    test("should return object with success and data fields on success", async () => {
      const mockResponse = MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("data");
      expect(result).toEqual(mockResponse);
    });

    test("should return object with success and error fields on failure", async () => {
      MockSetup.setupFailedApiCall();

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error");
    });

    test("should not double-wrap response data", async () => {
      const apiResponse = {
        success: true,
        data: { project_id: 123 },
      };
      mockFetch.mockResolvedValue(
        TestDataFactory.createFetchResponse(apiResponse, true)
      );

      const params = TestDataFactory.createValidParams();
      const result = await callStakworkAPI(params);

      // Result should be the API response directly, not wrapped in another object
      expect(result).toEqual(apiResponse);
      expect(result).not.toHaveProperty("data.data");
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty message", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({ message: "" });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(
        payload.workflow_params.set_var.attributes.vars.message
      ).toBe("");
    });

    test("should handle very long message", async () => {
      MockSetup.setupSuccessfulApiCall();

      const longMessage = "a".repeat(10000);
      const params = TestDataFactory.createValidParams({
        message: longMessage,
      });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(
        payload.workflow_params.set_var.attributes.vars.message
      ).toBe(longMessage);
    });

    test("should handle empty contextTags array", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({
        contextTags: [],
      });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(
        payload.workflow_params.set_var.attributes.vars.contextTags
      ).toEqual([]);
    });

    test("should handle special characters in taskId", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({
        taskId: "task-!@#$%",
      });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.webhook_url).toContain(
        "task_id=task-!@#$%"
      );
    });

    test("should handle undefined optional parameters", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = {
        taskId: "task-123",
        message: "Test",
        userName: null,
        accessToken: null,
        swarmUrl: "https://swarm.test.com:8444/api",
        swarmSecretAlias: null,
        poolName: null,
        repo2GraphUrl: "https://repo2graph.test.com:3355",
      };

      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.contextTags).toEqual([]);
      expect(vars.attachments).toEqual([]);
      expect(vars.taskMode).toBe("default");
      expect(vars.taskSource).toBe("user");
    });

    test("should handle empty swarmSecretAlias", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({
        swarmSecretAlias: "",
      });
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(
        payload.workflow_params.set_var.attributes.vars.swarmSecretAlias
      ).toBe("");
    });

    test("should handle multiple attachments", async () => {
      MockSetup.setupSuccessfulApiCall();

      const attachments = [
        "https://s3.aws.com/file1.txt",
        "https://s3.aws.com/file2.pdf",
        "https://s3.aws.com/file3.png",
      ];
      const params = TestDataFactory.createValidParams({ attachments });

      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(
        payload.workflow_params.set_var.attributes.vars.attachments
      ).toEqual(attachments);
    });
  });

  describe("API Endpoint Construction", () => {
    test("should call correct Stakwork API endpoint", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams();
      await callStakworkAPI(params);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://stakwork-api.example.com/projects");
    });

    test("should use STAKWORK_BASE_URL from config", async () => {
      vi.mocked(config).STAKWORK_BASE_URL =
        "https://custom-stakwork.com/api/v2";
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams();
      await callStakworkAPI(params);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://custom-stakwork.com/api/v2/projects");
    });

    test("should make POST request", async () => {
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams();
      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe("POST");
    });
  });

  describe("Integration Scenarios", () => {
    test("should handle complete workflow for USER taskSource", async () => {
      mockGetBaseUrl.mockReturnValue("https://app.example.com");
      const mockResponse = MockSetup.setupSuccessfulApiCall({
        project_id: 555,
        workflow_id: 456,
        status: "in_progress",
      });

      const params = TestDataFactory.createValidParams({
        taskId: "task-integration-001",
        message: "Integration test message",
        userName: "integrationuser",
        taskSource: "USER",
        mode: "live",
      });

      const result = await callStakworkAPI(params);

      expect(mockGetBaseUrl).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      TestHelpers.expectFetchCalledWithCorrectPayload("task-integration-001", 123, {
        taskId: "task-integration-001",
        message: "Integration test message",
        username: "integrationuser",
        taskSource: "user",
        taskMode: "live",
      });
      TestHelpers.expectSuccessfulResponse(result, mockResponse);
    });

    test("should handle complete workflow for SYSTEM taskSource", async () => {
      mockGetBaseUrl.mockReturnValue("https://app.example.com");
      MockSetup.setupSuccessfulApiCall();

      const params = TestDataFactory.createValidParams({
        taskSource: "SYSTEM",
        mode: "unit",
      });

      await callStakworkAPI(params);

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(
        payload.workflow_params.set_var.attributes.vars.taskSource
      ).toBe("system");
      expect(payload.workflow_id).toBe(789); // Unit mode = third ID
    });
  });
});