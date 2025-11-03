import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { RateLimiter, getClientIp } from "@/lib/auth/rate-limiter";

describe("RateLimiter", () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      windowMs: 60000, // 1 minute
      maxRequests: 5,
    });
  });

  afterEach(() => {
    rateLimiter.destroy();
  });

  test("should allow requests within rate limit", () => {
    const result1 = rateLimiter.check("192.168.1.1");
    expect(result1.allowed).toBe(true);

    const result2 = rateLimiter.check("192.168.1.1");
    expect(result2.allowed).toBe(true);

    const result3 = rateLimiter.check("192.168.1.1");
    expect(result3.allowed).toBe(true);
  });

  test("should block requests exceeding rate limit", () => {
    // Make 5 requests (at limit)
    for (let i = 0; i < 5; i++) {
      const result = rateLimiter.check("192.168.1.2");
      expect(result.allowed).toBe(true);
    }

    // 6th request should be blocked
    const result = rateLimiter.check("192.168.1.2");
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeDefined();
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  test("should handle multiple identifiers independently", () => {
    // IP 1 - make 5 requests
    for (let i = 0; i < 5; i++) {
      rateLimiter.check("192.168.1.3");
    }

    // IP 1 - should be blocked
    const result1 = rateLimiter.check("192.168.1.3");
    expect(result1.allowed).toBe(false);

    // IP 2 - should still be allowed
    const result2 = rateLimiter.check("192.168.1.4");
    expect(result2.allowed).toBe(true);
  });

  test("should reset rate limit after window expires", async () => {
    const shortWindowLimiter = new RateLimiter({
      windowMs: 100, // 100ms window
      maxRequests: 2,
    });

    // Make 2 requests (at limit)
    shortWindowLimiter.check("192.168.1.5");
    shortWindowLimiter.check("192.168.1.5");

    // 3rd request should be blocked
    const result1 = shortWindowLimiter.check("192.168.1.5");
    expect(result1.allowed).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should be allowed again after window reset
    const result2 = shortWindowLimiter.check("192.168.1.5");
    expect(result2.allowed).toBe(true);

    shortWindowLimiter.destroy();
  });

  test("should reset specific identifier", () => {
    // Make 5 requests (at limit)
    for (let i = 0; i < 5; i++) {
      rateLimiter.check("192.168.1.6");
    }

    // Should be blocked
    const result1 = rateLimiter.check("192.168.1.6");
    expect(result1.allowed).toBe(false);

    // Reset the identifier
    rateLimiter.reset("192.168.1.6");

    // Should be allowed again
    const result2 = rateLimiter.check("192.168.1.6");
    expect(result2.allowed).toBe(true);
  });

  test("should cleanup expired entries periodically", async () => {
    const limiter = new RateLimiter({
      windowMs: 50, // 50ms window
      maxRequests: 1,
    });

    // Make request
    limiter.check("192.168.1.7");

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Trigger cleanup by making request with different IP
    limiter.check("192.168.1.8");

    // Original IP should be cleaned up and allowed again
    const result = limiter.check("192.168.1.7");
    expect(result.allowed).toBe(true);

    limiter.destroy();
  });
});

describe("getClientIp", () => {
  test("should extract IP from X-Forwarded-For header", () => {
    const headers = new Headers();
    headers.set("x-forwarded-for", "203.0.113.1, 198.51.100.1, 192.0.2.1");

    const ip = getClientIp(headers);
    expect(ip).toBe("203.0.113.1");
  });

  test("should extract IP from X-Real-IP header when X-Forwarded-For is missing", () => {
    const headers = new Headers();
    headers.set("x-real-ip", "203.0.113.2");

    const ip = getClientIp(headers);
    expect(ip).toBe("203.0.113.2");
  });

  test("should return 'unknown' when no IP headers are present", () => {
    const headers = new Headers();

    const ip = getClientIp(headers);
    expect(ip).toBe("unknown");
  });

  test("should prioritize X-Forwarded-For over X-Real-IP", () => {
    const headers = new Headers();
    headers.set("x-forwarded-for", "203.0.113.3");
    headers.set("x-real-ip", "203.0.113.4");

    const ip = getClientIp(headers);
    expect(ip).toBe("203.0.113.3");
  });

  test("should trim whitespace from extracted IP", () => {
    const headers = new Headers();
    headers.set("x-forwarded-for", "  203.0.113.5  , 198.51.100.2");

    const ip = getClientIp(headers);
    expect(ip).toBe("203.0.113.5");
  });
});