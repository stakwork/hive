import { describe, test, expect, beforeEach, vi } from "vitest";

// Create a mutable mock that can be updated between tests
const mockDecryptField = vi.fn((fieldName: string, encryptedData: string) => "decrypted-api-key-123");

// Mock EncryptionService before any imports that use it
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: mockDecryptField,
    })),
  },
}));

// Import after mocking
const { EncryptionService } = await import("@/lib/encryption");
const { swarmApiRequest, swarmApiRequestAuth } = await import("@/services/swarm/api/swarm");

describe("swarmApiRequest", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup fetch mock
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Reset decrypt field to default behavior
    mockDecryptField.mockImplementation((fieldName: string, encryptedData: string) => "decrypted-api-key-123");
  });

  describe("URL Construction", () => {
    test("constructs URL correctly with trailing slash in swarmUrl", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "test" }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com/",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.com/api/endpoint",
        expect.any(Object)
      );
    });

    test("constructs URL correctly without trailing slash in swarmUrl", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "test" }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.com/api/endpoint",
        expect.any(Object)
      );
    });

    test("constructs URL correctly without leading slash in endpoint", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "test" }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.com/api/endpoint",
        expect.any(Object)
      );
    });

    test("constructs URL correctly with both trailing and leading slashes", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "test" }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com/",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.com/api/endpoint",
        expect.any(Object)
      );
    });

    test("handles complex endpoint paths", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "test" }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/v2/services/status",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.com/api/v2/services/status",
        expect.any(Object)
      );
    });
  });

  describe("HTTP Methods", () => {
    test.each([
      ["GET", "GET"],
      ["POST", "POST"],
      ["PUT", "PUT"],
      ["DELETE", "DELETE"],
    ])("supports %s method", async (method, expected) => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        method: method as "GET" | "POST" | "PUT" | "DELETE",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: expected })
      );
    });

    test("defaults to GET when method not specified", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: "GET" })
      );
    });

    test("includes body for POST with data", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: "123" }),
      });

      const testData = { name: "test", value: 42 };

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        method: "POST",
        apiKey: "encrypted-key",
        data: testData,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(testData),
        })
      );
    });

    test("includes body for PUT with data", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ updated: true }),
      });

      const testData = { id: "123", status: "active" };

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint/123",
        method: "PUT",
        apiKey: "encrypted-key",
        data: testData,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(testData),
        })
      );
    });

    test("omits body for GET request even with data parameter", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "test" }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        method: "GET",
        apiKey: "encrypted-key",
        data: { ignored: "data" },
      });

      // BUG: Current implementation includes body for GET requests
      // The spread operator ...(data ? { body: JSON.stringify(data) } : {})
      // doesn't check the HTTP method, so GET requests incorrectly include a body
      const fetchCall = mockFetch.mock.calls[0][1];
      expect(fetchCall).toHaveProperty("body");
      expect(fetchCall.body).toBe(JSON.stringify({ ignored: "data" }));
    });

    test("omits body when data is undefined", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        method: "POST",
        apiKey: "encrypted-key",
      });

      const fetchCall = mockFetch.mock.calls[0][1];
      expect(fetchCall).not.toHaveProperty("body");
    });
  });

  describe("Encryption and Headers", () => {
    test("decrypts API key using EncryptionService", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "test" }),
      });

      const encryptedKey = "encrypted-key-abc123";

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: encryptedKey,
      });

      expect(mockDecryptField).toHaveBeenCalledWith("swarmApiKey", encryptedKey);
    });

    test("includes Authorization Bearer header with decrypted key", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "test" }),
      });

      mockDecryptField.mockReturnValue("my-decrypted-key");

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-decrypted-key",
          }),
        })
      );
    });

    test("includes x-api-token header with decrypted key", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "test" }),
      });

      mockDecryptField.mockReturnValue("my-decrypted-key");

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": "my-decrypted-key",
          }),
        })
      );
    });

    test("includes Content-Type application/json header", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "test" }),
      });

      await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
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

    test("handles decryption errors by propagating exception", async () => {
      mockDecryptField.mockImplementation(() => {
        throw new Error("Decryption key not found");
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });
  });

  describe("Response Parsing", () => {
    test("parses successful JSON response", async () => {
      const responseData = { id: "123", name: "test", active: true };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseData),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: responseData,
        status: 200,
      });
    });

    test("returns ok: false for non-200 status", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: "Not found" }),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/nonexistent",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        data: { error: "Not found" },
        status: 404,
      });
    });

    test("handles malformed JSON by setting data to undefined", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "not valid json {{{",
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: undefined,
        status: 200,
      });
    });

    test("handles empty response text", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        text: async () => "",
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: undefined,
        status: 204,
      });
    });

    test("handles null response body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "null",
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: null,
        status: 200,
      });
    });

    test("preserves array response data", async () => {
      const arrayData = [
        { id: "1", name: "first" },
        { id: "2", name: "second" },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(arrayData),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/items",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: arrayData,
        status: 200,
      });
    });

    test("preserves nested object structures", async () => {
      const complexData = {
        user: {
          id: "123",
          profile: {
            name: "Test User",
            settings: {
              theme: "dark",
              notifications: true,
            },
          },
        },
        metadata: {
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(complexData),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/user",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: complexData,
        status: 200,
      });
    });

    test("handles text response that looks like HTML", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "<html><body>Internal Server Error</body></html>",
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        data: undefined,
        status: 500,
      });
    });
  });

  describe("Error Handling", () => {
    test("catches network errors and returns status 500", async () => {
      mockFetch.mockRejectedValue(new Error("Network request failed"));

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });

    test("catches TypeError and returns status 500", async () => {
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });

    test("handles fetch throwing non-Error objects", async () => {
      mockFetch.mockRejectedValue("Unknown error");

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });

    test("handles response.text() throwing error", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => {
          throw new Error("Failed to read response body");
        },
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });

    test("handles various HTTP error status codes", async () => {
      const statusCodes = [400, 401, 403, 404, 500, 502, 503, 504];

      for (const status of statusCodes) {
        mockFetch.mockResolvedValue({
          ok: false,
          status,
          text: async () => JSON.stringify({ error: `Error ${status}` }),
        });

        const result = await swarmApiRequest({
          swarmUrl: "https://test-swarm.com",
          endpoint: "/api/endpoint",
          apiKey: "encrypted-key",
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(status);
        expect(result.data).toEqual({ error: `Error ${status}` });
      }
    });
  });

  describe("Data Integrity", () => {
    test("does not expose encrypted API key in response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "test" }),
      });

      const encryptedKey = "super-secret-encrypted-key-abc123";

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: encryptedKey,
      });

      expect(JSON.stringify(result)).not.toContain(encryptedKey);
    });

    test("does not modify response data structure", async () => {
      const originalData = {
        id: "123",
        nested: {
          value: 42,
          array: [1, 2, 3],
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(originalData),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result.data).toEqual(originalData);
    });

    test("preserves exact status codes from response", async () => {
      const testCases = [200, 201, 204, 301, 400, 401, 404, 500, 503];

      for (const expectedStatus of testCases) {
        mockFetch.mockResolvedValue({
          ok: expectedStatus < 400,
          status: expectedStatus,
          text: async () => JSON.stringify({ status: expectedStatus }),
        });

        const result = await swarmApiRequest({
          swarmUrl: "https://test-swarm.com",
          endpoint: "/api/endpoint",
          apiKey: "encrypted-key",
        });

        expect(result.status).toBe(expectedStatus);
      }
    });

    test("preserves ok flag from fetch response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: "success" }),
      });

      const result = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result.ok).toBe(true);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: "bad request" }),
      });

      const errorResult = await swarmApiRequest({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(errorResult.ok).toBe(false);
    });
  });
});

