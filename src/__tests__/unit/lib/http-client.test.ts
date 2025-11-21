import { describe, test, expect, vi, beforeEach } from "vitest";
import { HttpClient } from "@/lib/http-client";
import type { HttpClientConfig } from "@/lib/http-client";

// Mock console methods to avoid cluttering test output
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
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
        undefined,
      );
    });
  });

  describe("Debug Logging", () => {
    test("should log request details during post call", async () => {
      const headers = { "X-Test": "value" };
      const body = { data: "test" };

      await httpClient.post("/test", body, headers);

      // Verify console.log was called for the debug separator
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "--------------------------------post--------------------------------",
      );

      // Verify headers and body were logged
      expect(mockConsoleLog).toHaveBeenCalledWith(headers);
      expect(mockConsoleLog).toHaveBeenCalledWith(body);
    });

    test("should log undefined values when headers/body are not provided", async () => {
      await httpClient.post("/test");

      expect(mockConsoleLog).toHaveBeenCalledWith(undefined); // headers
      expect(mockConsoleLog).toHaveBeenCalledWith(undefined); // body
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
        undefined,
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
