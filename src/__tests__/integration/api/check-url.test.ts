import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/check-url/route";
import { expectSuccess, expectError } from "@/__tests__/support/helpers/api-assertions";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("GET /api/check-url Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Parameter Validation", () => {
    test("returns 400 when url parameter is missing", async () => {
      const request = new Request("http://localhost:3000/api/check-url");

      const response = await GET(request);

      await expectError(response, "URL parameter is required", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 400 when url parameter is empty string", async () => {
      const request = new Request("http://localhost:3000/api/check-url?url=");

      const response = await GET(request);

      await expectError(response, "URL parameter is required", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Successful URL Checks", () => {
    test("returns isReady: true for status 200", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: true,
        status: 200,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        testUrl,
        expect.objectContaining({
          method: "HEAD",
          signal: expect.any(AbortSignal),
        })
      );
    });

    test("returns isReady: true for status 299 (2xx range)", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValueOnce({
        status: 299,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: true,
        status: 299,
      });
    });

    test("returns isReady: true for status 301 (redirect)", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValueOnce({
        status: 301,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: true,
        status: 301,
      });
    });

    test("returns isReady: true for status 399 (boundary case)", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValueOnce({
        status: 399,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: true,
        status: 399,
      });
    });
  });

  describe("Failed URL Checks", () => {
    test("returns isReady: false for status 400 (boundary case)", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValueOnce({
        status: 400,
        ok: false,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: false,
        status: 400,
      });
    });

    test("returns isReady: false for status 404", async () => {
      const testUrl = "https://example.com/not-found";
      mockFetch.mockResolvedValueOnce({
        status: 404,
        ok: false,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: false,
        status: 404,
      });
    });

    test("returns isReady: false for status 500", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValueOnce({
        status: 500,
        ok: false,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: false,
        status: 500,
      });
    });

    test("returns isReady: false for status 503 (service unavailable)", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValueOnce({
        status: 503,
        ok: false,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: false,
        status: 503,
      });
    });
  });

  describe("Network Errors", () => {
    test("handles network error with generic Error", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: false,
        error: "Network error",
      });
    });

    test("handles ECONNREFUSED error", async () => {
      const testUrl = "https://example.com";
      const connectionError = new Error("connect ECONNREFUSED");
      mockFetch.mockRejectedValueOnce(connectionError);

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: false,
        error: "connect ECONNREFUSED",
      });
    });

    test("handles timeout error", async () => {
      const testUrl = "https://example.com";
      const timeoutError = new Error("The operation was aborted");
      timeoutError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(timeoutError);

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: false,
        error: "The operation was aborted",
      });
    });

    test("handles non-Error exception", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockRejectedValueOnce("String error");

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: false,
        error: "Failed to fetch",
      });
    });

    test("handles DNS resolution failure", async () => {
      const testUrl = "https://invalid-domain-that-does-not-exist.com";
      mockFetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: false,
        error: "getaddrinfo ENOTFOUND",
      });
    });
  });

  describe("HTTP Method Verification", () => {
    test("uses HEAD method instead of GET", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        testUrl,
        expect.objectContaining({
          method: "HEAD",
        })
      );
    });

    test("includes AbortSignal for timeout", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      await GET(request);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1]).toHaveProperty("signal");
      expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("URL Encoding", () => {
    test("handles URLs with query parameters", async () => {
      const testUrl = "https://example.com?param=value&other=test";
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.isReady).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(testUrl, expect.any(Object));
    });

    test("handles URLs with special characters", async () => {
      const testUrl = "https://example.com/path/with spaces/and-dashes";
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.isReady).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(testUrl, expect.any(Object));
    });

    test("handles URLs with hash fragments", async () => {
      const testUrl = "https://example.com/page#section";
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.isReady).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(testUrl, expect.any(Object));
    });
  });

  describe("Response Format", () => {
    test("success response includes isReady and status fields", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("isReady");
      expect(data).toHaveProperty("status");
      expect(typeof data.isReady).toBe("boolean");
      expect(typeof data.status).toBe("number");
    });

    test("error response includes isReady and error fields", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockRejectedValueOnce(new Error("Test error"));

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("isReady");
      expect(data).toHaveProperty("error");
      expect(data.isReady).toBe(false);
      expect(typeof data.error).toBe("string");
    });

    test("error response does not include status field", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockRejectedValueOnce(new Error("Test error"));

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).not.toHaveProperty("status");
    });
  });

  describe("Edge Cases", () => {
    test("handles localhost URLs", async () => {
      const testUrl = "http://localhost:3000";
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.isReady).toBe(true);
    });

    test("handles IP address URLs", async () => {
      const testUrl = "http://192.168.1.1:8080";
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.isReady).toBe(true);
    });

    test("handles URLs with non-standard ports", async () => {
      const testUrl = "https://example.com:8443";
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.isReady).toBe(true);
    });

    test("handles very long URLs", async () => {
      const testUrl = "https://example.com/" + "a".repeat(2000);
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.isReady).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(testUrl, expect.any(Object));
    });

    test("handles URLs with authentication in path", async () => {
      const testUrl = "https://user:pass@example.com";
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.isReady).toBe(true);
    });
  });

  describe("Status Code Boundaries", () => {
    test.each([
      [100, true],   // Informational
      [101, true],
      [200, true],   // Success
      [204, true],
      [299, true],
      [300, true],   // Redirection
      [301, true],
      [302, true],
      [399, true],   // Last valid redirect code
      [400, false],  // Client error (boundary)
      [401, false],
      [403, false],
      [404, false],
      [499, false],
      [500, false],  // Server error
      [502, false],
      [503, false],
      [599, false],
    ])("status code %i returns isReady: %s", async (statusCode, expectedReady) => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValueOnce({
        status: statusCode,
        ok: statusCode < 400,
      });

      const request = new Request(`http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`);
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        isReady: expectedReady,
        status: statusCode,
      });
    });
  });
});