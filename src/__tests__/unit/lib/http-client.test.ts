import { describe, test, expect, beforeEach, vi } from "vitest";
import { HttpClient } from "@/lib/http-client";

describe("HttpClient.post Method", () => {
  let httpClient: HttpClient;
  let mockFetch: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock global fetch
    mockFetch = vi.spyOn(globalThis, "fetch");
    
    // Initialize HttpClient with test configuration
    httpClient = new HttpClient({
      baseURL: "https://api.example.com",
      timeout: 5000,
      defaultHeaders: {
        "Content-Type": "application/json",
        "User-Agent": "test-client",
      },
    });
  });

  describe("Payload Serialization", () => {
    test("should serialize object payload using JSON.stringify", async () => {
      const testPayload = { name: "John Doe", age: 30, active: true };
      const expectedResponse = { id: 1, success: true };

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(expectedResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      await httpClient.post("/users", testPayload);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/users",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(testPayload),
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("should serialize nested object structures correctly", async () => {
      const complexPayload = {
        user: {
          profile: {
            name: "Jane Smith",
            preferences: {
              notifications: true,
              theme: "dark",
            },
          },
        },
        metadata: [{ key: "source", value: "api" }],
      };

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 201 })
      );

      await httpClient.post("/complex", complexPayload);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(complexPayload),
        })
      );
    });

    test("should serialize array payload correctly", async () => {
      const arrayPayload = [
        { id: 1, name: "Item 1" },
        { id: 2, name: "Item 2" },
      ];

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ processed: 2 }), { status: 200 })
      );

      await httpClient.post("/batch", arrayPayload);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(arrayPayload),
        })
      );
    });
  });

  describe("Header Handling", () => {
    test("should merge custom headers with default headers", async () => {
      const customHeaders = {
        "Authorization": "Bearer token123",
        "X-Custom-Header": "custom-value",
      };

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await httpClient.post("/protected", { data: "test" }, customHeaders);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "User-Agent": "test-client",
            "Authorization": "Bearer token123",
            "X-Custom-Header": "custom-value",
          }),
        })
      );
    });

    test("should allow custom headers to override default headers", async () => {
      const overrideHeaders = {
        "Content-Type": "application/xml",
        "User-Agent": "custom-agent",
      };

      mockFetch.mockResolvedValue(
        new Response("<response/>", { status: 200 })
      );

      await httpClient.post("/xml", { data: "test" }, overrideHeaders);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/xml",
            "User-Agent": "custom-agent",
          }),
        })
      );
    });

    test("should work with undefined headers parameter", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await httpClient.post("/default", { data: "test" }, undefined);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "User-Agent": "test-client",
          }),
        })
      );
    });
  });

  describe("Delegation to Underlying Request Logic", () => {
    test("should delegate to private request method with correct parameters", async () => {
      const payload = { name: "Test" };
      const headers = { "Authorization": "Bearer token" };

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ id: 1 }), { status: 201 })
      );

      const result = await httpClient.post("/users", payload, headers);

      // Verify fetch was called with POST method
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/users",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(payload),
          headers: expect.objectContaining(headers),
        })
      );

      expect(result).toEqual({ id: 1 });
    });

    test("should include AbortController signal in request", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await httpClient.post("/test", { data: "test" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    test("should apply timeout configuration through AbortController", async () => {
      const shortTimeoutClient = new HttpClient({
        baseURL: "https://api.example.com",
        timeout: 100,
      });

      // Mock a delayed response that will be aborted
      mockFetch.mockImplementation(
        (url, options) =>
          new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => resolve(new Response(JSON.stringify({}))),
              200
            );
            
            // Listen for abort signal
            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              });
            }
          })
      );

      await expect(
        shortTimeoutClient.post("/slow", { data: "test" })
      ).rejects.toThrow();
    });
  });

  describe("Edge Cases for Undefined Bodies", () => {
    test("should handle undefined body parameter gracefully", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      await httpClient.post("/no-body", undefined);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/no-body",
        expect.objectContaining({
          method: "POST",
          body: undefined,
        })
      );
    });

    test("should handle null body parameter", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ received: "null" }), { status: 200 })
      );

      await httpClient.post("/null-body", null);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: "null", // JSON.stringify(null) returns "null"
        })
      );
    });

    test("should handle empty object body", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ processed: true }), { status: 200 })
      );

      await httpClient.post("/empty", {});

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: "{}",
        })
      );
    });

    test("should handle empty string body", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ received: true }), { status: 200 })
      );

      await httpClient.post("/empty-string", "");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: '""', // JSON.stringify("") returns '""'
        })
      );
    });

    test("should handle zero and false values correctly", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ processed: true }), { status: 200 })
      );

      await httpClient.post("/zero", 0);
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ body: "0" })
      );

      // Reset mock for next call
      mockFetch.mockClear();
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ processed: true }), { status: 200 })
      );

      await httpClient.post("/false", false);
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ body: "false" })
      );
    });
  });

  describe("Error Handling", () => {
    test("should handle network errors", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(
        httpClient.post("/network-error", { data: "test" })
      ).rejects.toThrow("Network error");
    });

    test("should handle HTTP error responses", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Bad Request" }), {
          status: 400,
          statusText: "Bad Request",
        })
      );

      await expect(
        httpClient.post("/bad-request", { data: "invalid" })
      ).rejects.toThrow();
    });

    test("should handle timeout errors", async () => {
      const timeoutClient = new HttpClient({
        baseURL: "https://api.example.com",
        timeout: 50,
      });

      mockFetch.mockImplementation(
        (url, options) =>
          new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => resolve(new Response(JSON.stringify({}))),
              100
            );
            
            // Listen for abort signal
            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              });
            }
          })
      );

      await expect(
        timeoutClient.post("/timeout", { data: "test" })
      ).rejects.toThrow();
    });
  });

  describe("Response Handling", () => {
    test("should parse JSON response correctly", async () => {
      const expectedResponse = {
        id: 123,
        name: "Created Resource",
        createdAt: "2024-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(expectedResponse), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await httpClient.post("/create", { name: "New Resource" });

      expect(result).toEqual(expectedResponse);
    });

    test("should handle empty response body", async () => {
      mockFetch.mockResolvedValue(
        new Response("", {
          status: 200, // Changed from 204 since Response constructor doesn't allow empty body with 204
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await httpClient.post("/no-content", { data: "test" });

      expect(result).toBeNull();
    });

    test("should preserve response type inference", async () => {
      interface CreateUserResponse {
        id: number;
        email: string;
        name: string;
      }

      const mockUser: CreateUserResponse = {
        id: 1,
        email: "test@example.com",
        name: "Test User",
      };

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockUser), { status: 201 })
      );

      // TypeScript should infer the return type correctly
      const user = await httpClient.post<CreateUserResponse>("/users", {
        email: "test@example.com",
        name: "Test User",
      });

      expect(user).toEqual(mockUser);
      expect(user.id).toBe(1);
      expect(user.email).toBe("test@example.com");
      expect(user.name).toBe("Test User");
    });
  });

  describe("Real-world Usage Patterns", () => {
    test("should work like createPoolApi usage pattern", async () => {
      // Simulate the usage pattern from createPoolApi function
      interface Pool {
        id: string;
        name: string;
        description: string;
      }

      const poolData = {
        name: "Test Pool",
        description: "A test pool",
      };

      const expectedPool: Pool = {
        id: "pool-123",
        name: "Test Pool",
        description: "A test pool",
      };

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(expectedPool), { status: 201 })
      );

      const result = await httpClient.post<Pool>("/pools", poolData, undefined, "pool-service");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/pools",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(poolData),
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );

      expect(result).toEqual(expectedPool);
    });

    test("should handle service name parameter in request", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      await httpClient.post("/endpoint", { data: "test" }, undefined, "my-service");

      // Service name should be passed through to the underlying request
      // (exact behavior depends on HttpClient implementation)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
        })
      );
    });
  });

  describe("Method Signature Validation", () => {
    test("should accept all valid parameter combinations", async () => {
      // Mock all calls separately to prevent conflicts
      mockFetch
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

      // All parameters
      await expect(
        httpClient.post("/test1", { data: "test" }, { "Custom": "header" }, "service")
      ).resolves.toBeDefined();

      // Without service name
      await expect(
        httpClient.post("/test2", { data: "test" }, { "Custom": "header" })
      ).resolves.toBeDefined();

      // Without headers and service name
      await expect(
        httpClient.post("/test3", { data: "test" })
      ).resolves.toBeDefined();

      // Only endpoint and body
      await expect(
        httpClient.post("/test4", undefined)
      ).resolves.toBeDefined();
    });
  });
});