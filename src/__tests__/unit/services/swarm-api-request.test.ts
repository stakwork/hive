import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";

// Mock the EncryptionService
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn().mockReturnValue({
      decryptField: vi.fn(),
    }),
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("swarmApiRequest", () => {
  const mockEncryptionService = EncryptionService.getInstance();
  const mockDecryptField = mockEncryptionService.decryptField as vi.Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptField.mockReturnValue("decrypted-api-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("URL Construction", () => {
    test("should construct URL correctly with trailing slash in swarmUrl", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve('{"success": true}'),
      });

      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799/",
        endpoint: "/sync",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.sphinx.chat:7799/sync",
        expect.any(Object)
      );
    });

    test("should construct URL correctly without trailing slash in swarmUrl", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve('{"success": true}'),
      });

      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/sync",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.sphinx.chat:7799/sync",
        expect.any(Object)
      );
    });

    test("should handle endpoint without leading slash", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve('{"success": true}'),
      });

      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "sync",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.sphinx.chat:7799/sync",
        expect.any(Object)
      );
    });

    test("should handle complex endpoints with query parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve('{"success": true}'),
      });

      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:3355",
        endpoint: "/graph?limit=200&node_types=Function",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.sphinx.chat:3355/graph?limit=200&node_types=Function",
        expect.any(Object)
      );
    });

    test("should handle different port numbers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve('{"success": true}'),
      });

      await swarmApiRequest({
        swarmUrl: "https://myswarm.sphinx.chat:3355",
        endpoint: "/schema",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://myswarm.sphinx.chat:3355/schema",
        expect.any(Object)
      );
    });
  });

  describe("Header Encryption/Decryption", () => {
    test("should decrypt API key for headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve('{"success": true}'),
      });

      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/sync",
        method: "GET",
        apiKey: "encrypted-api-key",
      });

      expect(mockDecryptField).toHaveBeenCalledWith("swarmApiKey", "encrypted-api-key");
    });

    test("should set proper headers with decrypted API key", async () => {
      mockDecryptField.mockReturnValue("my-decrypted-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve('{"success": true}'),
      });

      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/sync",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            "Authorization": "Bearer my-decrypted-key",
            "x-api-token": "my-decrypted-key",
            "Content-Type": "application/json",
          },
        })
      );
    });

    test("should handle encryption service errors", async () => {
      mockDecryptField.mockImplementation(() => {
        throw new Error("Invalid encryption key");
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/sync",
        method: "GET",
        apiKey: "invalid-key",
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });

    test("should handle different API key formats", async () => {
      const testCases = [
        "simple-key",
        "key-with-dashes",
        "KEY_WITH_UNDERSCORES",
        "keyWithCamelCase",
        "key.with.dots",
      ];

      for (const key of testCases) {
        mockDecryptField.mockReturnValue(`decrypted-${key}`);
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
          text: () => Promise.resolve('{"success": true}'),
        });

        await swarmApiRequest({
          swarmUrl: "https://test.sphinx.chat:7799",
          endpoint: "/sync",
          method: "GET",
          apiKey: key,
        });

        expect(mockDecryptField).toHaveBeenCalledWith("swarmApiKey", key);
      }
    });
  });

  describe("HTTP Methods", () => {
    test("should handle GET requests properly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: "get-response" }),
        text: () => Promise.resolve('{"data": "get-response"}'),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/schema",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "GET",
          headers: expect.any(Object),
        })
      );
      expect(result).toEqual({
        ok: true,
        data: { data: "get-response" },
        status: 200,
      });
    });

    test("should handle POST requests with data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ request_id: "12345" }),
        text: () => Promise.resolve('{"request_id": "12345"}'),
      });

      const postData = {
        repo_url: "https://github.com/user/repo",
        username: "testuser",
        pat: "github-token",
      };

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/ingest_async",
        method: "POST",
        apiKey: "encrypted-key",
        data: postData,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          headers: expect.any(Object),
          body: JSON.stringify(postData),
        })
      );
      expect(result).toEqual({
        ok: true,
        data: { request_id: "12345" },
        status: 201,
      });
    });

    test("should handle PUT requests with data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ updated: true }),
        text: () => Promise.resolve('{"updated": true}'),
      });

      const putData = { name: "updated-swarm" };

      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/swarm/123",
        method: "PUT",
        apiKey: "encrypted-key",
        data: putData,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(putData),
        })
      );
    });

    test("should handle DELETE requests", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      });

      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/swarm/123",
        method: "DELETE",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "DELETE",
          headers: expect.any(Object),
        })
      );
    });

    test("should not include body for GET and DELETE requests", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve("{}"),
      });

      // Test GET
      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/test",
        method: "GET",
        apiKey: "encrypted-key",
        data: { should: "be ignored" },
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          body: expect.any(String),
        })
      );

      // Test DELETE
      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/test",
        method: "DELETE",
        apiKey: "encrypted-key",
        data: { should: "be ignored" },
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          body: expect.any(String),
        })
      );
    });
  });

  describe("JSON Parsing", () => {
    test("should parse valid JSON responses", async () => {
      const responseData = {
        success: true,
        data: { nodes: 10, edges: 5 },
        message: "Success",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseData),
        text: () => Promise.resolve(JSON.stringify(responseData)),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/graph",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: responseData,
        status: 200,
      });
    });

    test("should handle malformed JSON responses gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("Invalid JSON")),
        text: () => Promise.resolve("invalid json response"),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/test",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: undefined,
        status: 200,
      });
    });

    test("should handle empty responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.reject(new Error("No content")),
        text: () => Promise.resolve(""),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/test",
        method: "DELETE",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: undefined,
        status: 204,
      });
    });

    test("should handle non-JSON text responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("Not JSON")),
        text: () => Promise.resolve("Plain text response"),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/status",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: undefined,
        status: 200,
      });
    });

    test("should handle complex nested JSON objects", async () => {
      const complexData = {
        result: {
          nodes: [
            { id: 1, type: "Function", name: "testFunction" },
            { id: 2, type: "Class", name: "TestClass" },
          ],
          edges: [{ from: 1, to: 2, relationship: "contains" }],
          metadata: {
            timestamp: "2024-01-01T00:00:00Z",
            version: "1.0.0",
            stats: { total_nodes: 2, total_edges: 1 },
          },
        },
        status: "completed",
        progress: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(complexData),
        text: () => Promise.resolve(JSON.stringify(complexData)),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:3355",
        endpoint: "/graph?detailed=true",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: complexData,
        status: 200,
      });
    });
  });

  describe("Error Handling", () => {
    test("should handle network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await swarmApiRequest({
        swarmUrl: "https://unreachable.sphinx.chat:7799",
        endpoint: "/test",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });

    test("should handle HTTP 4xx errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Not found" }),
        text: () => Promise.resolve('{"error": "Not found"}'),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/nonexistent",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        data: { error: "Not found" },
        status: 404,
      });
    });

    test("should handle HTTP 5xx errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal server error" }),
        text: () => Promise.resolve('{"error": "Internal server error"}'),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/test",
        method: "POST",
        apiKey: "encrypted-key",
        data: { invalid: "data" },
      });

      expect(result).toEqual({
        ok: false,
        data: { error: "Internal server error" },
        status: 500,
      });
    });

    test("should handle authentication errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "Unauthorized", message: "Invalid API key" }),
        text: () => Promise.resolve('{"error": "Unauthorized", "message": "Invalid API key"}'),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/secure",
        method: "GET",
        apiKey: "invalid-key",
      });

      expect(result).toEqual({
        ok: false,
        data: { error: "Unauthorized", message: "Invalid API key" },
        status: 401,
      });
    });

    test("should handle timeout scenarios", async () => {
      // Simulate timeout by rejecting after delay
      mockFetch.mockImplementationOnce(() =>
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Request timeout")), 100)
        )
      );

      const result = await swarmApiRequest({
        swarmUrl: "https://slow.sphinx.chat:7799",
        endpoint: "/slow-endpoint",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });

    test("should preserve error response data when JSON parsing fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.reject(new Error("Invalid JSON")),
        text: () => Promise.resolve("Bad Request: Invalid input"),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/test",
        method: "POST",
        apiKey: "encrypted-key",
        data: { malformed: "request" },
      });

      expect(result).toEqual({
        ok: false,
        data: undefined,
        status: 400,
      });
    });
  });

  describe("Edge Cases", () => {
    test("should handle extremely long URLs", async () => {
      const longEndpoint = "/test/" + "a".repeat(1000);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve('{"success": true}'),
      });

      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: longEndpoint,
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `https://test.sphinx.chat:7799${longEndpoint}`,
        expect.any(Object)
      );
    });

    test("should handle special characters in endpoints", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
        text: () => Promise.resolve('{"success": true}'),
      });

      await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/test?query=hello%20world&filter=special@chars",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.sphinx.chat:7799/test?query=hello%20world&filter=special@chars",
        expect.any(Object)
      );
    });

    test("should handle large JSON responses", async () => {
      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          data: "x".repeat(100),
        })),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(largeData),
        text: () => Promise.resolve(JSON.stringify(largeData)),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/large-data",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: largeData,
        status: 200,
      });
    });

    test("should handle undefined/null data gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(null),
        text: () => Promise.resolve("null"),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test.sphinx.chat:7799",
        endpoint: "/null-response",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: null,
        status: 200,
      });
    });

    test("should handle concurrent requests properly", async () => {
      const requests = Array.from({ length: 5 }, (_, i) => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ request: i }),
          text: () => Promise.resolve(`{"request": ${i}}`),
        });

        return swarmApiRequest({
          swarmUrl: "https://test.sphinx.chat:7799",
          endpoint: `/test-${i}`,
          method: "GET",
          apiKey: "encrypted-key",
        });
      });

      const results = await Promise.all(requests);

      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result).toEqual({
          ok: true,
          data: { request: index },
          status: 200,
        });
      });
    });

    test("should handle different status codes correctly", async () => {
      const statusCodes = [200, 201, 202, 204, 400, 401, 403, 404, 500, 502, 503];

      for (const status of statusCodes) {
        const isSuccess = status >= 200 && status < 300;
        mockFetch.mockResolvedValueOnce({
          ok: isSuccess,
          status,
          json: () => Promise.resolve({ status }),
          text: () => Promise.resolve(`{"status": ${status}}`),
        });

        const result = await swarmApiRequest({
          swarmUrl: "https://test.sphinx.chat:7799",
          endpoint: `/status-${status}`,
          method: "GET",
          apiKey: "encrypted-key",
        });

        expect(result).toEqual({
          ok: isSuccess,
          data: { status },
          status,
        });
      }
    });
  });

  describe("Real-world Integration Patterns", () => {
    test("should handle stakgraph sync endpoint pattern", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          status: "success",
          request_id: "sync-12345",
          message: "Repository sync initiated",
        }),
        text: () => Promise.resolve('{"status": "success", "request_id": "sync-12345", "message": "Repository sync initiated"}'),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://myswarm.sphinx.chat:7799",
        endpoint: "/sync_async",
        method: "POST",
        apiKey: "encrypted-key",
        data: {
          repo_url: "https://github.com/user/repo",
          username: "testuser",
          pat: "github-token",
          callback_url: "https://hive.example.com/webhooks/stakgraph",
        },
      });

      expect(result).toEqual({
        ok: true,
        data: {
          status: "success",
          request_id: "sync-12345",
          message: "Repository sync initiated",
        },
        status: 200,
      });
    });

    test("should handle graph query endpoint pattern", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          nodes: [
            { id: "func1", type: "Function", name: "authenticate" },
            { id: "class1", type: "Class", name: "UserService" },
          ],
          edges: [{ from: "class1", to: "func1", type: "contains" }],
          total: 2,
        }),
        text: () => Promise.resolve('{"nodes": [], "edges": [], "total": 2}'),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://myswarm.sphinx.chat:3355",
        endpoint: "/graph?limit=200&node_types=Function,Class",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("nodes");
      expect(result.data).toHaveProperty("edges");
      expect(result.status).toBe(200);
    });

    test("should handle status check endpoint pattern", async () => {
      const expectedData = {
        status: "processing",
        progress: 75,
        result: {
          nodes: 150,
          edges: 300,
        },
        estimated_completion: "2024-01-01T12:30:00Z",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(expectedData),
        text: () => Promise.resolve(JSON.stringify(expectedData)),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://myswarm.sphinx.chat:7799",
        endpoint: "/status/sync-12345",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: expectedData,
        status: 200,
      });
    });
  });
});