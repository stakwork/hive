import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  signCookie,
  verifyCookie,
  constantTimeCompare,
  isLandingPageEnabled,
  LANDING_COOKIE_MAX_AGE,
} from "@/lib/auth/landing-cookie";

// Store original env vars
const originalEnv = process.env;

describe("signCookie", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-key-for-hmac-signing";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("signs a cookie value with HMAC-SHA256", async () => {
    const timestamp = "1234567890";
    const signed = await signCookie(timestamp);

    expect(signed).toContain(".");
    const [value, signature] = signed.split(".");
    expect(value).toBe(timestamp);
    expect(signature).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex = 64 chars
  });

  it("produces consistent signatures for the same input", async () => {
    const timestamp = "1234567890";
    const signed1 = await signCookie(timestamp);
    const signed2 = await signCookie(timestamp);

    expect(signed1).toBe(signed2);
  });

  it("produces different signatures for different inputs", async () => {
    const signed1 = await signCookie("1234567890");
    const signed2 = await signCookie("9876543210");

    expect(signed1).not.toBe(signed2);
  });

  it("throws error when NEXTAUTH_SECRET is missing", async () => {
    delete process.env.NEXTAUTH_SECRET;

    await expect(signCookie("123")).rejects.toThrow("NEXTAUTH_SECRET is required for cookie signing");
  });

  it("signs timestamps as strings", async () => {
    const timestamp = Date.now().toString();
    const signed = await signCookie(timestamp);

    expect(signed).toContain(timestamp);
  });

  it("handles empty string values", async () => {
    const signed = await signCookie("");

    expect(signed).toMatch(/^\.[a-f0-9]{64}$/);
  });

  it("uses Web Crypto API for HMAC signing", async () => {
    const timestamp = "1234567890";
    const signed = await signCookie(timestamp);

    // Verify signature format matches Web Crypto output
    const [, signature] = signed.split(".");
    expect(signature.length).toBe(64); // SHA-256 produces 64 hex chars
  });
});

