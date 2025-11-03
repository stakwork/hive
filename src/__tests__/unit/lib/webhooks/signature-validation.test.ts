import { describe, it, expect } from "vitest";
import {
  computeHmacSha256Hex,
  timingSafeEqual,
  validateWebhookSignature,
} from "@/lib/webhooks/signature-validation";
import crypto from "crypto";

describe("Webhook Signature Validation", () => {
  describe("computeHmacSha256Hex", () => {
    it("should compute correct HMAC-SHA256 signature", () => {
      const secret = "test-secret";
      const payload = "test payload";
      const signature = computeHmacSha256Hex(secret, payload);

      // Verify it matches Node's crypto implementation
      const expected = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
      expect(signature).toBe(expected);
    });

    it("should produce deterministic signatures", () => {
      const secret = "test-secret";
      const payload = "test payload";
      const signature1 = computeHmacSha256Hex(secret, payload);
      const signature2 = computeHmacSha256Hex(secret, payload);

      expect(signature1).toBe(signature2);
    });

    it("should produce different signatures for different secrets", () => {
      const payload = "test payload";
      const signature1 = computeHmacSha256Hex("secret1", payload);
      const signature2 = computeHmacSha256Hex("secret2", payload);

      expect(signature1).not.toBe(signature2);
    });

    it("should produce different signatures for different payloads", () => {
      const secret = "test-secret";
      const signature1 = computeHmacSha256Hex(secret, "payload1");
      const signature2 = computeHmacSha256Hex(secret, "payload2");

      expect(signature1).not.toBe(signature2);
    });

    it("should handle empty strings", () => {
      const signature = computeHmacSha256Hex("secret", "");
      expect(signature).toBeTruthy();
      expect(signature).toHaveLength(64); // SHA256 hex length
    });

    it("should handle unicode characters", () => {
      const secret = "test-secret";
      const payload = "Hello 世界 🌍";
      const signature = computeHmacSha256Hex(secret, payload);

      expect(signature).toBeTruthy();
      expect(signature).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("timingSafeEqual", () => {
    it("should return true for identical strings", () => {
      const str = "test-string";
      expect(timingSafeEqual(str, str)).toBe(true);
    });

    it("should return false for different strings of same length", () => {
      expect(timingSafeEqual("test1", "test2")).toBe(false);
    });

    it("should return false for strings of different lengths", () => {
      expect(timingSafeEqual("short", "longer string")).toBe(false);
    });

    it("should be timing-safe (constant time for same-length comparisons)", () => {
      // This is a basic test - true timing attack resistance requires specialized testing
      const validSignature = "a".repeat(64);
      const invalidSignature1 = "b".repeat(64); // Different first char
      const invalidSignature2 = "a".repeat(63) + "b"; // Different last char

      // Both should return false
      expect(timingSafeEqual(validSignature, invalidSignature1)).toBe(false);
      expect(timingSafeEqual(validSignature, invalidSignature2)).toBe(false);
    });

    it("should handle empty strings", () => {
      expect(timingSafeEqual("", "")).toBe(true);
      expect(timingSafeEqual("", "non-empty")).toBe(false);
    });

    it("should handle unicode strings", () => {
      const str1 = "Hello 世界";
      const str2 = "Hello 世界";
      const str3 = "Hello World"; // Same string length, different content

      expect(timingSafeEqual(str1, str2)).toBe(true);
      expect(timingSafeEqual(str1, str3)).toBe(false);
    });
  });

  describe("validateWebhookSignature", () => {
    const secret = "webhook-secret";
    const payload = '{"event":"test","data":"value"}';

    describe("SHA256 algorithm (default)", () => {
      it("should validate correct signature", () => {
        const signature = computeHmacSha256Hex(secret, payload);
        const isValid = validateWebhookSignature({
          secret,
          payload,
          signature,
        });

        expect(isValid).toBe(true);
      });

      it("should reject invalid signature", () => {
        const wrongSignature = computeHmacSha256Hex("wrong-secret", payload);
        const isValid = validateWebhookSignature({
          secret,
          payload,
          signature: wrongSignature,
        });

        expect(isValid).toBe(false);
      });

      it("should reject tampered payload", () => {
        const signature = computeHmacSha256Hex(secret, payload);
        const tamperedPayload = '{"event":"test","data":"tampered"}';
        const isValid = validateWebhookSignature({
          secret,
          payload: tamperedPayload,
          signature,
        });

        expect(isValid).toBe(false);
      });

      it("should handle signature with prefix", () => {
        const signature = computeHmacSha256Hex(secret, payload);
        const prefixedSignature = `sha256=${signature}`;
        const isValid = validateWebhookSignature({
          secret,
          payload,
          signature: prefixedSignature,
          prefix: "sha256=",
        });

        expect(isValid).toBe(true);
      });

      it("should reject signature with incorrect prefix", () => {
        const signature = computeHmacSha256Hex(secret, payload);
        const wrongPrefixSignature = `sha1=${signature}`;
        const isValid = validateWebhookSignature({
          secret,
          payload,
          signature: wrongPrefixSignature,
          prefix: "sha256=",
        });

        expect(isValid).toBe(false);
      });
    });

    describe("SHA1 algorithm", () => {
      it("should validate correct SHA1 signature", () => {
        const signature = crypto
          .createHmac("sha1", secret)
          .update(payload)
          .digest("hex");
        const isValid = validateWebhookSignature({
          secret,
          payload,
          signature,
          algorithm: "sha1",
        });

        expect(isValid).toBe(true);
      });

      it("should reject invalid SHA1 signature", () => {
        const wrongSignature = crypto
          .createHmac("sha1", "wrong-secret")
          .update(payload)
          .digest("hex");
        const isValid = validateWebhookSignature({
          secret,
          payload,
          signature: wrongSignature,
          algorithm: "sha1",
        });

        expect(isValid).toBe(false);
      });

      it("should handle SHA1 signature with prefix", () => {
        const signature = crypto
          .createHmac("sha1", secret)
          .update(payload)
          .digest("hex");
        const prefixedSignature = `sha1=${signature}`;
        const isValid = validateWebhookSignature({
          secret,
          payload,
          signature: prefixedSignature,
          algorithm: "sha1",
          prefix: "sha1=",
        });

        expect(isValid).toBe(true);
      });
    });

    describe("Edge cases", () => {
      it("should handle empty payload", () => {
        const emptyPayload = "";
        const signature = computeHmacSha256Hex(secret, emptyPayload);
        const isValid = validateWebhookSignature({
          secret,
          payload: emptyPayload,
          signature,
        });

        expect(isValid).toBe(true);
      });

      it("should handle large payloads", () => {
        const largePayload = "x".repeat(10000);
        const signature = computeHmacSha256Hex(secret, largePayload);
        const isValid = validateWebhookSignature({
          secret,
          payload: largePayload,
          signature,
        });

        expect(isValid).toBe(true);
      });

      it("should handle unicode payloads", () => {
        const unicodePayload = '{"message":"Hello 世界 🌍"}';
        const signature = computeHmacSha256Hex(secret, unicodePayload);
        const isValid = validateWebhookSignature({
          secret,
          payload: unicodePayload,
          signature,
        });

        expect(isValid).toBe(true);
      });

      it("should handle special characters in secret", () => {
        const specialSecret = "secret!@#$%^&*()_+-=[]{}|;:',.<>?";
        const signature = computeHmacSha256Hex(specialSecret, payload);
        const isValid = validateWebhookSignature({
          secret: specialSecret,
          payload,
          signature,
        });

        expect(isValid).toBe(true);
      });
    });

    describe("Security considerations", () => {
      it("should prevent timing attacks via constant-time comparison", () => {
        const signature = computeHmacSha256Hex(secret, payload);
        const almostCorrect = signature.slice(0, -1) + "a";
        const completelyWrong = "0".repeat(signature.length);

        // Both invalid signatures should be rejected
        expect(
          validateWebhookSignature({
            secret,
            payload,
            signature: almostCorrect,
          }),
        ).toBe(false);

        expect(
          validateWebhookSignature({
            secret,
            payload,
            signature: completelyWrong,
          }),
        ).toBe(false);
      });

      it("should not leak information about secret length", () => {
        const shortSecret = "abc";
        const longSecret = "a".repeat(100);

        const signature1 = computeHmacSha256Hex(shortSecret, payload);
        const signature2 = computeHmacSha256Hex(longSecret, payload);

        // Both signatures should be same length
        expect(signature1.length).toBe(signature2.length);
        expect(signature1.length).toBe(64); // SHA256 hex length
      });
    });
  });
});
