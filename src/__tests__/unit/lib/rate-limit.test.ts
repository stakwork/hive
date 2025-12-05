import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Upstash modules before imports
vi.mock("@upstash/redis", () => ({
  Redis: vi.fn().mockImplementation(() => ({
    // Mock Redis client
  })),
}));

vi.mock("@upstash/ratelimit", () => {
  const RatelimitMock = vi.fn().mockImplementation(() => ({
    limit: vi.fn(),
  }));
  
  // Add static method
  RatelimitMock.slidingWindow = vi.fn();
  
  return {
    Ratelimit: RatelimitMock,
  };
});

// Mock environment variables
const originalEnv = process.env;

describe("Rate Limit Utility", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("extractRateLimitIdentifier", () => {
    it("should extract IP from x-forwarded-for header", async () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
      process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

      const { extractRateLimitIdentifier } = await import("@/lib/rate-limit");

      const request = new Request("https://example.com", {
        headers: {
          "x-forwarded-for": "192.168.1.1, 10.0.0.1",
        },
      });

      const identifier = extractRateLimitIdentifier(request);
      expect(identifier).toBe("192.168.1.1");
    });

    it("should extract IP from x-real-ip header when x-forwarded-for is missing", async () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
      process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

      const { extractRateLimitIdentifier } = await import("@/lib/rate-limit");

      const request = new Request("https://example.com", {
        headers: {
          "x-real-ip": "192.168.1.2",
        },
      });

      const identifier = extractRateLimitIdentifier(request);
      expect(identifier).toBe("192.168.1.2");
    });

    it("should return fallback identifier when no IP headers present", async () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
      process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

      const { extractRateLimitIdentifier } = await import("@/lib/rate-limit");

      const request = new Request("https://example.com");

      const identifier = extractRateLimitIdentifier(request);
      expect(identifier).toBe("unknown-ip");
    });

    it("should handle comma-separated IPs in x-forwarded-for", async () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
      process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

      const { extractRateLimitIdentifier } = await import("@/lib/rate-limit");

      const request = new Request("https://example.com", {
        headers: {
          "x-forwarded-for": "203.0.113.1, 198.51.100.1, 192.0.2.1",
        },
      });

      const identifier = extractRateLimitIdentifier(request);
      expect(identifier).toBe("203.0.113.1");
    });
  });

  describe("checkRateLimit", () => {
    it("should allow request when Redis is not configured", async () => {
      // No Redis env vars set
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const { checkRateLimit } = await import("@/lib/rate-limit");

      const result = await checkRateLimit("192.168.1.1", "webhook");

      expect(result.success).toBe(true);
      expect(result.limit).toBeGreaterThan(0);
      expect(result.remaining).toBeGreaterThan(0);
    });

    it("should use configured rate limits from environment", async () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      process.env.RATE_LIMIT_WEBHOOK_REQUESTS = "50";
      process.env.RATE_LIMIT_WEBHOOK_WINDOW = "1 m";

      const { checkRateLimit } = await import("@/lib/rate-limit");

      const result = await checkRateLimit("192.168.1.1", "webhook");

      expect(result.limit).toBe(50);
    });

    it("should handle different rate limit types", async () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      process.env.RATE_LIMIT_API_REQUESTS = "500";

      const { checkRateLimit } = await import("@/lib/rate-limit");

      const result = await checkRateLimit("192.168.1.1", "api");

      expect(result.limit).toBe(500);
    });
  });

  describe("createRateLimitHeaders", () => {
    it("should create proper rate limit headers", async () => {
      const { createRateLimitHeaders } = await import("@/lib/rate-limit");

      const result = {
        success: true,
        limit: 100,
        remaining: 95,
        reset: Date.now() + 60000,
      };

      const headers = createRateLimitHeaders(result);

      expect(headers["X-RateLimit-Limit"]).toBe("100");
      expect(headers["X-RateLimit-Remaining"]).toBe("95");
      expect(headers["X-RateLimit-Reset"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("createRateLimitResponse", () => {
    it("should create 429 response with proper headers", async () => {
      const { createRateLimitResponse } = await import("@/lib/rate-limit");

      const result = {
        success: false,
        limit: 100,
        remaining: 0,
        reset: Date.now() + 60000,
      };

      const response = createRateLimitResponse(result);

      expect(response.status).toBe(429);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(response.headers.get("Retry-After")).toBeTruthy();
      expect(response.headers.get("X-RateLimit-Limit")).toBe("100");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    });

    it("should include error message in response body", async () => {
      const { createRateLimitResponse } = await import("@/lib/rate-limit");

      const result = {
        success: false,
        limit: 100,
        remaining: 0,
        reset: Date.now() + 60000,
      };

      const response = createRateLimitResponse(result);
      const body = await response.json();

      expect(body.error).toBe("Too Many Requests");
      expect(body.message).toContain("Rate limit exceeded");
      expect(body.retryAfter).toBeGreaterThan(0);
    });
  });

  describe("Rate limit configuration", () => {
    it("should use default values when environment variables are not set", async () => {
      delete process.env.RATE_LIMIT_WEBHOOK_REQUESTS;
      delete process.env.RATE_LIMIT_WEBHOOK_WINDOW;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const { checkRateLimit } = await import("@/lib/rate-limit");

      const result = await checkRateLimit("test", "webhook");

      // Default webhook limit is 100
      expect(result.limit).toBe(100);
    });

    it("should parse numeric rate limit values correctly", async () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      process.env.RATE_LIMIT_WEBHOOK_REQUESTS = "250";

      const { checkRateLimit } = await import("@/lib/rate-limit");

      const result = await checkRateLimit("test", "webhook");

      expect(result.limit).toBe(250);
    });
  });
});
