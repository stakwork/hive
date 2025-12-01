import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchSwarmDetails } from "@/services/swarm/api/swarm";

// Mock the env module
vi.mock("@/config/env", () => ({
  env: {
    SWARM_SUPER_ADMIN_URL: "https://test-swarm-admin.example.com",
    SWARM_SUPERADMIN_API_KEY: "test-super-admin-key-12345",
  },
}));

describe("fetchSwarmDetails", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Spy on global fetch
    fetchSpy = vi.spyOn(globalThis, "fetch");

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Successful Retrieval", () => {
    it("should successfully retrieve swarm details on first attempt", async () => {
      const mockResponseData = {
        success: true,
        data: {
          x_api_key: "swarm-api-key-abc123",
          swarm_id: "swarm-123",
          address: "https://swarm-123.example.com",
          ec2_id: "i-1234567890abcdef0",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
      } as Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        ok: true,
        status: 200,
        data: mockResponseData,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://test-swarm-admin.example.com/api/super/details?id=swarm-123",
        {
          method: "GET",
          headers: {
            "x-super-token": "test-super-admin-key-12345",
          },
        }
      );

      expect(consoleLogSpy).toHaveBeenCalledWith("Attempt: 1/10 for swarm swarm-123");
    });

    it("should properly encode swarm ID in URL", async () => {
      const swarmIdWithSpecialChars = "swarm-123/test?param=value";
      const mockResponseData = { success: true, data: {} };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
      } as Response);

      const promise = fetchSwarmDetails(swarmIdWithSpecialChars);
      await vi.runAllTimersAsync();
      await promise;

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://test-swarm-admin.example.com/api/super/details?id=swarm-123%2Ftest%3Fparam%3Dvalue",
        expect.any(Object)
      );
    });

    it("should include authentication header with super admin key", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      await promise;

      const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders["x-super-token"]).toBe("test-super-admin-key-12345");
    });
  });

  describe("Retry Logic for 400 Errors", () => {
    it("should retry up to 10 times for 400 errors", async () => {
      const mock400Response = {
        ok: false,
        status: 400,
        json: async () => ({ error: "Swarm not ready" }),
      } as Response;

      fetchSpy.mockResolvedValue(mock400Response);

      const promise = fetchSwarmDetails("swarm-123");

      // Run through all retries
      for (let i = 0; i < 10; i++) {
        await vi.runAllTimersAsync();
      }

      const result = await promise;

      expect(result).toEqual({
        ok: false,
        status: 400,
        data: { error: "Swarm not ready" },
      });

      expect(fetchSpy).toHaveBeenCalledTimes(10);
      expect(consoleLogSpy).toHaveBeenCalledWith("Attempt: 10/10 for swarm swarm-123");
    });

    it("should retry with 1-second delays between 400 error attempts", async () => {
      const mock400Response = {
        ok: false,
        status: 400,
        json: async () => ({ error: "Swarm not ready" }),
      } as Response;

      fetchSpy.mockResolvedValue(mock400Response);

      const promise = fetchSwarmDetails("swarm-123");

      // First attempt should happen immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second attempt should happen after 1 second
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Third attempt after another second
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // Complete remaining retries
      await vi.runAllTimersAsync();
      await promise;
    });

    it("should log retry messages for 400 errors", async () => {
      const mock400Response = {
        ok: false,
        status: 400,
        json: async () => ({ error: "Swarm not ready" }),
      } as Response;

      fetchSpy.mockResolvedValue(mock400Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      await promise;

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Got 400 error, will retry in 1000ms...")
      );
    });

    it("should succeed after retries if swarm becomes ready", async () => {
      const mock400Response = {
        ok: false,
        status: 400,
        json: async () => ({ error: "Swarm not ready" }),
      } as Response;

      const mockSuccessResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { x_api_key: "new-key", swarm_id: "swarm-123" },
        }),
      } as Response;

      // First 3 attempts fail with 400, then succeed
      fetchSpy
        .mockResolvedValueOnce(mock400Response)
        .mockResolvedValueOnce(mock400Response)
        .mockResolvedValueOnce(mock400Response)
        .mockResolvedValueOnce(mockSuccessResponse);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe("Non-400 Error Handling", () => {
    it("should return immediately for 500 errors without retry", async () => {
      const mock500Response = {
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      } as Response;

      fetchSpy.mockResolvedValueOnce(mock500Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        ok: false,
        status: 500,
        data: { error: "Internal server error" },
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should return immediately for 404 errors without retry", async () => {
      const mock404Response = {
        ok: false,
        status: 404,
        json: async () => ({ error: "Swarm not found" }),
      } as Response;

      fetchSpy.mockResolvedValueOnce(mock404Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        ok: false,
        status: 404,
        data: { error: "Swarm not found" },
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should return immediately for 401 unauthorized errors without retry", async () => {
      const mock401Response = {
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      } as Response;

      fetchSpy.mockResolvedValueOnce(mock401Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        ok: false,
        status: 401,
        data: { error: "Unauthorized" },
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should return immediately for 403 forbidden errors without retry", async () => {
      const mock403Response = {
        ok: false,
        status: 403,
        json: async () => ({ error: "Forbidden" }),
      } as Response;

      fetchSpy.mockResolvedValueOnce(mock403Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        ok: false,
        status: 403,
        data: { error: "Forbidden" },
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Network Error Handling", () => {
    it("should handle network failures gracefully", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network connection failed"));

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        ok: false,
        status: 500,
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "fetchSwarmDetails network error:",
        expect.any(Error)
      );
    });

    it("should retry after network failures and eventually return last error", async () => {
      fetchSpy.mockRejectedValue(new Error("Network timeout"));

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        ok: false,
        status: 500,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(10);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(10);
    });

    it("should succeed if network recovers after failures", async () => {
      const mockSuccessResponse = {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { x_api_key: "key-123" } }),
      } as Response;

      fetchSpy
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(mockSuccessResponse);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe("Response Structure Validation", () => {
    it("should return correct structure for successful responses", async () => {
      const mockData = {
        success: true,
        data: {
          x_api_key: "key-123",
          swarm_id: "swarm-456",
          address: "https://swarm.example.com",
          ec2_id: "i-abc123",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      } as Response);

      const promise = fetchSwarmDetails("swarm-456");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("data");
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data).toEqual(mockData);
    });

    it("should handle responses with missing data fields", async () => {
      const mockData = {
        success: true,
        data: {
          x_api_key: "key-123",
          // Missing swarm_id, address, ec2_id
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      } as Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockData);
    });

    it("should handle responses without success field", async () => {
      const mockData = {
        data: { x_api_key: "key-123" },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      } as Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockData);
    });

    it("should handle responses with error messages", async () => {
      const errorData = {
        success: false,
        error: "Invalid swarm configuration",
        message: "Swarm setup incomplete",
      };

      // Mock all 10 attempts with the same 400 error
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => errorData,
      } as Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        ok: false,
        status: 400,
        data: errorData,
      });
    });
  });

  describe("Field Mapping and Parsing", () => {
    it("should correctly parse all expected fields from response", async () => {
      const mockResponseData = {
        success: true,
        data: {
          x_api_key: "swarm-api-key-xyz789",
          swarm_id: "swarm-999",
          address: "https://swarm-999.production.example.com",
          ec2_id: "i-0123456789abcdef0",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
      } as Response);

      const promise = fetchSwarmDetails("swarm-999");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.data).toEqual(mockResponseData);
      const responseData = result.data as typeof mockResponseData;
      expect(responseData.data.x_api_key).toBe("swarm-api-key-xyz789");
      expect(responseData.data.swarm_id).toBe("swarm-999");
      expect(responseData.data.address).toBe("https://swarm-999.production.example.com");
      expect(responseData.data.ec2_id).toBe("i-0123456789abcdef0");
    });

    it("should handle snake_case field names correctly", async () => {
      const mockResponseData = {
        success: true,
        data: {
          x_api_key: "key",
          swarm_id: "id",
          ec2_id: "ec2",
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponseData,
      } as Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      const responseData = result.data as typeof mockResponseData;
      expect(responseData.data).toHaveProperty("x_api_key");
      expect(responseData.data).toHaveProperty("swarm_id");
      expect(responseData.data).toHaveProperty("ec2_id");
    });
  });

  describe("Console Logging Verification", () => {
    it("should log each attempt number", async () => {
      const mock400Response = {
        ok: false,
        status: 400,
        json: async () => ({ error: "Not ready" }),
      } as Response;

      fetchSpy.mockResolvedValue(mock400Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      await promise;

      expect(consoleLogSpy).toHaveBeenCalledWith("Attempt: 1/10 for swarm swarm-123");
      expect(consoleLogSpy).toHaveBeenCalledWith("Attempt: 5/10 for swarm swarm-123");
      expect(consoleLogSpy).toHaveBeenCalledWith("Attempt: 10/10 for swarm swarm-123");
    });

    it("should log retry messages only for 400 errors", async () => {
      const mock400Response = {
        ok: false,
        status: 400,
        json: async () => ({ error: "Not ready" }),
      } as Response;

      // Mock all 10 attempts to ensure retries happen
      fetchSpy.mockResolvedValue(mock400Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      await promise;

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "Got 400 error, will retry in 1000ms..."
      );
    });

    it("should not log retry messages for non-400 errors", async () => {
      const mock500Response = {
        ok: false,
        status: 500,
        json: async () => ({ error: "Server error" }),
      } as Response;

      fetchSpy.mockResolvedValueOnce(mock500Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      await promise;

      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("will retry")
      );
    });

    it("should log network errors to console.error", async () => {
      const networkError = new Error("Connection refused");
      
      // Mock all 10 attempts to reject
      fetchSpy.mockRejectedValue(networkError);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      await promise;

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "fetchSwarmDetails network error:",
        networkError
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty swarm ID", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const promise = fetchSwarmDetails("");
      await vi.runAllTimersAsync();
      await promise;

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://test-swarm-admin.example.com/api/super/details?id=",
        expect.any(Object)
      );
    });

    it("should handle swarm ID with special characters", async () => {
      const specialId = "swarm-123!@#$%^&*()";
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const promise = fetchSwarmDetails(specialId);
      await vi.runAllTimersAsync();
      await promise;

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("id=swarm-123"),
        expect.any(Object)
      );
    });

    it("should handle very long swarm IDs", async () => {
      const longId = "swarm-" + "x".repeat(1000);
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const promise = fetchSwarmDetails(longId);
      await vi.runAllTimersAsync();
      await promise;

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should handle responses with null data", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => null,
      } as Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        ok: true,
        status: 200,
        data: null,
      });
    });

    it("should handle responses with undefined data", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => undefined,
      } as Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        ok: true,
        status: 200,
        data: undefined,
      });
    });
  });

  describe("Retry Exhaustion", () => {
    it("should return last error after all retries exhausted", async () => {
      const mock400Response = {
        ok: false,
        status: 400,
        json: async () => ({ error: "Still not ready" }),
      } as Response;

      fetchSpy.mockResolvedValue(mock400Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        ok: false,
        status: 400,
        data: { error: "Still not ready" },
      });

      expect(fetchSpy).toHaveBeenCalledTimes(10);
    });

    it("should not exceed maximum retry count", async () => {
      const mock400Response = {
        ok: false,
        status: 400,
        json: async () => ({ error: "Not ready" }),
      } as Response;

      fetchSpy.mockResolvedValue(mock400Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      await promise;

      expect(fetchSpy).toHaveBeenCalledTimes(10);
      expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(10);
    });

    it("should not delay after final retry attempt", async () => {
      const mock400Response = {
        ok: false,
        status: 400,
        json: async () => ({ error: "Not ready" }),
      } as Response;

      fetchSpy.mockResolvedValue(mock400Response);

      const promise = fetchSwarmDetails("swarm-123");
      await vi.runAllTimersAsync();
      await promise;

      // Verify that we made exactly 10 attempts and no more
      expect(fetchSpy).toHaveBeenCalledTimes(10);
      
      // Verify we logged all 10 attempts, including the final one
      expect(consoleLogSpy).toHaveBeenCalledWith("Attempt: 10/10 for swarm swarm-123");
    });
  });
});