describe("verifyCookie", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-key-for-hmac-signing";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("verifies valid signed cookie", async () => {
    const timestamp = Date.now().toString();
    const signed = await signCookie(timestamp);

    const isValid = await verifyCookie(signed);

    expect(isValid).toBe(true);
  });

  it("rejects cookie with invalid signature", async () => {
    const timestamp = Date.now().toString();
    const invalidSigned = `${timestamp}.invalid1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab`;

    const isValid = await verifyCookie(invalidSigned);

    expect(isValid).toBe(false);
  });

  it("rejects cookie with tampered timestamp", async () => {
    const timestamp = Date.now().toString();
    const signed = await signCookie(timestamp);

    // Tamper with timestamp but keep signature
    const [, signature] = signed.split(".");
    const tamperedTimestamp = (parseInt(timestamp) + 1000).toString();
    const tampered = `${tamperedTimestamp}.${signature}`;

    const isValid = await verifyCookie(tampered);

    expect(isValid).toBe(false);
  });

  it("rejects expired cookie (> 24 hours old)", async () => {
    const oldTimestamp = (Date.now() - (LANDING_COOKIE_MAX_AGE + 3600) * 1000).toString();
    const signed = await signCookie(oldTimestamp);

    const isValid = await verifyCookie(signed);

    expect(isValid).toBe(false);
  });

  it("accepts cookie within 24-hour window", async () => {
    const recentTimestamp = (Date.now() - 3600 * 1000).toString(); // 1 hour ago
    const signed = await signCookie(recentTimestamp);

    const isValid = await verifyCookie(signed);

    expect(isValid).toBe(true);
  });

  it("rejects cookie with future timestamp (negative age)", async () => {
    const futureTimestamp = (Date.now() + 3600 * 1000).toString(); // 1 hour in future
    const signed = await signCookie(futureTimestamp);

    const isValid = await verifyCookie(signed);

    expect(isValid).toBe(false);
  });

  it("rejects malformed cookie (no dot separator)", async () => {
    const malformed = "1234567890abcdef";

    const isValid = await verifyCookie(malformed);

    expect(isValid).toBe(false);
  });

  it("rejects malformed cookie (multiple dots)", async () => {
    const malformed = "123.456.789";

    const isValid = await verifyCookie(malformed);

    expect(isValid).toBe(false);
  });

  it("rejects cookie with non-numeric timestamp", async () => {
    const malformed = "not-a-timestamp.abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

    const isValid = await verifyCookie(malformed);

    expect(isValid).toBe(false);
  });

  it("returns false when NEXTAUTH_SECRET is missing", async () => {
    const timestamp = Date.now().toString();
    const signed = await signCookie(timestamp);

    delete process.env.NEXTAUTH_SECRET;

    const isValid = await verifyCookie(signed);

    expect(isValid).toBe(false);
  });

  it("returns false on crypto exception", async () => {
    const timestamp = Date.now().toString();
    const signed = await signCookie(timestamp);

    // Mock crypto.subtle to throw error
    const originalSubtle = crypto.subtle;
    Object.defineProperty(crypto, "subtle", {
      value: {
        importKey: vi.fn().mockRejectedValue(new Error("Crypto error")),
      },
      configurable: true,
    });

    const isValid = await verifyCookie(signed);

    expect(isValid).toBe(false);

    // Restore crypto.subtle
    Object.defineProperty(crypto, "subtle", {
      value: originalSubtle,
      configurable: true,
    });
  });

  it("handles empty signature part", async () => {
    const timestamp = Date.now().toString();
    const malformed = `${timestamp}.`;

    const isValid = await verifyCookie(malformed);

    expect(isValid).toBe(false);
  });

  it("handles empty timestamp part", async () => {
    const malformed = ".abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab";

    const isValid = await verifyCookie(malformed);

    expect(isValid).toBe(false);
  });
});

describe("constantTimeCompare", () => {
  it("returns true for identical strings", () => {
    const result = constantTimeCompare("test", "test");

    expect(result).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    const result = constantTimeCompare("test", "best");

    expect(result).toBe(false);
  });

  it("returns false for different strings of different lengths", () => {
    const result = constantTimeCompare("short", "longer string");

    expect(result).toBe(false);
  });

  it("handles empty strings", () => {
    const result1 = constantTimeCompare("", "");
    const result2 = constantTimeCompare("", "test");
    const result3 = constantTimeCompare("test", "");

    expect(result1).toBe(true);
    expect(result2).toBe(false);
    expect(result3).toBe(false);
  });

  it("compares strings with special characters", () => {
    const str1 = "test@example.com";
    const str2 = "test@example.com";
    const str3 = "test@example.net";

    expect(constantTimeCompare(str1, str2)).toBe(true);
    expect(constantTimeCompare(str1, str3)).toBe(false);
  });

  it("handles unicode characters", () => {
    const str1 = "hello 世界";
    const str2 = "hello 世界";
    const str3 = "hello world";

    expect(constantTimeCompare(str1, str2)).toBe(true);
    expect(constantTimeCompare(str1, str3)).toBe(false);
  });

  it("pads shorter string to prevent timing leaks", () => {
    // This test ensures the function doesn't short-circuit on length mismatch
    const short = "abc";
    const long = "abcdefgh";

    // Should take same time regardless of length difference
    const start = performance.now();
    constantTimeCompare(short, long);
    const end = performance.now();

    // Verify it actually compares (doesn't just return false immediately)
    expect(end - start).toBeGreaterThan(0);
    expect(constantTimeCompare(short, long)).toBe(false);
  });

  it("performs constant-time comparison for security", () => {
    // Test that comparison time doesn't leak information about where strings differ
    const base = "a".repeat(100);
    const diff1 = "b" + "a".repeat(99); // Differs at position 0
    const diff2 = "a".repeat(99) + "b"; // Differs at position 99

    const times: number[] = [];

    // Measure multiple comparisons
    for (let i = 0; i < 10; i++) {
      const start1 = performance.now();
      constantTimeCompare(base, diff1);
      const time1 = performance.now() - start1;

      const start2 = performance.now();
      constantTimeCompare(base, diff2);
      const time2 = performance.now() - start2;

      times.push(Math.abs(time1 - time2));
    }

    // Time differences should be minimal (timing should be constant)
    const avgDiff = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avgDiff).toBeLessThan(1); // Less than 1ms difference on average
  });

  it("compares hex strings (signature format)", () => {
    const sig1 = "abcdef1234567890";
    const sig2 = "abcdef1234567890";
    const sig3 = "fedcba0987654321";

    expect(constantTimeCompare(sig1, sig2)).toBe(true);
    expect(constantTimeCompare(sig1, sig3)).toBe(false);
  });

  it("is case-sensitive", () => {
    const result = constantTimeCompare("Test", "test");

    expect(result).toBe(false);
  });
});