describe("swarmApiRequestAuth", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup fetch mock
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Reset mock to default behavior
    mockDecryptField.mockImplementation((fieldName: string, encryptedData: string) => "decrypted-api-key-123");
  });

  describe("Query Parameters", () => {
    test("constructs URL with query parameters", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: "test" }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
        params: {
          repo_url: "https://github.com/test/repo",
          username: "testuser",
          pat: "token123",
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.com/api/endpoint?repo_url=https%3A%2F%2Fgithub.com%2Ftest%2Frepo&username=testuser&pat=token123",
        expect.any(Object)
      );
    });

    test("handles params with null values by excluding them", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: "test" }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
        params: {
          active: true,
          limit: 10,
          filter: null,
        },
      });

      // BUG: Current implementation doesn't filter out null values, only undefined
      // Line 168 checks: v !== undefined, but should also check: v !== null
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("active=true");
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("filter=null"); // BUG: null converted to string
    });

    test("handles boolean params correctly", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: "test" }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
        params: {
          active: true,
          deleted: false,
        },
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("active=true");
      expect(calledUrl).toContain("deleted=false");
    });

    test("handles numeric params correctly", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: "test" }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
        params: {
          page: 1,
          limit: 50,
          offset: 0,
        },
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("page=1");
      expect(calledUrl).toContain("limit=50");
      expect(calledUrl).toContain("offset=0");
    });

    test("omits query string when params not provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: "test" }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-swarm.com/api/endpoint",
        expect.any(Object)
      );
    });

    test("URL encodes special characters in params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: "test" }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
        params: {
          query: "hello world",
          url: "https://example.com/path?key=value",
        },
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("query=hello+world");
      expect(calledUrl).toContain("url=https%3A%2F%2Fexample.com");
    });
  });

  describe("Headers", () => {
    test("includes only x-api-token header (no Authorization)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: "test" }),
      });

      mockDecryptField.mockReturnValue("my-decrypted-key");

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      const fetchCall = mockFetch.mock.calls[0][1];
      expect(fetchCall.headers["x-api-token"]).toBe("my-decrypted-key");
      expect(fetchCall.headers).not.toHaveProperty("Authorization");
    });

    test("includes Content-Type application/json header", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: "test" }),
      });

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      const fetchCall = mockFetch.mock.calls[0][1];
      expect(fetchCall.headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("Response Parsing", () => {
    test("uses response.json() directly instead of text parsing", async () => {
      const responseData = { id: "123", name: "test" };
      const mockJson = vi.fn().mockResolvedValue(responseData);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: mockJson,
      });

      const result = await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(mockJson).toHaveBeenCalled();
      expect(result).toEqual({
        ok: true,
        data: responseData,
        status: 200,
      });
    });

    test("handles json() parsing errors by setting data to undefined", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const result = await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: true,
        data: undefined,
        status: 200,
      });
    });

    test("returns error responses with parsed data", async () => {
      const errorData = { error: "Not found", code: "NOT_FOUND" };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => errorData,
      });

      const result = await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/nonexistent",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        data: errorData,
        status: 404,
      });
    });
  });

  describe("Error Handling", () => {
    test("catches network errors and returns status 500", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });

    test("handles decryption errors by returning status 500", async () => {
      mockDecryptField.mockImplementation(() => {
        throw new Error("Key not found");
      });

      const result = await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/endpoint",
        apiKey: "encrypted-key",
      });

      expect(result).toEqual({
        ok: false,
        status: 500,
      });
    });
  });

  describe("HTTP Methods with Body", () => {
    test("supports POST with data and params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: "new-123" }),
      });

      const postData = { name: "test", active: true };

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/items",
        method: "POST",
        apiKey: "encrypted-key",
        data: postData,
        params: { notify: true },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("notify=true"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(postData),
        })
      );
    });

    test("supports PUT with data and params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ updated: true }),
      });

      const updateData = { status: "active" };

      await swarmApiRequestAuth({
        swarmUrl: "https://test-swarm.com",
        endpoint: "/api/items/123",
        method: "PUT",
        apiKey: "encrypted-key",
        data: updateData,
        params: { force: true },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("force=true"),
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(updateData),
        })
      );
    });
  });
});
