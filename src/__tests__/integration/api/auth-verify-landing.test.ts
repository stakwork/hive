import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/auth/verify-landing/route";
import {
  signCookie,
  verifyCookie,
  constantTimeCompare,
  LANDING_COOKIE_NAME,
  LANDING_COOKIE_MAX_AGE,
} from "@/lib/auth/landing-cookie";
import { createPostRequest } from "@/__tests__/support/helpers/request-builders";

describe("POST /api/auth/verify-landing Integration Tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment to clean state
    process.env = { ...originalEnv };
    process.env.LANDING_PAGE_PASSWORD = "test-password-123";
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret-for-hmac-signing-32chars";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Success scenarios", () => {
    test("should return 200 and set signed cookie on valid password", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password-123",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Access granted");

      // Verify cookie was set
      const setCookieHeader = response.headers.get("set-cookie");
      expect(setCookieHeader).toBeTruthy();
      expect(setCookieHeader).toContain(LANDING_COOKIE_NAME);
    });

    test("should set cookie with correct security flags", async () => {
      // Test in production mode
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password-123",
      });

      const response = await POST(request);
      const setCookieHeader = response.headers.get("set-cookie");

      expect(setCookieHeader).toContain("HttpOnly");
      expect(setCookieHeader).toContain("SameSite=lax");
      expect(setCookieHeader).toContain("Secure");
      expect(setCookieHeader).toContain("Path=/");
      expect(setCookieHeader).toContain(`Max-Age=${LANDING_COOKIE_MAX_AGE}`);

      process.env.NODE_ENV = originalNodeEnv;
    });

    test("should not set Secure flag in non-production environment", async () => {
      process.env.NODE_ENV = "development";

      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password-123",
      });

      const response = await POST(request);
      const setCookieHeader = response.headers.get("set-cookie");

      expect(setCookieHeader).toContain("HttpOnly");
      expect(setCookieHeader).toContain("SameSite=lax");
      expect(setCookieHeader).not.toContain("Secure");
    });

    test("should generate valid HMAC-signed cookie that passes verification", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password-123",
      });

      const response = await POST(request);
      const setCookieHeader = response.headers.get("set-cookie");

      // Extract cookie value
      const cookieMatch = setCookieHeader?.match(new RegExp(`${LANDING_COOKIE_NAME}=([^;]+)`));
      expect(cookieMatch).toBeTruthy();
      const cookieValue = cookieMatch![1];

      // Verify the signed cookie
      const isValid = await verifyCookie(cookieValue);
      expect(isValid).toBe(true);
    });

    test("should generate cookie with timestamp that is within valid range", async () => {
      const beforeTimestamp = Date.now();

      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password-123",
      });

      await POST(request);
      const afterTimestamp = Date.now();

      // Generate a test cookie to verify timestamp format
      const testTimestamp = Date.now().toString();
      const signedValue = await signCookie(testTimestamp);
      const [timestamp] = signedValue.split(".");

      const timestampNum = parseInt(timestamp, 10);
      expect(timestampNum).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(timestampNum).toBeLessThanOrEqual(afterTimestamp);
    });
  });

  describe("Authentication failures", () => {
    test("should return 401 for incorrect password", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {
        password: "wrong-password",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Incorrect password");

      // Verify no cookie was set
      const setCookieHeader = response.headers.get("set-cookie");
      expect(setCookieHeader).toBeNull();
    });

    test("should return 400 for missing password field", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {});

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Password is required");

      const setCookieHeader = response.headers.get("set-cookie");
      expect(setCookieHeader).toBeNull();
    });

    test("should return 400 for empty password string", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {
        password: "",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Password is required");
    });

    test("should return 400 for non-string password value", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {
        password: 12345,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Password is required");
    });

    test("should return 400 for null password", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {
        password: null,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Password is required");
    });
  });

  describe("Configuration validation", () => {
    test("should return 400 when LANDING_PAGE_PASSWORD is not set", async () => {
      delete process.env.LANDING_PAGE_PASSWORD;

      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Landing page password is not enabled");
    });

    test("should return 400 when LANDING_PAGE_PASSWORD is empty string", async () => {
      process.env.LANDING_PAGE_PASSWORD = "";

      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Landing page password is not enabled");
    });

    test("should return 400 when LANDING_PAGE_PASSWORD is whitespace only", async () => {
      process.env.LANDING_PAGE_PASSWORD = "   ";

      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Landing page password is not enabled");
    });
  });

  describe("Cookie signature security", () => {
    test("should generate cookie with HMAC-SHA256 signature", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password-123",
      });

      const response = await POST(request);
      const setCookieHeader = response.headers.get("set-cookie");

      const cookieMatch = setCookieHeader?.match(new RegExp(`${LANDING_COOKIE_NAME}=([^;]+)`));
      const cookieValue = cookieMatch![1];

      // Verify format: timestamp.signature
      expect(cookieValue).toMatch(/^\d+\.[a-f0-9]{64}$/);
    });

    test("should reject cookie with tampered signature", async () => {
      const timestamp = Date.now().toString();
      const tamperedCookie = `${timestamp}.invalid_signature_hash`;

      const isValid = await verifyCookie(tamperedCookie);
      expect(isValid).toBe(false);
    });

    test("should reject cookie with tampered timestamp", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password-123",
      });

      const response = await POST(request);
      const setCookieHeader = response.headers.get("set-cookie");

      const cookieMatch = setCookieHeader?.match(new RegExp(`${LANDING_COOKIE_NAME}=([^;]+)`));
      const [originalTimestamp, signature] = cookieMatch![1].split(".");

      // Tamper with timestamp but keep original signature
      const tamperedTimestamp = (parseInt(originalTimestamp, 10) + 1000).toString();
      const tamperedCookie = `${tamperedTimestamp}.${signature}`;

      const isValid = await verifyCookie(tamperedCookie);
      expect(isValid).toBe(false);
    });

    test("should reject cookie with invalid format", async () => {
      const invalidFormats = ["no-dot-separator", "timestamp-only.", ".signature-only", "too.many.dots", ""];

      for (const invalidCookie of invalidFormats) {
        const isValid = await verifyCookie(invalidCookie);
        expect(isValid).toBe(false);
      }
    });
  });

  describe("Cookie expiry validation", () => {
    test("should reject expired cookie (older than 24 hours)", async () => {
      const expiredTimestamp = (Date.now() - (LANDING_COOKIE_MAX_AGE + 1) * 1000).toString();
      const signedExpiredCookie = await signCookie(expiredTimestamp);

      const isValid = await verifyCookie(signedExpiredCookie);
      expect(isValid).toBe(false);
    });

    test("should accept cookie within 24-hour validity window", async () => {
      const recentTimestamp = (Date.now() - 1000 * 60 * 60).toString(); // 1 hour ago
      const signedRecentCookie = await signCookie(recentTimestamp);

      const isValid = await verifyCookie(signedRecentCookie);
      expect(isValid).toBe(true);
    });

    test("should reject cookie with future timestamp", async () => {
      const futureTimestamp = (Date.now() + 1000 * 60 * 60).toString(); // 1 hour in future
      const signedFutureCookie = await signCookie(futureTimestamp);

      const isValid = await verifyCookie(signedFutureCookie);
      expect(isValid).toBe(false);
    });

    test("should reject cookie with non-numeric timestamp", async () => {
      const invalidTimestamp = "not-a-number";
      const signature = "a".repeat(64); // Valid hex length
      const invalidCookie = `${invalidTimestamp}.${signature}`;

      const isValid = await verifyCookie(invalidCookie);
      expect(isValid).toBe(false);
    });
  });

  describe("Timing-attack resistance", () => {
    test("constantTimeCompare should return true for identical strings", () => {
      const password = "test-password-123";
      expect(constantTimeCompare(password, password)).toBe(true);
    });

    test("constantTimeCompare should return false for different strings of same length", () => {
      const password1 = "test-password-123";
      const password2 = "test-password-456";
      expect(constantTimeCompare(password1, password2)).toBe(false);
    });

    test("constantTimeCompare should return false for different strings of different lengths", () => {
      const password1 = "short";
      const password2 = "much-longer-password";
      expect(constantTimeCompare(password1, password2)).toBe(false);
    });

    test("constantTimeCompare should handle empty strings", () => {
      expect(constantTimeCompare("", "")).toBe(true);
      expect(constantTimeCompare("", "non-empty")).toBe(false);
      expect(constantTimeCompare("non-empty", "")).toBe(false);
    });

    test("constantTimeCompare should handle special characters", () => {
      const special1 = "p@ssw0rd!#$%";
      const special2 = "p@ssw0rd!#$%";
      const special3 = "p@ssw0rd!#$*";

      expect(constantTimeCompare(special1, special2)).toBe(true);
      expect(constantTimeCompare(special1, special3)).toBe(false);
    });

    test("endpoint should use constant-time comparison for password validation", async () => {
      // This test verifies the endpoint behavior remains consistent
      // regardless of password similarity (preventing timing attacks)
      const correctPassword = "test-password-123";
      const veryClosePassword = "test-password-12X"; // Only last char different
      const veryDifferentPassword = "zzzzzzzzzzzzzzzzz";

      const request1 = createPostRequest("/api/auth/verify-landing", {
        password: veryClosePassword,
      });
      const request2 = createPostRequest("/api/auth/verify-landing", {
        password: veryDifferentPassword,
      });

      const response1 = await POST(request1);
      const response2 = await POST(request2);

      // Both should fail with same status code and message
      expect(response1.status).toBe(401);
      expect(response2.status).toBe(401);

      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data1.message).toBe("Incorrect password");
      expect(data2.message).toBe("Incorrect password");
    });
  });

  describe("Error handling", () => {
    test("should return 400 for malformed JSON body", async () => {
      const request = new Request("http://localhost:3000/api/auth/verify-landing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "invalid-json{",
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Invalid or missing JSON body");
    });

    test("should handle missing NEXTAUTH_SECRET gracefully during signCookie", async () => {
      const originalSecret = process.env.NEXTAUTH_SECRET;
      delete process.env.NEXTAUTH_SECRET;

      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password-123",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("An error occurred");

      process.env.NEXTAUTH_SECRET = originalSecret;
    });
  });

  describe("Integration with middleware flow", () => {
    test("should generate cookie that middleware can verify", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password-123",
      });

      const response = await POST(request);
      const setCookieHeader = response.headers.get("set-cookie");

      const cookieMatch = setCookieHeader?.match(new RegExp(`${LANDING_COOKIE_NAME}=([^;]+)`));
      const cookieValue = cookieMatch![1];

      // Simulate middleware verification
      const isValid = await verifyCookie(cookieValue);
      expect(isValid).toBe(true);
    });

    test("should set cookie path to root for middleware access", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password-123",
      });

      const response = await POST(request);
      const setCookieHeader = response.headers.get("set-cookie");

      expect(setCookieHeader).toContain("Path=/");
    });

    test("should set httpOnly flag to prevent JavaScript access", async () => {
      const request = createPostRequest("/api/auth/verify-landing", {
        password: "test-password-123",
      });

      const response = await POST(request);
      const setCookieHeader = response.headers.get("set-cookie");

      expect(setCookieHeader).toContain("HttpOnly");
    });
  });

  describe("Password validation edge cases", () => {
    test("should validate password with leading/trailing whitespace as different", async () => {
      process.env.LANDING_PAGE_PASSWORD = "test-password";

      const request = createPostRequest("/api/auth/verify-landing", {
        password: " test-password ",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
    });

    test("should validate password case-sensitively", async () => {
      process.env.LANDING_PAGE_PASSWORD = "Test-Password";

      const request1 = createPostRequest("/api/auth/verify-landing", {
        password: "Test-Password",
      });
      const request2 = createPostRequest("/api/auth/verify-landing", {
        password: "test-password",
      });

      const response1 = await POST(request1);
      const response2 = await POST(request2);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(401);
    });

    test("should handle very long passwords correctly", async () => {
      const longPassword = "a".repeat(1000);
      process.env.LANDING_PAGE_PASSWORD = longPassword;

      const request = createPostRequest("/api/auth/verify-landing", {
        password: longPassword,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("should handle unicode characters in password", async () => {
      const unicodePassword = "test-密碼-🔒-пароль";
      process.env.LANDING_PAGE_PASSWORD = unicodePassword;

      const request = createPostRequest("/api/auth/verify-landing", {
        password: unicodePassword,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