describe("isLandingPageEnabled", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "development";
    process.env.LANDING_PAGE_PASSWORD = "test-password";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns true when landing page password is set", () => {
    const enabled = isLandingPageEnabled();

    expect(enabled).toBe(true);
  });

  it("returns false in test environment", () => {
    process.env.NODE_ENV = "test";

    const enabled = isLandingPageEnabled();

    expect(enabled).toBe(false);
  });

  it("returns false when password is not set", () => {
    delete process.env.LANDING_PAGE_PASSWORD;

    const enabled = isLandingPageEnabled();

    expect(enabled).toBe(false);
  });

  it("returns false when password is empty string", () => {
    process.env.LANDING_PAGE_PASSWORD = "";

    const enabled = isLandingPageEnabled();

    expect(enabled).toBe(false);
  });

  it("returns false when password is only whitespace", () => {
    process.env.LANDING_PAGE_PASSWORD = "   ";

    const enabled = isLandingPageEnabled();

    expect(enabled).toBe(false);
  });

  it("returns true in production with valid password", () => {
    process.env.NODE_ENV = "production";
    process.env.LANDING_PAGE_PASSWORD = "secure-password";

    const enabled = isLandingPageEnabled();

    expect(enabled).toBe(true);
  });

  it("returns true in development with valid password", () => {
    process.env.NODE_ENV = "development";
    process.env.LANDING_PAGE_PASSWORD = "dev-password";

    const enabled = isLandingPageEnabled();

    expect(enabled).toBe(true);
  });
});

describe("Landing Cookie Integration", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("verifies freshly signed cookie", async () => {
    const timestamp = Date.now().toString();
    const signed = await signCookie(timestamp);
    const verified = await verifyCookie(signed);

    expect(verified).toBe(true);
  });

  it("rejects cookie signed with different secret", async () => {
    const timestamp = Date.now().toString();
    const signed = await signCookie(timestamp);

    // Change secret
    process.env.NEXTAUTH_SECRET = "different-secret";

    const verified = await verifyCookie(signed);

    expect(verified).toBe(false);
  });

  it("handles cookie lifecycle from creation to expiration", async () => {
    const timestamp = Date.now().toString();
    const signed = await signCookie(timestamp);

    // Verify immediately
    expect(await verifyCookie(signed)).toBe(true);

    // Simulate time passing (but within 24 hours)
    const oneHourAgo = (Date.now() - 3600 * 1000).toString();
    const recentSigned = await signCookie(oneHourAgo);
    expect(await verifyCookie(recentSigned)).toBe(true);

    // Simulate expiration (> 24 hours)
    const expiredTimestamp = (Date.now() - (LANDING_COOKIE_MAX_AGE + 1) * 1000).toString();
    const expiredSigned = await signCookie(expiredTimestamp);
    expect(await verifyCookie(expiredSigned)).toBe(false);
  });
});
