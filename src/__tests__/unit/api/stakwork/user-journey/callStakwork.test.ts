import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { StakworkWorkflowPayload } from "@/types/stakwork";

// Use shared environment mock
import "@/__tests__/support/mocks/env";
import { config } from "@/lib/env";

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
) {
  try {
    // Validate that all required Stakwork environment variables are set
    if (!config.STAKWORK_API_KEY) {
      throw new Error("STAKWORK_API_KEY is required for Stakwork integration");
    }
    if (!config.STAKWORK_USER_JOURNEY_WORKFLOW_ID) {
      throw new Error("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required for this Stakwork integration");
    }

    // stakwork workflow vars
    const vars = {
      message,
      accessToken,
      username,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2graph_url: repo2GraphUrl,
      workspaceId,
    };

    const workflowId = config.STAKWORK_USER_JOURNEY_WORKFLOW_ID || "";
    if (!workflowId) {
      throw new Error("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required for this Stakwork integration");
    }

    const stakworkPayload: StakworkWorkflowPayload = {
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
        "username",
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
        "username",
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
        "username",
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
        testParams.username,
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
        null,
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.accessToken).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.username).toBeNull();
    });

    it("should handle null swarm parameters in payload", async () => {
      await callStakwork("Test message", null, null, null, "", "token", "username");

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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "Test message",
        "https://test.com/api",
        "secret-alias",
        "pool-name",
        "https://test.com:3355",
        "token",
        "username",
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
        "username",
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
        "username",
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
        "username",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error calling Stakwork:", expect.any(Error));
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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "username",
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
        "username",
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to send message to Stakwork: Bad Request");
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
        "username",
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith("Error calling Stakwork:", testError);
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
        workspaceId,
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
        "username",
      );

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.workspaceId).toBeUndefined();
    });
  });
});
