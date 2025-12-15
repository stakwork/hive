import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { swarmApiRequest, swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";

// Mock EncryptionService
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((fieldType: string, encryptedValue: string) => {
        // Return a decrypted API key for testing
        return "decrypted-api-key-123";
      }),
    })),
  },
}));

describe("swarmApiRequest", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let encryptionService: EncryptionService;

  beforeEach(() => {
    // Setup mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Get encryption service instance
    encryptionService = EncryptionService.getInstance();

    // Clear console.error mock to prevent noise
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("URL Construction", () => {
    it("should construct URL correctly with trailing slash in swarmUrl", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com/",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.example.com/api/test",
        expect.objectContaining({
          method: "GET",
        })
      );
    });

    it("should construct URL correctly without trailing slash in swarmUrl", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.example.com/api/test",
        expect.objectContaining({
          method: "GET",
        })
      );
    });

    it("should construct URL correctly when endpoint does not start with slash", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "api/test",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.example.com/api/test",
        expect.objectContaining({
          method: "GET",
        })
      );
    });

    it("should handle complex endpoint paths", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com/",
        endpoint: "/api/v1/resources/123/nested",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.example.com/api/v1/resources/123/nested",
        expect.objectContaining({
          method: "GET",
        })
      );
    });
  });

  describe("Authentication and Headers", () => {
    it("should decrypt API key before making request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key-abc123",
      });

      // Verify decryptField was called by checking the Authorization header contains the decrypted value
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-api-key-123",
            "x-api-token": "decrypted-api-key-123",
          }),
        })
      );
    });

    it("should set Authorization Bearer header with decrypted key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-api-key-123",
          }),
        })
      );
    });

    it("should set x-api-token header with decrypted key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": "decrypted-api-key-123",
          }),
        })
      );
    });

    it("should set Content-Type header to application/json", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });
  });

  describe("HTTP Methods", () => {
    it.each([
      ["GET", "GET"],
      ["POST", "POST"],
      ["PUT", "PUT"],
      ["DELETE", "DELETE"],
    ])(
      "should make %s request when method is %s",
      async (method, expectedMethod) => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true }),
        });

        await swarmApiRequest({
          swarmUrl: "https://test-swarm.example.com",
          endpoint: "/api/test",
          method: method as "GET" | "POST" | "PUT" | "DELETE",
          apiKey: "encrypted-key",
        });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            method: expectedMethod,
          })
        );
      }
    );

    it("should default to GET method when not specified", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "GET",
        })
      );
    });
  });

  describe("Request Body Serialization", () => {
    it("should not include body for GET requests without data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        method: "GET",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          body: expect.anything(),
        })
      );
    });

    it("should serialize data as JSON in request body for POST", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: 123 }),
      });

      const testData = { name: "test", value: 42 };

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        method: "POST",
        apiKey: "encrypted-key",
        data: testData,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(testData),
        })
      );
    });

    it("should handle complex nested data structures", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      const complexData = {
        user: {
          name: "John",
          metadata: {
            tags: ["admin", "user"],
            settings: { theme: "dark" },
          },
        },
        timestamp: new Date().toISOString(),
      };

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        method: "POST",
        apiKey: "encrypted-key",
        data: complexData,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(complexData),
        })
      );
    });
  });

  describe("Response Handling - Success Cases", () => {
    it("should return ok:true for successful 200 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: "success" }),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
    });

    it("should parse and return JSON response data", async () => {
      const responseData = { id: 123, name: "test", active: true };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseData),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.data).toEqual(responseData);
    });

    it("should handle 201 Created response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: 456 }),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        method: "POST",
        apiKey: "encrypted-key",
        data: { name: "new resource" },
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
      expect(result.data).toEqual({ id: 456 });
    });

    it("should handle empty JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({}),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({});
    });

    it("should handle array response data", async () => {
      const responseData = [
        { id: 1, name: "first" },
        { id: 2, name: "second" },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseData),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.data).toEqual(responseData);
    });
  });

  describe("Response Handling - Non-JSON Responses", () => {
    it("should return undefined data when response is not valid JSON", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "plain text response",
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data).toBeUndefined();
    });

    it("should log error when JSON parsing fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "not json",
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "swarmApiRequest JSON error",
        "not json",
        expect.any(Error)
      );
    });

    it("should handle empty response body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => "",
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(204);
      expect(result.data).toBeUndefined();
    });

    it("should handle malformed JSON gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"invalid": json}',
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toBeUndefined();
    });
  });

  describe("Error Scenarios - HTTP Errors", () => {
    it.each([
      [400, "Bad Request"],
      [401, "Unauthorized"],
      [403, "Forbidden"],
      [404, "Not Found"],
      [500, "Internal Server Error"],
      [502, "Bad Gateway"],
      [503, "Service Unavailable"],
    ])(
      "should return ok:false for %s status code",
      async (statusCode, statusText) => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: statusCode,
          text: async () => JSON.stringify({ error: statusText }),
        });

        const result = await swarmApiRequest({
          swarmUrl: "https://test-swarm.example.com",
          endpoint: "/api/test",
          apiKey: "encrypted-key",
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(statusCode);
      }
    );

    it("should return error data from failed response", async () => {
      const errorData = { error: "Invalid request", details: ["field required"] };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(errorData),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(false);
      expect(result.data).toEqual(errorData);
    });

    it("should handle non-JSON error responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.data).toBeUndefined();
    });
  });

  describe("Error Scenarios - Network Failures", () => {
    it("should return ok:false and status 500 when fetch throws network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.data).toBeUndefined();
    });

    it("should log error when fetch throws", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error");
      const networkError = new Error("Network timeout");

      mockFetch.mockRejectedValueOnce(networkError);

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "swarmApiRequest",
        networkError
      );
    });

    it("should handle DNS resolution failures", async () => {
      mockFetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));

      const result = await swarmApiRequest({
        swarmUrl: "https://invalid-domain-that-does-not-exist.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
    });

    it("should handle connection timeout", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ETIMEDOUT"));

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
    });

    it("should handle connection refused", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
    });
  });

  describe("Edge Cases", () => {
    it("should handle special characters in endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/resources?filter=name&sort=asc",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.example.com/api/resources?filter=name&sort=asc",
        expect.any(Object)
      );
    });

    it("should handle URL with port number", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com:8080",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.example.com:8080/api/test",
        expect.any(Object)
      );
    });

    it("should handle data with null values", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      const dataWithNull = {
        name: "test",
        description: null,
        count: 0,
      };

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        method: "POST",
        apiKey: "encrypted-key",
        data: dataWithNull,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(dataWithNull),
        })
      );
    });

    it("should handle very large response payloads", async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        data: `item-${i}`,
      }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(largeArray),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(largeArray);
      expect(result.data).toHaveLength(1000);
    });

    it("should handle response with Unicode characters", async () => {
      const unicodeData = {
        message: "Hello 世界 🌍",
        emoji: "✅❌🔥",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(unicodeData),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.data).toEqual(unicodeData);
    });
  });

  describe("Data Integrity", () => {
    it("should not mutate input data object", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      const originalData = { name: "test", value: 42 };
      const dataCopy = { ...originalData };

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        method: "POST",
        apiKey: "encrypted-key",
        data: originalData,
      });

      expect(originalData).toEqual(dataCopy);
    });

    it("should handle concurrent requests independently", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 1 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 2 }),
        });

      const [result1, result2] = await Promise.all([
        swarmApiRequest({
          swarmUrl: "https://test-swarm.example.com",
          endpoint: "/api/test1",
          apiKey: "encrypted-key-1",
        }),
        swarmApiRequest({
          swarmUrl: "https://test-swarm.example.com",
          endpoint: "/api/test2",
          apiKey: "encrypted-key-2",
        }),
      ]);

      expect(result1.data).toEqual({ id: 1 });
      expect(result2.data).toEqual({ id: 2 });
    });

    it("should return consistent response structure on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("status");
      expect(typeof result.ok).toBe("boolean");
      expect(typeof result.status).toBe("number");
    });

    it("should return consistent response structure on error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("status");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
    });
  });
});

