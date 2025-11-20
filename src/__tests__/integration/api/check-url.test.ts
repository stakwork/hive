import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/check-url/route";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe("GET /api/check-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Parameter Validation", () => {
    test("should return 400 if url parameter is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/check-url");

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("URL parameter is required");
    });

    test("should return 400 if url parameter is empty string", async () => {
      const request = new NextRequest("http://localhost:3000/api/check-url?url=");

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("URL parameter is required");
    });
  });

  describe("Successful URL Validation", () => {
    test("should return isReady true for 200 OK response", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
      expect(data.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(testUrl, {
        method: "HEAD",
        signal: expect.any(AbortSignal),
      });
    });

    test("should return isReady true for 201 Created response", async () => {
      const testUrl = "https://api.example.com/resource";
      mockFetch.mockResolvedValue({
        status: 201,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
      expect(data.status).toBe(201);
    });

    test("should return isReady true for 301 Moved Permanently", async () => {
      const testUrl = "https://example.com/old-page";
      mockFetch.mockResolvedValue({
        status: 301,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
      expect(data.status).toBe(301);
    });

    test("should return isReady true for 302 Found redirect", async () => {
      const testUrl = "https://example.com/redirect";
      mockFetch.mockResolvedValue({
        status: 302,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
      expect(data.status).toBe(302);
    });

    test("should return isReady true for 399 status (boundary test)", async () => {
      const testUrl = "https://example.com/custom";
      mockFetch.mockResolvedValue({
        status: 399,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
      expect(data.status).toBe(399);
    });
  });

  describe("Failed URL Validation", () => {
    test("should return isReady false for 400 Bad Request", async () => {
      const testUrl = "https://example.com/bad-request";
      mockFetch.mockResolvedValue({
        status: 400,
        ok: false,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(false);
      expect(data.status).toBe(400);
    });

    test("should return isReady false for 404 Not Found", async () => {
      const testUrl = "https://example.com/not-found";
      mockFetch.mockResolvedValue({
        status: 404,
        ok: false,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(false);
      expect(data.status).toBe(404);
    });

    test("should return isReady false for 500 Internal Server Error", async () => {
      const testUrl = "https://example.com/server-error";
      mockFetch.mockResolvedValue({
        status: 500,
        ok: false,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(false);
      expect(data.status).toBe(500);
    });

    test("should return isReady false for 503 Service Unavailable", async () => {
      const testUrl = "https://example.com/unavailable";
      mockFetch.mockResolvedValue({
        status: 503,
        ok: false,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(false);
      expect(data.status).toBe(503);
    });
  });

  describe("Timeout Handling", () => {
    test("should handle timeout after 5 seconds", async () => {
      const testUrl = "https://slow-example.com";
      
      // Mock fetch to never resolve (simulating timeout)
      mockFetch.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error("The operation was aborted"));
          }, 5000);
        });
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      // Start the request
      const responsePromise = GET(request);
      
      // Fast-forward time by 5 seconds
      await vi.advanceTimersByTimeAsync(5000);

      const response = await responsePromise;
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(false);
      expect(data.error).toContain("aborted");
    });

    test("should use AbortSignal with 5000ms timeout", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      await GET(request);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1]).toHaveProperty("signal");
      expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("Network Error Handling", () => {
    test("should handle network error gracefully", async () => {
      const testUrl = "https://nonexistent-domain-12345.com";
      mockFetch.mockRejectedValue(new Error("Failed to fetch"));

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(false);
      expect(data.error).toBe("Failed to fetch");
    });

    test("should handle DNS resolution error", async () => {
      const testUrl = "https://invalid.domain.test";
      mockFetch.mockRejectedValue(new Error("getaddrinfo ENOTFOUND invalid.domain.test"));

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(false);
      expect(data.error).toContain("ENOTFOUND");
    });

    test("should handle connection refused error", async () => {
      const testUrl = "http://localhost:9999";
      mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED"));

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(false);
      expect(data.error).toContain("ECONNREFUSED");
    });

    test("should handle non-Error exceptions", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockRejectedValue("String error");

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(false);
      expect(data.error).toBe("Failed to fetch");
    });
  });

  describe("Edge Cases", () => {
    test("should handle URL with special characters", async () => {
      const testUrl = "https://example.com/path?param=value&other=123";
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(testUrl, expect.any(Object));
    });

    test("should handle URL with fragment identifier", async () => {
      const testUrl = "https://example.com/page#section";
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
    });

    test("should handle very long URL", async () => {
      const longPath = "a".repeat(1000);
      const testUrl = `https://example.com/${longPath}`;
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
    });

    test("should handle localhost URLs", async () => {
      const testUrl = "http://localhost:3000";
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
    });

    test("should handle IP address URLs", async () => {
      const testUrl = "http://192.168.1.1:8080";
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
    });

    test("should handle URLs with authentication", async () => {
      const testUrl = "https://user:pass@example.com";
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isReady).toBe(true);
    });
  });

  describe("HTTP Method Validation", () => {
    test("should use HEAD method for request", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(testUrl, {
        method: "HEAD",
        signal: expect.any(AbortSignal),
      });
    });

    test("should not download response body (HEAD request)", async () => {
      const testUrl = "https://example.com/large-file.zip";
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
        // HEAD request should not have body
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      await GET(request);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].method).toBe("HEAD");
    });
  });

  describe("Status Code Boundary Testing", () => {
    test("should accept status 399 as success (< 400)", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValue({
        status: 399,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.isReady).toBe(true);
      expect(data.status).toBe(399);
    });

    test("should reject status 400 as failure (>= 400)", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValue({
        status: 400,
        ok: false,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.isReady).toBe(false);
      expect(data.status).toBe(400);
    });

    test("should accept status 0 as success (edge case)", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValue({
        status: 0,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.isReady).toBe(true);
      expect(data.status).toBe(0);
    });
  });

  describe("Response Format Validation", () => {
    test("should return correct response structure on success", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty("isReady");
      expect(data).toHaveProperty("status");
      expect(data).not.toHaveProperty("error");
      expect(typeof data.isReady).toBe("boolean");
      expect(typeof data.status).toBe("number");
    });

    test("should return correct response structure on error", async () => {
      const testUrl = "https://example.com";
      mockFetch.mockRejectedValue(new Error("Network error"));

      const request = new NextRequest(
        `http://localhost:3000/api/check-url?url=${encodeURIComponent(testUrl)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty("isReady");
      expect(data).toHaveProperty("error");
      expect(data.isReady).toBe(false);
      expect(typeof data.error).toBe("string");
    });
  });
});