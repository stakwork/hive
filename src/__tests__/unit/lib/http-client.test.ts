import { describe, test, expect, vi, beforeEach } from "vitest";
import { HttpClient } from "@/lib/http-client";
import type { HttpClientConfig } from "@/lib/http-client";

// Mock console methods to avoid cluttering test output
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockConsoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

describe("HttpClient.post Method - Unit Tests", () => {
  let httpClient: HttpClient;
  let mockConfig: HttpClientConfig;
  let mockRequestSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      baseURL: "https://api.example.com",
      timeout: 5000,
      defaultHeaders: {
        Authorization: "Bearer test-token",
        "X-Custom": "default-value",
      },
    };

    httpClient = new HttpClient(mockConfig);

    // Spy on the private request method to test delegation
    mockRequestSpy = vi.spyOn(httpClient as any, "request").mockResolvedValue({
      success: true,
      data: "mocked response",
    });
  });

  describe("Payload Serialization", () => {
    test("should serialize object payload using JSON.stringify", async () => {
      const payload = { name: "test", value: 123, active: true };

      await httpClient.post("/test", payload);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(payload),
          headers: undefined,
        },
        undefined
      );
    });

    test("should serialize array payload using JSON.stringify", async () => {
      const payload = [{ id: 1 }, { id: 2 }, { id: 3 }];

      await httpClient.post("/test", payload);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(payload),
          headers: undefined,
        },
        undefined
      );
    });

    test("should serialize primitive values using JSON.stringify", async () => {
      const stringPayload = "test string";
      await httpClient.post("/test", stringPayload);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(stringPayload),
          headers: undefined,
        },
        undefined
      );

      const numberPayload = 42;
      await httpClient.post("/test", numberPayload);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(numberPayload),
          headers: undefined,
        },
        undefined
      );

      const booleanPayload = false;
      await httpClient.post("/test", booleanPayload);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(booleanPayload),
          headers: undefined,
        },
        undefined
      );
    });

    test("should handle null payload as undefined body", async () => {
      await httpClient.post("/test", null);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: undefined,
          headers: undefined,
        },
        undefined
      );
    });

    test("should handle undefined payload as undefined body", async () => {
      await httpClient.post("/test", undefined);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: undefined,
          headers: undefined,
        },
        undefined
      );
    });

    test("should handle empty object payload", async () => {
      const payload = {};

      await httpClient.post("/test", payload);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(payload),
          headers: undefined,
        },
        undefined
      );
    });

    test("should handle empty array payload", async () => {
      const payload: any[] = [];

      await httpClient.post("/test", payload);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(payload),
          headers: undefined,
        },
        undefined
      );
    });

    test("should serialize nested object payload", async () => {
      const payload = {
        user: {
          name: "John Doe",
          settings: {
            theme: "dark",
            notifications: true,
          },
        },
        metadata: {
          timestamp: new Date("2024-01-01"),
          tags: ["test", "api"],
        },
      };

      await httpClient.post("/test", payload);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(payload),
          headers: undefined,
        },
        undefined
      );
    });
  });

  describe("Header Handling", () => {
    test("should pass custom headers to request method", async () => {
      const customHeaders = {
        "Content-Type": "application/xml",
        "X-Custom-Header": "custom-value",
      };

      await httpClient.post("/test", { data: "test" }, customHeaders);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify({ data: "test" }),
          headers: customHeaders,
        },
        undefined
      );
    });

    test("should handle undefined headers", async () => {
      await httpClient.post("/test", { data: "test" }, undefined);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify({ data: "test" }),
          headers: undefined,
        },
        undefined
      );
    });

    test("should handle empty headers object", async () => {
      const emptyHeaders = {};

      await httpClient.post("/test", { data: "test" }, emptyHeaders);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify({ data: "test" }),
          headers: emptyHeaders,
        },
        undefined
      );
    });

    test("should pass headers with special characters", async () => {
      const specialHeaders = {
        "X-Custom-Header": "value with spaces and symbols!@#$%",
        Authorization: "Bearer token-with-dashes_and_underscores.periods",
      };

      await httpClient.post("/test", null, specialHeaders);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: undefined,
          headers: specialHeaders,
        },
        undefined
      );
    });
  });

  describe("Request Method Delegation", () => {
    test("should delegate to request method with correct endpoint", async () => {
      const endpoint = "/api/users";

      await httpClient.post(endpoint, { name: "test" });

      expect(mockRequestSpy).toHaveBeenCalledWith(endpoint, expect.any(Object), undefined);
    });

    test("should delegate with POST method", async () => {
      await httpClient.post("/test", { data: "test" });

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        expect.objectContaining({
          method: "POST",
        }),
        undefined
      );
    });

    test("should delegate with correct service parameter", async () => {
      const serviceName = "user-service";

      await httpClient.post("/test", { data: "test" }, undefined, serviceName);

      expect(mockRequestSpy).toHaveBeenCalledWith("/test", expect.any(Object), serviceName);
    });

    test("should propagate return value from request method", async () => {
      const mockResponse = { id: 123, message: "success" };
      mockRequestSpy.mockResolvedValue(mockResponse);

      const result = await httpClient.post("/test", { data: "test" });

      expect(result).toEqual(mockResponse);
    });

    test("should propagate errors from request method", async () => {
      const mockError = new Error("Request failed");
      mockRequestSpy.mockRejectedValue(mockError);

      await expect(httpClient.post("/test", { data: "test" })).rejects.toThrow("Request failed");
    });

    test("should handle async request method properly", async () => {
      const delayedResponse = new Promise((resolve) => setTimeout(() => resolve({ delayed: true }), 10));
      mockRequestSpy.mockReturnValue(delayedResponse);

      const result = await httpClient.post("/test", { data: "test" });

      expect(result).toEqual({ delayed: true });
    });
  });

  describe("Edge Cases and Invalid Inputs", () => {
    test("should handle empty endpoint string", async () => {
      await httpClient.post("", { data: "test" });

      expect(mockRequestSpy).toHaveBeenCalledWith("", expect.any(Object), undefined);
    });

    test("should handle endpoint with special characters", async () => {
      const specialEndpoint = "/api/users/search?q=test&sort=name#results";

      await httpClient.post(specialEndpoint, { data: "test" });

      expect(mockRequestSpy).toHaveBeenCalledWith(specialEndpoint, expect.any(Object), undefined);
    });

    test("should handle all parameters as undefined/null", async () => {
      await httpClient.post("/test", undefined, undefined, undefined);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: undefined,
          headers: undefined,
        },
        undefined
      );
    });

    test("should handle endpoint with leading/trailing whitespace", async () => {
      const endpoint = "  /test/endpoint  ";

      await httpClient.post(endpoint, { data: "test" });

      expect(mockRequestSpy).toHaveBeenCalledWith(endpoint, expect.any(Object), undefined);
    });

    test("should handle service parameter with special characters", async () => {
      const specialService = "service-name_with.special@chars";

      await httpClient.post("/test", null, undefined, specialService);

      expect(mockRequestSpy).toHaveBeenCalledWith("/test", expect.any(Object), specialService);
    });

    test("should handle zero as valid payload", async () => {
      await httpClient.post("/test", 0);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(0),
          headers: undefined,
        },
        undefined
      );
    });

    test("should handle false as valid payload", async () => {
      await httpClient.post("/test", false);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(false),
          headers: undefined,
        },
        undefined
      );
    });

    test("should handle empty string as valid payload", async () => {
      await httpClient.post("/test", "");

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(""),
          headers: undefined,
        },
        undefined
      );
    });
  });

  describe("Debug Logging", () => {
    test("should log request details during post call", async () => {
      const headers = { "X-Test": "value" };
      const body = { data: "test" };

      await httpClient.post("/test", body, headers);

      // Verify body was logged
      expect(mockConsoleLog).toHaveBeenCalledWith("[HttpClient] POST body:", body);
    });

    test("should log undefined values when body is not provided", async () => {
      await httpClient.post("/test");

      expect(mockConsoleLog).toHaveBeenCalledWith("[HttpClient] POST body:", undefined); // body
    });
  });

  describe("Type Safety and Generic Support", () => {
    test("should support typed responses", async () => {
      interface ApiResponse {
        id: number;
        name: string;
      }

      const mockTypedResponse: ApiResponse = { id: 1, name: "test" };
      mockRequestSpy.mockResolvedValue(mockTypedResponse);

      const result = await httpClient.post<ApiResponse>("/test", { data: "test" });

      expect(result).toEqual(mockTypedResponse);
      expect(result.id).toBe(1);
      expect(result.name).toBe("test");
    });

    test("should handle complex payload types", async () => {
      interface ComplexPayload {
        user: {
          id: number;
          profile: {
            name: string;
            settings: Record<string, unknown>;
          };
        };
        metadata?: string[];
      }

      const payload: ComplexPayload = {
        user: {
          id: 123,
          profile: {
            name: "John",
            settings: { theme: "dark", language: "en" },
          },
        },
        metadata: ["tag1", "tag2"],
      };

      await httpClient.post("/test", payload);

      expect(mockRequestSpy).toHaveBeenCalledWith(
        "/test",
        {
          method: "POST",
          body: JSON.stringify(payload),
          headers: undefined,
        },
        undefined
      );
    });
  });

  describe("Integration with Request Method", () => {
    test("should call request method exactly once", async () => {
      await httpClient.post("/test", { data: "test" });

      expect(mockRequestSpy).toHaveBeenCalledTimes(1);
    });

    test("should not call request method if post throws during setup", async () => {
      // This test ensures that any errors in the post method setup don't leave the request method in a partial state
      const originalPost = httpClient.post;

      // Temporarily override JSON.stringify to throw an error
      const originalStringify = JSON.stringify;
      (global as any).JSON.stringify = () => {
        throw new Error("Stringify error");
      };

      try {
        await expect(httpClient.post("/test", { data: "test" })).rejects.toThrow();
        expect(mockRequestSpy).not.toHaveBeenCalled();
      } finally {
        // Restore original JSON.stringify
        (global as any).JSON.stringify = originalStringify;
      }
    });
  });
});