describe("swarmApiRequestAuth", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let encryptionService: EncryptionService;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    encryptionService = EncryptionService.getInstance();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Query Parameters", () => {
    it("should construct URL with query parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
        params: { page: 1, limit: 10 },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.example.com/api/test?page=1&limit=10",
        expect.any(Object)
      );
    });

    it("should filter out undefined params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
        params: { page: 1, filter: undefined, sort: "asc" },
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("page=1");
      expect(calledUrl).toContain("sort=asc");
      expect(calledUrl).not.toContain("filter");
    });

    it("should handle boolean params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
        params: { active: true, deleted: false },
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("active=true");
      expect(calledUrl).toContain("deleted=false");
    });

    it("should convert null params to string 'null'", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
        params: { page: 1, filter: null },
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("page=1");
      expect(calledUrl).toContain("filter=null");
    });

    it("should make request without query string when params is undefined", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.example.com/api/test",
        expect.any(Object)
      );
    });
  });

  describe("Authentication Headers", () => {
    it("should use x-api-token header with decrypted key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": "decrypted-api-key-123",
          }),
        })
      );
    });

    it("should not include Authorization header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers).not.toHaveProperty("Authorization");
    });
  });

  describe("Response Handling", () => {
    it("should parse JSON response correctly", async () => {
      const responseData = { id: 123, name: "test" };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => responseData,
      });

      const result = await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(responseData);
    });

    it("should handle JSON parsing errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const result = await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it("should log error when JSON parsing fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "swarmApiRequest error parsing JSON",
        expect.any(Error)
      );
    });
  });

  describe("Error Scenarios", () => {
    it("should return ok:false and status 500 on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
    });

    it("should handle HTTP error responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      });

      const result = await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.example.com",
        endpoint: "/api/test",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(401);
    });
  });
});
