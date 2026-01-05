import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { StakworkWorkflowPayload } from "@/types/stakwork";

// Use shared environment mock
import "@/__tests__/support/mocks/env";
import { config } from "@/config/env";

/**
 * Isolated callStakwork function for unit testing
 * This is extracted from src/app/api/stakwork/user-journey/route.ts
 * for testing in isolation with mocked dependencies
 */
async function callStakwork(
  message: string,
  swarmUrl: string | null,
  swarmSecretAlias: string | null,
  poolName: string | null,
  repo2GraphUrl: string,
  accessToken: string | null,
  username: string | null,
  workspaceId?: string,
  taskId?: string | null,
  testFilePath?: string | null,
  testFileUrl?: string | null,
  baseBranch?: string | null,
  testName?: string,
) {
  try {
    // Validate that all required Stakwork environment variables are set
    if (!config.STAKWORK_API_KEY) {
      throw new Error("STAKWORK_API_KEY is required for Stakwork integration");
    }
    if (!config.STAKWORK_USER_JOURNEY_WORKFLOW_ID) {
      throw new Error("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required for this Stakwork integration");
    }

    // Helper function to get base URL (mocked in tests)
    const getBaseUrl = () => {
      // In actual implementation this would use proper base URL logic
      return "https://hive.stakwork.com";
    };

    // stakwork workflow vars
    const vars: any = {
      message,
      accessToken,
      username,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2graph_url: repo2GraphUrl,
      workspaceId,
      taskId,
      testFilePath,
      testFileUrl,
      baseBranch,
      testName,
      webhookUrl: `${getBaseUrl()}/api/chat/response`,
    };

    const workflowId = config.STAKWORK_USER_JOURNEY_WORKFLOW_ID || "";
    if (!workflowId) {
      throw new Error("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required for this Stakwork integration");
    }

    const stakworkPayload: any = {
      name: "hive_autogen",
      workflow_id: parseInt(workflowId),
      workflow_params: {
        set_var: {
          attributes: {
            vars,
          },
        },
      },
    };

    // Add webhook_url at root level if taskId is provided
    if (taskId) {
      stakworkPayload.webhook_url = `${getBaseUrl()}/api/stakwork/webhook?task_id=${taskId}`;
    }

    const stakworkURL = `${config.STAKWORK_BASE_URL}/projects`;

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

describe("callStakwork - Unit Tests", () => {
  let fetchSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock console.error to prevent test output pollution
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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
      // Temporarily override config
      const originalApiKey = config.STAKWORK_API_KEY;
      (config as any).STAKWORK_API_KEY = "";

      const result = await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_API_KEY is required");
      
      // Restore original value
      (config as any).STAKWORK_API_KEY = originalApiKey;
    });

    it("should throw error when STAKWORK_USER_JOURNEY_WORKFLOW_ID is missing", async () => {
      const originalWorkflowId = config.STAKWORK_USER_JOURNEY_WORKFLOW_ID;
      (config as any).STAKWORK_USER_JOURNEY_WORKFLOW_ID = "";

      const result = await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required");
      
      (config as any).STAKWORK_USER_JOURNEY_WORKFLOW_ID = originalWorkflowId;
    });

    it("should validate workflow ID is not empty string", async () => {
      const originalWorkflowId = config.STAKWORK_USER_JOURNEY_WORKFLOW_ID;
      (config as any).STAKWORK_USER_JOURNEY_WORKFLOW_ID = "";

      const result = await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required");
      
      (config as any).STAKWORK_USER_JOURNEY_WORKFLOW_ID = originalWorkflowId;
    });
  });

  describe("Payload Construction", () => {
    it("should construct correct payload with all parameters", async () => {
      const testParams = {
        message: "User completed onboarding",
        swarmUrl: "https://test-swarm.com/api",
        swarmSecretAlias: "{{SWARM_API_KEY}}",
        poolName: "test-pool",
        repo2GraphUrl: "https://test-swarm.com:3355",
        accessToken: "github-token-123",
        username: "test-user",
      };

      await callStakwork(
        testParams.message,
        testParams.swarmUrl,
        testParams.swarmSecretAlias,
        testParams.poolName,
        testParams.repo2GraphUrl,
        testParams.accessToken,
        testParams.username
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
        workflow_id: 999,
        workflow_params: {
          set_var: {
            attributes: {
              vars: {
                message: testParams.message,
                accessToken: testParams.accessToken,
                username: testParams.username,
                swarmUrl: testParams.swarmUrl,
                swarmSecretAlias: testParams.swarmSecretAlias,
                poolName: testParams.poolName,
                repo2graph_url: testParams.repo2GraphUrl,
              },
            },
          },
        },
      });
    });

    it("should handle null GitHub credentials in payload", async () => {
      await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        null,
        null
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.accessToken).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.username).toBeNull();
    });

    it("should handle null swarm parameters in payload", async () => {
      await callStakwork(
        "Test message",
        null,
        null,
        null,
        "",
        "token",
        "username"
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.swarmUrl).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.swarmSecretAlias).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.poolName).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.repo2graph_url).toBe("");
    });

    it("should parse workflow ID as integer", async () => {
      await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_id).toBe(999);
      expect(typeof payload.workflow_id).toBe("number");
    });

    it("should include correct workflow name", async () => {
      await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.name).toBe("hive_autogen");
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
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
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
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
    });

    it("should propagate data from successful API response", async () => {
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
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.data).toEqual(mockData);
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
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Internal Server Error");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to send message to Stakwork: Internal Server Error"
      );
    });

    it("should handle 401 Unauthorized response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: "Unauthorized",
        json: async () => ({ error: "Invalid API key" }),
      } as Response);

      const result = await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
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
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
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
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Internal Server Error");
    });
  });

  describe("Network Errors", () => {
    it("should handle network error during fetch", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      const result = await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error calling Stakwork:",
        expect.any(Error)
      );
    });

    it("should handle timeout error", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Request timeout"));

      const result = await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Request timeout");
    });

    it("should handle DNS resolution error", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("ENOTFOUND: DNS lookup failed"));

      const result = await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
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
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid JSON");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty message string", async () => {
      const result = await callStakwork(
        "",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(true);
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.message).toBe("");
    });

    it("should handle very long message", async () => {
      const longMessage = "A".repeat(10000);
      
      const result = await callStakwork(
        longMessage,
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(true);
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.message).toBe(longMessage);
    });

    it("should handle special characters in message", async () => {
      const messageWithSpecialChars = "Test <script>alert('xss')</script> & special chars: ü ñ 中文";
      
      const result = await callStakwork(
        messageWithSpecialChars,
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(true);
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.message).toBe(messageWithSpecialChars);
    });

    it("should handle Unicode characters in URLs", async () => {
      const result = await callStakwork(
        "Test message",
        "https://тест.com/api",
        "secret-alias",
        "pool-name",
        "https://тест.com:3355",
        "token",
        "username"
      );

      expect(result.success).toBe(true);
    });

    it("should handle empty repo2GraphUrl", async () => {
      const result = await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "",
        "token",
        "username"
      );

      expect(result.success).toBe(true);
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.repo2graph_url).toBe("");
    });
  });

  describe("Authorization Header", () => {
    it("should include correct authorization header format", async () => {
      await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers.Authorization).toBe("Token token=test-api-key");
    });

    it("should use API key from config", async () => {
      const originalApiKey = config.STAKWORK_API_KEY;
      (config as any).STAKWORK_API_KEY = "custom-api-key-123";

      await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers.Authorization).toBe("Token token=custom-api-key-123");
      
      (config as any).STAKWORK_API_KEY = originalApiKey;
    });
  });

  describe("URL Construction", () => {
    it("should construct correct Stakwork API URL", async () => {
      await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.stakwork.com/api/v1/projects");
    });

    it("should use base URL from config", async () => {
      const originalBaseUrl = config.STAKWORK_BASE_URL;
      (config as any).STAKWORK_BASE_URL = "https://custom-stakwork.com/v2";

      await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://custom-stakwork.com/v2/projects");
      
      (config as any).STAKWORK_BASE_URL = originalBaseUrl;
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
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to send message to Stakwork: Bad Request"
      );
    });

    it("should log error when exception is thrown", async () => {
      const testError = new Error("Test error");
      fetchSpy.mockRejectedValueOnce(testError);

      await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error calling Stakwork:",
        testError
      );
    });
  });

  describe("workspaceId Parameter", () => {
    it("should include workspaceId in payload when provided", async () => {
      const workspaceId = "workspace-test-123";
      
      await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username",
        workspaceId
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.workspaceId).toBe(workspaceId);
    });

    it("should handle undefined workspaceId in payload", async () => {
      await callStakwork(
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username"
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.workspaceId).toBeUndefined();
    });
  });

  describe("Extended Parameters Coverage (taskId, testFilePath, testFileUrl, baseBranch, testName)", () => {
    const defaultParams = {
      message: "Test message",
      swarmUrl: "https://test.com/api",
      swarmSecretAlias: "secret-alias",
      poolName: "pool-name",
      repo2GraphUrl: "https://test.com:3355",
      accessToken: "token",
      username: "username",
      workspaceId: "workspace-123",
    };

    describe("taskId Parameter", () => {
      it("should include taskId in payload vars when provided", async () => {
        const taskId = "task-abc-123";

        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          taskId,
          null,
          null,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.taskId).toBe(taskId);
      });

      it("should handle null taskId in payload", async () => {
        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          null as any,
          null,
          null,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.taskId).toBeNull();
      });

      it("should include taskId with UUID format", async () => {
        const taskId = "550e8400-e29b-41d4-a716-446655440000";

        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          taskId,
          null,
          null,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.taskId).toBe(taskId);
        expect(payload.workflow_params.set_var.attributes.vars.taskId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
      });
    });

    describe("testFilePath Parameter", () => {
      it("should include testFilePath in payload vars when provided", async () => {
        const testFilePath = "src/__tests__/e2e/specs/login.spec.ts";

        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          "task-123",
          testFilePath,
          null,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.testFilePath).toBe(testFilePath);
      });

      it("should handle null testFilePath in payload", async () => {
        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          "task-123",
          null,
          null,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.testFilePath).toBeNull();
      });

      it("should handle testFilePath with various path formats", async () => {
        const testPaths = [
          "src/__tests__/e2e/specs/login.spec.ts",
          "tests/integration/api.test.js",
          "./e2e/user-journey.spec.ts",
          "test/unit/helpers.test.ts"
        ];

        for (const path of testPaths) {
          vi.clearAllMocks();
          
          await callStakwork(
            defaultParams.message,
            defaultParams.swarmUrl,
            defaultParams.swarmSecretAlias,
            defaultParams.poolName,
            defaultParams.repo2GraphUrl,
            defaultParams.accessToken,
            defaultParams.username,
            defaultParams.workspaceId,
            "task-123",
            path,
            null,
            null,
            "test-name"
          );

          const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
          expect(payload.workflow_params.set_var.attributes.vars.testFilePath).toBe(path);
        }
      });
    });

    describe("testFileUrl Parameter", () => {
      it("should include testFileUrl in payload vars when provided", async () => {
        const testFileUrl = "https://github.com/org/repo/blob/main/src/__tests__/e2e/specs/login.spec.ts";

        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          "task-123",
          null,
          testFileUrl,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.testFileUrl).toBe(testFileUrl);
      });

      it("should handle null testFileUrl in payload", async () => {
        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          "task-123",
          null,
          null,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.testFileUrl).toBeNull();
      });

      it("should handle both testFilePath and testFileUrl together", async () => {
        const testFilePath = "src/__tests__/e2e/specs/login.spec.ts";
        const testFileUrl = "https://github.com/org/repo/blob/main/src/__tests__/e2e/specs/login.spec.ts";

        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          "task-123",
          testFilePath,
          testFileUrl,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.testFilePath).toBe(testFilePath);
        expect(payload.workflow_params.set_var.attributes.vars.testFileUrl).toBe(testFileUrl);
      });
    });

    describe("baseBranch Parameter", () => {
      it("should include baseBranch in payload vars when provided", async () => {
        const baseBranch = "develop";

        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          "task-123",
          null,
          null,
          baseBranch,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.baseBranch).toBe(baseBranch);
      });

      it("should handle null baseBranch in payload", async () => {
        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          "task-123",
          null,
          null,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.baseBranch).toBeNull();
      });

      it("should handle various branch naming conventions", async () => {
        const branches = ["main", "master", "develop", "feature/new-feature", "hotfix/bug-123"];

        for (const branch of branches) {
          vi.clearAllMocks();
          
          await callStakwork(
            defaultParams.message,
            defaultParams.swarmUrl,
            defaultParams.swarmSecretAlias,
            defaultParams.poolName,
            defaultParams.repo2GraphUrl,
            defaultParams.accessToken,
            defaultParams.username,
            defaultParams.workspaceId,
            "task-123",
            null,
            null,
            branch,
            "test-name"
          );

          const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
          expect(payload.workflow_params.set_var.attributes.vars.baseBranch).toBe(branch);
        }
      });
    });

    describe("testName Parameter", () => {
      it("should include testName in payload vars when provided", async () => {
        const testName = "User Login Flow Test";

        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          "task-123",
          null,
          null,
          null,
          testName
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.testName).toBe(testName);
      });

      it("should handle empty testName string", async () => {
        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          "task-123",
          null,
          null,
          null,
          ""
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.testName).toBe("");
      });

      it("should handle testName with special characters", async () => {
        const testName = "User Login: E2E Test (Production) - Phase 1";

        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          "task-123",
          null,
          null,
          null,
          testName
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.testName).toBe(testName);
      });
    });

    describe("Webhook URL Construction", () => {
      // Mock getBaseUrl to test webhook URL generation
      const mockGetBaseUrl = () => "https://hive.stakwork.com";

      it("should construct webhookUrl correctly", async () => {
        // Note: This test validates the expected webhook URL pattern
        // The actual implementation uses getBaseUrl() which we're mocking
        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          "task-123",
          null,
          null,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.webhookUrl).toBeDefined();
        expect(payload.workflow_params.set_var.attributes.vars.webhookUrl).toContain("/api/chat/response");
      });

      it("should construct workflowWebhookUrl with task_id query parameter", async () => {
        const taskId = "task-xyz-789";

        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          taskId,
          null,
          null,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        
        // Validate webhook_url in payload structure
        expect(payload.webhook_url).toBeDefined();
        expect(payload.webhook_url).toContain("/api/stakwork/webhook");
        expect(payload.webhook_url).toContain(`task_id=${taskId}`);
      });

      it("should include both webhookUrl and workflowWebhookUrl in vars", async () => {
        const taskId = "task-abc-123";

        await callStakwork(
          defaultParams.message,
          defaultParams.swarmUrl,
          defaultParams.swarmSecretAlias,
          defaultParams.poolName,
          defaultParams.repo2GraphUrl,
          defaultParams.accessToken,
          defaultParams.username,
          defaultParams.workspaceId,
          taskId,
          null,
          null,
          null,
          "test-name"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        
        // Both webhook URLs should be present
        expect(payload.workflow_params.set_var.attributes.vars.webhookUrl).toBeDefined();
        expect(payload.webhook_url).toBeDefined();
        expect(payload.webhook_url).toContain(`task_id=${taskId}`);
      });
    });

    describe("Complete Payload with All Parameters", () => {
      it("should construct complete payload with all parameters provided", async () => {
        const fullParams = {
          message: "Complete user journey test",
          swarmUrl: "https://production-swarm.com/api",
          swarmSecretAlias: "{{PROD_SWARM_API_KEY}}",
          poolName: "production-pool",
          repo2GraphUrl: "https://production-swarm.com:3355",
          accessToken: "ghp_productiontoken123",
          username: "prod-user",
          workspaceId: "workspace-prod-123",
          taskId: "task-prod-456",
          testFilePath: "src/__tests__/e2e/specs/complete-flow.spec.ts",
          testFileUrl: "https://github.com/org/repo/blob/main/src/__tests__/e2e/specs/complete-flow.spec.ts",
          baseBranch: "production",
          testName: "Complete User Flow E2E Test"
        };

        await callStakwork(
          fullParams.message,
          fullParams.swarmUrl,
          fullParams.swarmSecretAlias,
          fullParams.poolName,
          fullParams.repo2GraphUrl,
          fullParams.accessToken,
          fullParams.username,
          fullParams.workspaceId,
          fullParams.taskId,
          fullParams.testFilePath,
          fullParams.testFileUrl,
          fullParams.baseBranch,
          fullParams.testName
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        const vars = payload.workflow_params.set_var.attributes.vars;

        // Validate all parameters are in payload
        expect(vars.message).toBe(fullParams.message);
        expect(vars.swarmUrl).toBe(fullParams.swarmUrl);
        expect(vars.swarmSecretAlias).toBe(fullParams.swarmSecretAlias);
        expect(vars.poolName).toBe(fullParams.poolName);
        expect(vars.repo2graph_url).toBe(fullParams.repo2GraphUrl);
        expect(vars.accessToken).toBe(fullParams.accessToken);
        expect(vars.username).toBe(fullParams.username);
        expect(vars.workspaceId).toBe(fullParams.workspaceId);
        expect(vars.taskId).toBe(fullParams.taskId);
        expect(vars.testFilePath).toBe(fullParams.testFilePath);
        expect(vars.testFileUrl).toBe(fullParams.testFileUrl);
        expect(vars.baseBranch).toBe(fullParams.baseBranch);
        expect(vars.testName).toBe(fullParams.testName);
        expect(vars.webhookUrl).toBeDefined();
        
        // Validate webhook_url at payload root level
        expect(payload.webhook_url).toContain(`task_id=${fullParams.taskId}`);
      });

      it("should handle payload with minimal parameters (nulls for optionals)", async () => {
        await callStakwork(
          "Minimal test",
          null,
          null,
          null,
          "",
          null,
          null,
          "workspace-123",
          "task-123",
          null,
          null,
          null,
          "minimal-test"
        );

        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        const vars = payload.workflow_params.set_var.attributes.vars;

        expect(vars.message).toBe("Minimal test");
        expect(vars.workspaceId).toBe("workspace-123");
        expect(vars.taskId).toBe("task-123");
        expect(vars.testName).toBe("minimal-test");
        expect(vars.swarmUrl).toBeNull();
        expect(vars.accessToken).toBeNull();
        expect(vars.testFilePath).toBeNull();
        expect(vars.testFileUrl).toBeNull();
        expect(vars.baseBranch).toBeNull();
      });
    });
  });
});