describe("HttpClient RFC 7231 Compliance - HTTP Method Body Handling", () => {
  let httpClient: HttpClient;
  let mockFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();

    const mockConfig: HttpClientConfig = {
      baseURL: "https://api.example.com",
      timeout: 5000,
    };

    httpClient = new HttpClient(mockConfig);

    // Mock global fetch
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = mockFetch;
  });

  describe("GET Method - Body Stripping", () => {
    test("should NOT include body in GET request when body is undefined", async () => {
      await httpClient.get("/test");

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    test("should strip body from GET request when data parameter is provided", async () => {
      // Create a custom GET request with body (simulating misuse)
      const requestSpy = vi.spyOn(httpClient as any, "request");

      await (httpClient as any).request("/test", {
        method: "GET",
        body: JSON.stringify({ data: "test" }),
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      // Body should be stripped
      expect(config.body).toBeUndefined();

      // Warning should be logged
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        "[HttpClient] Warning: GET requests cannot include a body (RFC 7231). Body parameter will be ignored."
      );
    });

    test("should handle GET with empty string body", async () => {
      await (httpClient as any).request("/test", {
        method: "GET",
        body: "",
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    test("should handle GET with null body gracefully", async () => {
      await (httpClient as any).request("/test", {
        method: "GET",
        body: null,
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      // null is falsy, but body property exists, so it should be stripped
      expect(config.body).toBeUndefined();
    });

    test("should handle lowercase 'get' method", async () => {
      await (httpClient as any).request("/test", {
        method: "get",
        body: JSON.stringify({ test: "data" }),
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    test("should handle mixed-case 'Get' method", async () => {
      await (httpClient as any).request("/test", {
        method: "Get",
        body: JSON.stringify({ test: "data" }),
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });
  });

  describe("HEAD Method - Body Stripping", () => {
    test("should strip body from HEAD request", async () => {
      await (httpClient as any).request("/test", {
        method: "HEAD",
        body: JSON.stringify({ data: "test" }),
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        "[HttpClient] Warning: HEAD requests cannot include a body (RFC 7231). Body parameter will be ignored."
      );
    });

    test("should handle lowercase 'head' method", async () => {
      await (httpClient as any).request("/test", {
        method: "head",
        body: JSON.stringify({ test: "data" }),
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    test("should not warn when HEAD request has no body", async () => {
      await (httpClient as any).request("/test", { method: "HEAD" });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });
  });

  describe("OPTIONS Method - Body Stripping", () => {
    test("should strip body from OPTIONS request", async () => {
      await (httpClient as any).request("/test", {
        method: "OPTIONS",
        body: JSON.stringify({ data: "test" }),
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        "[HttpClient] Warning: OPTIONS requests cannot include a body (RFC 7231). Body parameter will be ignored."
      );
    });

    test("should handle lowercase 'options' method", async () => {
      await (httpClient as any).request("/test", {
        method: "options",
        body: JSON.stringify({ test: "data" }),
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    test("should not warn when OPTIONS request has no body", async () => {
      await (httpClient as any).request("/test", { method: "OPTIONS" });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });
  });

  describe("POST Method - Body Allowed", () => {
    test("should allow body in POST request", async () => {
      const payload = { data: "test" };
      await httpClient.post("/test", payload);

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBe(JSON.stringify(payload));
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    test("should handle POST with complex body", async () => {
      const payload = {
        user: { name: "John", age: 30 },
        items: [1, 2, 3],
      };
      await httpClient.post("/test", payload);

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBe(JSON.stringify(payload));
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    test("should handle POST with undefined body", async () => {
      await httpClient.post("/test");

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });
  });

  describe("PUT Method - Body Allowed", () => {
    test("should allow body in PUT request", async () => {
      const payload = { data: "test" };
      await httpClient.put("/test", payload);

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBe(JSON.stringify(payload));
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    test("should handle PUT with complex body", async () => {
      const payload = {
        id: 123,
        updates: { field1: "value1", field2: "value2" },
      };
      await httpClient.put("/test", payload);

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBe(JSON.stringify(payload));
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    test("should handle PUT with undefined body", async () => {
      await httpClient.put("/test");

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });
  });

  describe("PATCH Method - Body Allowed", () => {
    test("should allow body in PATCH request", async () => {
      const payload = { field: "newValue" };
      await httpClient.patch("/test", payload);

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBe(JSON.stringify(payload));
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    test("should handle PATCH with partial update", async () => {
      const payload = { status: "active" };
      await httpClient.patch("/test/123", payload);

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBe(JSON.stringify(payload));
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    test("should handle PATCH with undefined body", async () => {
      await httpClient.patch("/test");

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });
  });

  describe("DELETE Method - Body Handling", () => {
    test("should allow DELETE without body", async () => {
      await httpClient.delete("/test");

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    test("should handle DELETE method correctly", async () => {
      await httpClient.delete("/test/123");

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.method).toBe("DELETE");
      expect(config.body).toBeUndefined();
    });
  });

  describe("Default Method Handling", () => {
    test("should default to GET when method is not specified", async () => {
      await (httpClient as any).request("/test", {
        body: JSON.stringify({ test: "data" }),
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      // Should strip body since default is GET
      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    test("should handle missing method property", async () => {
      await (httpClient as any).request("/test", {
        body: "test body",
        headers: { "X-Test": "value" },
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    test("should handle body with value 0 (falsy but defined)", async () => {
      await (httpClient as any).request("/test", {
        method: "GET",
        body: 0,
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    test("should handle body with empty string (falsy but defined)", async () => {
      await (httpClient as any).request("/test", {
        method: "GET",
        body: "",
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    test("should handle body with false (falsy but defined)", async () => {
      await (httpClient as any).request("/test", {
        method: "GET",
        body: false,
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    test("should preserve other config options when stripping body", async () => {
      const customHeaders = { "X-Custom": "value" };
      await (httpClient as any).request("/test", {
        method: "GET",
        body: JSON.stringify({ test: "data" }),
        headers: customHeaders,
      });

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.body).toBeUndefined();
      expect(config.headers).toBeDefined();
      expect(config.headers["X-Custom"]).toBe("value");
    });

    test("should warn only once per request", async () => {
      await (httpClient as any).request("/test", {
        method: "GET",
        body: JSON.stringify({ test: "data" }),
      });

      expect(mockConsoleWarn).toHaveBeenCalledTimes(1);
    });

    test("should handle GET request through public API correctly", async () => {
      await httpClient.get("/test");

      const callArgs = mockFetch.mock.calls[0];
      const config = callArgs[1];

      expect(config.method).toBe("GET");
      expect(config.body).toBeUndefined();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });
  });

  describe("Multiple Requests - State Isolation", () => {
    test("should handle multiple GET requests without interference", async () => {
      await (httpClient as any).request("/test1", {
        method: "GET",
        body: "body1",
      });

      await (httpClient as any).request("/test2", {
        method: "GET",
        body: "body2",
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const call1Config = mockFetch.mock.calls[0][1];
      const call2Config = mockFetch.mock.calls[1][1];

      expect(call1Config.body).toBeUndefined();
      expect(call2Config.body).toBeUndefined();
    });

    test("should handle mixed method requests correctly", async () => {
      // GET without body should be stripped
      await (httpClient as any).request("/test1", {
        method: "GET",
        body: "should-be-removed",
      });

      // POST with body should be preserved
      await httpClient.post("/test2", { data: "preserved" });

      const call1Config = mockFetch.mock.calls[0][1];
      const call2Config = mockFetch.mock.calls[1][1];

      expect(call1Config.body).toBeUndefined();
      expect(call2Config.body).toBe(JSON.stringify({ data: "preserved" }));
    });
  });
});
