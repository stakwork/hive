import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { dropPod } from "@/lib/pods/utils";

// Mock environment config
vi.mock("@/lib/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool-manager.test.com",
  },
}));

describe("dropPod utility function - Unit Tests", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("API Call Construction", () => {
    test("should call markWorkspaceAsUnused with correct URL structure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Pod dropped successfully",
      });

      await dropPod("test-pool", "workspace-123", "api-key-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://pool-manager.test.com/pools/test-pool/workspaces/workspace-123/mark-unused",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer api-key-123",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({}),
        })
      );
    });

    test("should URL-encode pool name with special characters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      await dropPod("test pool with spaces", "workspace-456", "api-key");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("pools/test%20pool%20with%20spaces"),
        expect.any(Object)
      );
    });

    test("should include Authorization Bearer token in headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      await dropPod("pool-name", "workspace-id", "secure-api-key-789");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer secure-api-key-789",
          }),
        })
      );
    });

    test("should send POST request with empty JSON body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      await dropPod("pool", "workspace", "key");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({}),
        })
      );
    });
  });

  describe("Success Scenarios", () => {
    test("should resolve successfully when API returns 200", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Success message",
      });

      await expect(
        dropPod("pool-name", "workspace-id", "api-key")
      ).resolves.toBeUndefined();
    });

    test("should log success message when pod is dropped", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Pod dropped successfully",
      });

      await dropPod("test-pool", "workspace-123", "api-key");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(">>> Pod dropped successfully (200):"),
        "Pod dropped successfully"
      );
    });

    test("should handle empty response body on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      await expect(
        dropPod("pool", "workspace", "key")
      ).resolves.toBeUndefined();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(">>> Pod dropped successfully (200):"),
        "No response body"
      );
    });
  });

  describe("Error Handling - HTTP Errors", () => {
    test("should throw error with status code on 404 Not Found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Pool or workspace not found",
      });

      await expect(dropPod("pool", "workspace", "key")).rejects.toThrow(
        "Failed to drop pod: 404"
      );
    });

    test("should throw error with status code on 401 Unauthorized", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Invalid API key",
      });

      await expect(dropPod("pool", "workspace", "key")).rejects.toThrow(
        "Failed to drop pod: 401"
      );
    });

    test("should throw error with status code on 403 Forbidden", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Permission denied",
      });

      await expect(dropPod("pool", "workspace", "key")).rejects.toThrow(
        "Failed to drop pod: 403"
      );
    });

    test("should throw error with status code on 500 Internal Server Error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      });

      await expect(dropPod("pool", "workspace", "key")).rejects.toThrow(
        "Failed to drop pod: 500"
      );
    });

    test("should log error details before throwing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Workspace not found in pool",
      });

      await expect(dropPod("pool", "workspace-id", "key")).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to drop pod: 404 - Workspace not found in pool"
      );
    });
  });

  describe("Error Handling - Network Errors", () => {
    test("should throw error on network failure", async () => {
      mockFetch.mockRejectedValueOnce(
        new Error("Network request failed: ECONNREFUSED")
      );

      await expect(
        dropPod("pool", "workspace", "key")
      ).rejects.toThrow("Network request failed: ECONNREFUSED");
    });

    test("should throw error on timeout", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      await expect(
        dropPod("pool", "workspace", "key")
      ).rejects.toThrow("Request timeout");
    });

    test("should throw error on DNS resolution failure", async () => {
      mockFetch.mockRejectedValueOnce(
        new Error("getaddrinfo ENOTFOUND pool-manager.test.com")
      );

      await expect(
        dropPod("pool", "workspace", "key")
      ).rejects.toThrow("getaddrinfo ENOTFOUND");
    });
  });

  describe("No Local State Mutations", () => {
    test("should only make external API call without database writes", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      await dropPod("pool", "workspace-id", "api-key");

      // Verify ONLY external API call was made
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("pool-manager.test.com"),
        expect.any(Object)
      );
    });

    test("should not perform any local database operations", async () => {
      // This test verifies the function's behavior by checking it only calls fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      await dropPod("pool", "workspace", "key");

      // The function should only interact with external API
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // No other operations should occur
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty string parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      await dropPod("", "", "");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://pool-manager.test.com/pools//workspaces//mark-unused",
        expect.any(Object)
      );
    });

    test("should handle pool name with special URL characters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      await dropPod("pool/name?test=1&foo=bar", "workspace", "key");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("pools/pool%2Fname%3Ftest%3D1%26foo%3Dbar"),
        expect.any(Object)
      );
    });

    test("should handle very long API keys", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const longApiKey = "a".repeat(1000);
      await dropPod("pool", "workspace", longApiKey);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${longApiKey}`,
          }),
        })
      );
    });

    test("should handle API key with special characters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const specialKey = "key!@#$%^&*()_+-=[]{}|;:',.<>?/`~";
      await dropPod("pool", "workspace", specialKey);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${specialKey}`,
          }),
        })
      );
    });
  });

  describe("Response Parsing", () => {
    test("should parse text response on success", async () => {
      const responseText = "Pod successfully marked as unused";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => responseText,
      });

      await dropPod("pool", "workspace", "key");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.any(String),
        responseText
      );
    });

    test("should parse text response on error", async () => {
      const errorText = "Detailed error message from Pool Manager";
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => errorText,
      });

      await expect(dropPod("pool", "workspace", "key")).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Failed to drop pod: 400 - ${errorText}`
      );
    });
  });

  describe("Logging Behavior", () => {
    test("should log marking workspace as unused before API call", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      await dropPod("test-pool", "workspace-789", "key");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(">>> Marking workspace as unused: POST https://pool-manager.test.com/pools/test-pool/workspaces/workspace-789/mark-unused")
      );
    });

    test("should log success with status code", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Success",
      });

      await dropPod("pool", "workspace", "key");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(">>> Pod dropped successfully (200):"),
        expect.any(String)
      );
    });

    test("should log error with status code and details", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Workspace not found",
      });

      await expect(dropPod("pool", "workspace", "key")).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to drop pod: 404 - Workspace not found"
      );
    });
  });
});