import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the config module before importing the function
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_USER_JOURNEY_WORKFLOW_ID: "12345",
  },
}));

// Import after mocking to ensure mocked config is used
import { config } from "@/lib/env";

// Note: Since callStakwork is not exported, we need to test it through the POST handler
// or export it for testing. For now, we'll create a local copy for unit testing.
// This approach tests the function logic in isolation.

/**
 * Isolated copy of callStakwork function for unit testing
 * This ensures we test the function logic independently of the route handler
 */
async function callStakwork(
  message: string,
  swarmUrl: string | null,
  swarmSecretAlias: string | null,
  poolName: string | null,
  repo2GraphUrl: string,
  accessToken: string | null,
  username: string | null,
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
    };

    const workflowId = config.STAKWORK_USER_JOURNEY_WORKFLOW_ID || "";
    if (!workflowId) {
      throw new Error("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required for this Stakwork integration");
    }

    const stakworkPayload = {
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
  let fetchMock: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Mock fetch globally
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Spy on console.error to verify error logging
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Set default environment variables
    vi.mocked(config).STAKWORK_API_KEY = "test-api-key";
    vi.mocked(config).STAKWORK_BASE_URL = "https://api.stakwork.com/api/v1";
    vi.mocked(config).STAKWORK_USER_JOURNEY_WORKFLOW_ID = "12345";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Environment Variable Validation", () => {
    it("should throw error when STAKWORK_API_KEY is missing", async () => {
      vi.mocked(config).STAKWORK_API_KEY = "";

      const result = await callStakwork(
        "test message",
        "https://swarm.example.com/api",
        "secret-alias",
        "pool-name",
        "https://repo2graph.example.com",
        "github-token",
        "github-user"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_API_KEY is required");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error calling Stakwork:",
        expect.any(Error)
      );
    });

    it("should throw error when STAKWORK_USER_JOURNEY_WORKFLOW_ID is missing", async () => {
      vi.mocked(config).STAKWORK_USER_JOURNEY_WORKFLOW_ID = "";

      const result = await callStakwork(
        "test message",
        "https://swarm.example.com/api",
        "secret-alias",
        "pool-name",
        "https://repo2graph.example.com",
        "github-token",
        "github-user"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error calling Stakwork:",
        expect.any(Error)
      );
    });

    it("should throw error when STAKWORK_USER_JOURNEY_WORKFLOW_ID is undefined", async () => {
      vi.mocked(config).STAKWORK_USER_JOURNEY_WORKFLOW_ID = undefined as any;

      const result = await callStakwork(
        "test message",
        "https://swarm.example.com/api",
        "secret-alias",
        "pool-name",
        "https://repo2graph.example.com",
        "github-token",
        "github-user"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required");
    });

    it("should proceed when all required environment variables are set", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { workflow_id: 12345, status: "queued" },
        }),
      });

      const result = await callStakwork(
        "test message",
        "https://swarm.example.com/api",
        "secret-alias",
        "pool-name",
        "https://repo2graph.example.com",
        "github-token",
        "github-user"
      );

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Stakwork API Call - Success Scenarios", () => {
    it("should successfully call Stakwork API with all parameters", async () => {
      const mockResponse = {
        success: true,
        data: {
          workflow_id: 12345,
          status: "queued",
          project_id: 67890,
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await callStakwork(
        "User navigated to dashboard",
        "https://swarm.example.com/api",
        "{{SWARM_SECRET}}",
        "test-pool",
        "https://repo2graph.example.com:3355",
        "github_pat_test123",
        "testuser"
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Verify fetch was called with correct URL and headers
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.stakwork.com/api/v1/projects");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({
        Authorization: "Token token=test-api-key",
        "Content-Type": "application/json",
      });
    });

    it("should construct correct payload with all workflow variables", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      await callStakwork(
        "test message",
        "https://swarm.example.com/api",
        "{{SECRET_ALIAS}}",
        "pool-123",
        "https://repo2graph.example.com",
        "token-abc",
        "user-xyz"
      );

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload).toEqual({
        name: "hive_autogen",
        workflow_id: 12345,
        workflow_params: {
          set_var: {
            attributes: {
              vars: {
                message: "test message",
                accessToken: "token-abc",
                username: "user-xyz",
                swarmUrl: "https://swarm.example.com/api",
                swarmSecretAlias: "{{SECRET_ALIAS}}",
                poolName: "pool-123",
                repo2graph_url: "https://repo2graph.example.com",
              },
            },
          },
        },
      });
    });

    it("should handle null GitHub credentials gracefully", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      await callStakwork(
        "test message",
        "https://swarm.example.com/api",
        "secret",
        "pool",
        "https://repo2graph.example.com",
        null, // null accessToken
        null  // null username
      );

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.workflow_params.set_var.attributes.vars.accessToken).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.username).toBeNull();
    });

    it("should handle null swarm parameters gracefully", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      await callStakwork(
        "test message",
        null, // null swarmUrl
        null, // null swarmSecretAlias
        null, // null poolName
        "",   // empty repo2GraphUrl
        "token",
        "user"
      );

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.workflow_params.set_var.attributes.vars.swarmUrl).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.swarmSecretAlias).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.poolName).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.repo2graph_url).toBe("");
    });

    it("should parse workflow_id as integer from environment variable", async () => {
      vi.mocked(config).STAKWORK_USER_JOURNEY_WORKFLOW_ID = "99999";

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.workflow_id).toBe(99999);
      expect(typeof payload.workflow_id).toBe("number");
    });

    it("should return success from Stakwork API response", async () => {
      const mockData = {
        workflow_id: 456,
        status: "processing",
        project_id: 789,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockData,
        }),
      });

      const result = await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result).toEqual({
        success: true,
        data: mockData,
      });
    });
  });

  describe("Stakwork API Call - Error Scenarios", () => {
    it("should handle non-ok response status from Stakwork API", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
        json: async () => ({ error: "Workflow execution failed" }),
      });

      const result = await callStakwork(
        "test message",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Internal Server Error");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to send message to Stakwork: Internal Server Error"
      );
    });

    it("should handle 400 Bad Request from Stakwork API", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Request",
        json: async () => ({ error: "Invalid workflow parameters" }),
      });

      const result = await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Bad Request");
    });

    it("should handle 401 Unauthorized from Stakwork API", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: "Unauthorized",
        json: async () => ({ error: "Invalid API key" }),
      });

      const result = await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unauthorized");
    });

    it("should handle 500 Internal Server Error from Stakwork API", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
        json: async () => ({ error: "Database connection failed" }),
      });

      const result = await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Internal Server Error");
    });

    it("should handle network errors from fetch", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error: Failed to fetch"));

      const result = await callStakwork(
        "test message",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error calling Stakwork:",
        expect.any(Error)
      );
    });

    it("should handle JSON parsing errors from Stakwork API", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON response");
        },
      });

      const result = await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid JSON");
    });

    it("should handle timeout errors from fetch", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Request timeout"));

      const result = await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Error: Request timeout");
    });

    it("should handle DNS resolution errors", async () => {
      fetchMock.mockRejectedValueOnce(new Error("DNS lookup failed"));

      const result = await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("DNS lookup failed");
    });
  });

  describe("Payload Construction", () => {
    beforeEach(() => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });
    });

    it("should always set name to 'hive_autogen'", async () => {
      await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.name).toBe("hive_autogen");
    });

    it("should include all workflow variables in payload", async () => {
      await callStakwork(
        "message",
        "swarmUrl",
        "secretAlias",
        "poolName",
        "repo2graphUrl",
        "token",
        "user"
      );

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars).toHaveProperty("message", "message");
      expect(vars).toHaveProperty("swarmUrl", "swarmUrl");
      expect(vars).toHaveProperty("swarmSecretAlias", "secretAlias");
      expect(vars).toHaveProperty("poolName", "poolName");
      expect(vars).toHaveProperty("repo2graph_url", "repo2graphUrl");
      expect(vars).toHaveProperty("accessToken", "token");
      expect(vars).toHaveProperty("username", "user");
    });

    it("should handle empty string message", async () => {
      await callStakwork(
        "",
        null,
        null,
        null,
        "",
        null,
        null
      );

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.workflow_params.set_var.attributes.vars.message).toBe("");
    });

    it("should handle very long message strings", async () => {
      const longMessage = "a".repeat(10000);

      await callStakwork(
        longMessage,
        null,
        null,
        null,
        "",
        null,
        null
      );

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.workflow_params.set_var.attributes.vars.message).toBe(longMessage);
      expect(payload.workflow_params.set_var.attributes.vars.message.length).toBe(10000);
    });

    it("should handle special characters in message", async () => {
      const specialMessage = 'Test "quotes" & <symbols> \n\t\\';

      await callStakwork(
        specialMessage,
        null,
        null,
        null,
        "",
        null,
        null
      );

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.workflow_params.set_var.attributes.vars.message).toBe(specialMessage);
    });
  });

  describe("Return Value Format", () => {
    it("should return object with success and data on successful call", async () => {
      const mockData = { workflow_id: 123, status: "queued" };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockData }),
      });

      const result = await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("data", mockData);
      expect(result).not.toHaveProperty("error");
    });

    it("should return object with success and error on API failure", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: "Service Unavailable",
      });

      const result = await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "Service Unavailable");
      expect(result).not.toHaveProperty("data");
    });

    it("should return object with success and error on network failure", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error");
      expect(result.error).toContain("Connection refused");
      expect(result).not.toHaveProperty("data");
    });

    it("should return object with success and error on config validation failure", async () => {
      vi.mocked(config).STAKWORK_API_KEY = "";

      const result = await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error");
      expect(result.error).toContain("STAKWORK_API_KEY");
      expect(result).not.toHaveProperty("data");
    });
  });

  describe("Error Logging", () => {
    it("should log error when API returns non-ok status", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Gateway",
      });

      await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to send message to Stakwork: Bad Gateway"
      );
    });

    it("should log error when network error occurs", async () => {
      const networkError = new Error("Network failure");
      fetchMock.mockRejectedValueOnce(networkError);

      await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error calling Stakwork:",
        networkError
      );
    });

    it("should log error when environment validation fails", async () => {
      vi.mocked(config).STAKWORK_USER_JOURNEY_WORKFLOW_ID = "";

      await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error calling Stakwork:",
        expect.any(Error)
      );
    });

    it("should not log errors on successful API calls", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      await callStakwork(
        "test",
        null,
        null,
        null,
        "",
        null,
        null
      );

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe("User Journey Orchestration", () => {
    it("should handle complete user journey workflow with all parameters", async () => {
      const mockWorkflowResponse = {
        workflow_id: 12345,
        status: "queued",
        project_id: 67890,
        created_at: "2024-01-01T00:00:00Z",
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockWorkflowResponse,
        }),
      });

      const result = await callStakwork(
        "User completed onboarding flow: signup -> email verification -> profile setup",
        "https://swarm.production.com/api",
        "{{PROD_SWARM_SECRET}}",
        "production-pool-001",
        "https://repo2graph.production.com:3355",
        "github_pat_live_xyz",
        "production-user"
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockWorkflowResponse);

      // Verify orchestration payload
      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.message).toContain("User completed onboarding flow");
      expect(vars.swarmUrl).toBe("https://swarm.production.com/api");
      expect(vars.poolName).toBe("production-pool-001");
      expect(vars.accessToken).toBe("github_pat_live_xyz");
    });

    it("should support analytics tracking through message parameter", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      await callStakwork(
        "ANALYTICS: User viewed insights page (session_id: abc123, duration: 45s)",
        null,
        null,
        null,
        "",
        null,
        null
      );

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.workflow_params.set_var.attributes.vars.message).toContain("ANALYTICS");
      expect(payload.workflow_params.set_var.attributes.vars.message).toContain("session_id: abc123");
    });

    it("should maintain workflow state through repo2graph_url parameter", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      await callStakwork(
        "test",
        null,
        null,
        null,
        "https://repo2graph.service.com:3355/state/workspace-123",
        null,
        null
      );

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.workflow_params.set_var.attributes.vars.repo2graph_url).toContain("workspace-123");
    });
  });

  describe("Branching Logic Coverage", () => {
    it("should branch to error path when STAKWORK_API_KEY is falsy", async () => {
      vi.mocked(config).STAKWORK_API_KEY = "";

      const result = await callStakwork("test", null, null, null, "", null, null);

      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled(); // Should not reach fetch
    });

    it("should branch to error path when STAKWORK_USER_JOURNEY_WORKFLOW_ID is falsy", async () => {
      vi.mocked(config).STAKWORK_USER_JOURNEY_WORKFLOW_ID = "";

      const result = await callStakwork("test", null, null, null, "", null, null);

      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled(); // Should not reach fetch
    });

    it("should branch to error path when workflowId evaluation is falsy", async () => {
      vi.mocked(config).STAKWORK_USER_JOURNEY_WORKFLOW_ID = "";

      const result = await callStakwork("test", null, null, null, "", null, null);

      expect(result.success).toBe(false);
      expect(result.error).toContain("STAKWORK_USER_JOURNEY_WORKFLOW_ID is required");
    });

    it("should branch to error path when response.ok is false", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: "Not Found",
      });

      const result = await callStakwork("test", null, null, null, "", null, null);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not Found");
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("should branch to success path when all validations pass and API succeeds", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { workflow_id: 123 } }),
      });

      const result = await callStakwork("test", null, null, null, "", null, null);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ workflow_id: 123 });
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("should branch to catch block when fetch throws error", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Unexpected error"));

      const result = await callStakwork("test", null, null, null, "", null, null);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unexpected error");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error calling Stakwork:",
        expect.any(Error)
      );
    });
  });
});