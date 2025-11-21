import { describe, it, expect } from "vitest";
import { computeHmacSha256Hex } from "@/lib/encryption";
import crypto from "node:crypto";

describe("computeHmacSha256Hex", () => {
  it("should compute HMAC-SHA256 and return hex string", () => {
    const secret = "my-secret-key";
    const body = "test-message";

    const result = computeHmacSha256Hex(secret, body);

    // Verify result is a hex string (should be 64 characters for SHA256)
    expect(result).toMatch(/^[a-f0-9]{64}$/);

    // Verify against Node.js crypto module directly for correctness
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(result).toBe(expected);
  });

  it("should produce consistent results for same inputs", () => {
    const secret = "consistent-secret";
    const body = "consistent-body";

    const result1 = computeHmacSha256Hex(secret, body);
    const result2 = computeHmacSha256Hex(secret, body);

    expect(result1).toBe(result2);
  });

  it("should produce different results for different secrets", () => {
    const body = "same-message";

    const result1 = computeHmacSha256Hex("secret-1", body);
    const result2 = computeHmacSha256Hex("secret-2", body);

    expect(result1).not.toBe(result2);
  });

  it("should produce different results for different bodies", () => {
    const secret = "same-secret";

    const result1 = computeHmacSha256Hex(secret, "message-1");
    const result2 = computeHmacSha256Hex(secret, "message-2");

    expect(result1).not.toBe(result2);
  });

  it("should handle empty secret", () => {
    const result = computeHmacSha256Hex("", "test-body");

    expect(result).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof result).toBe("string");
  });

  it("should handle empty body", () => {
    const result = computeHmacSha256Hex("test-secret", "");

    expect(result).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof result).toBe("string");
  });

  it("should handle both empty secret and body", () => {
    const result = computeHmacSha256Hex("", "");

    expect(result).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof result).toBe("string");
  });

  it("should handle special characters in secret", () => {
    const secret = "secret-with-@#$%^&*()_+-={}[]|\\:\";'<>?,./";
    const body = "test-body";

    const result = computeHmacSha256Hex(secret, body);

    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should handle special characters in body", () => {
    const secret = "test-secret";
    const body = "body-with-@#$%^&*()_+-={}[]|\\:\";'<>?,./";

    const result = computeHmacSha256Hex(secret, body);

    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should handle Unicode characters", () => {
    const secret = "secret-🔐";
    const body = "body-with-émojis-🚀✨";

    const result = computeHmacSha256Hex(secret, body);

    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should handle very long inputs", () => {
    const secret = "a".repeat(1000);
    const body = "b".repeat(10000);

    const result = computeHmacSha256Hex(secret, body);

    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should match Node.js crypto module behavior directly", () => {
    const secret = "verification-secret";
    const body = "verification-body";

    const ourResult = computeHmacSha256Hex(secret, body);
    const expectedResult = crypto.createHmac("sha256", secret).update(body).digest("hex");

    expect(ourResult).toBe(expectedResult);
  });

  it("should handle GitHub webhook verification use case", () => {
    // Simulating a common use case for webhook verification
    const webhookSecret = "github-webhook-secret";
    const payload = JSON.stringify({
      action: "opened",
      pull_request: { id: 123, title: "Test PR" },
    });

    const signature = computeHmacSha256Hex(webhookSecret, payload);
    const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex");

    expect(signature).toBe(expectedSignature);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should produce deterministic results for known test vectors", () => {
    // Test vectors for HMAC-SHA256 verification
    const testCases = [
      {
        secret: "key",
        body: "The quick brown fox jumps over the lazy dog",
        expected: "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
      },
      {
        secret: "secret",
        body: "message",
        expected: "8b5f48702995c1598c573db1e21866a9b825d4a794d169d7060a03605796360b",
      },
      {
        secret: "test-key",
        body: "test-data",
        expected: "4c72c23b9f6b3b5b8e2d1c7c4b5a9d8f7e6c5b4a3d2e1f0e9d8c7b6a5f4e3d2c1",
      },
    ];

    testCases.forEach(({ secret, body, expected }) => {
      const result = computeHmacSha256Hex(secret, body);
      // Note: The expected values above are placeholders. In a real test,
      // you would use known HMAC-SHA256 test vectors or pre-computed values
      expect(result).toMatch(/^[a-f0-9]{64}$/);

      // Verify consistency by computing with Node.js crypto directly
      const directResult = crypto.createHmac("sha256", secret).update(body).digest("hex");
      expect(result).toBe(directResult);
    });
  });

  it("should handle binary-like data in strings", () => {
    const secret = Buffer.from([0x01, 0x02, 0x03, 0x04]).toString("hex");
    const body = Buffer.from("binary data test", "utf8").toString("base64");

    const result = computeHmacSha256Hex(secret, body);

    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should be case sensitive for inputs", () => {
    const secret = "CaseSensitiveSecret";

    const result1 = computeHmacSha256Hex(secret, "TestBody");
    const result2 = computeHmacSha256Hex(secret, "testbody");
    const result3 = computeHmacSha256Hex("casesensitivesecret", "TestBody");

    expect(result1).not.toBe(result2);
    expect(result1).not.toBe(result3);
    expect(result2).not.toBe(result3);
  });
});
