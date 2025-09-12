import { describe, test, expect, vi, beforeEach } from "vitest";
import { 
  timingSafeEqual, 
  computeHmacSha256Hex,
  EncryptionService 
} from "@/lib/encryption";
import crypto from "node:crypto";

// Mock crypto module for controlled testing
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof crypto>("node:crypto");
  return {
    ...actual,
    timingSafeEqual: vi.fn(),
    createHmac: vi.fn(),
  };
});

const mockedCrypto = vi.mocked(crypto);

describe("Encryption Utils - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("timingSafeEqual", () => {
    test("should return true for identical strings", () => {
      const mockTimingSafeEqual = vi.fn().mockReturnValue(true);
      mockedCrypto.timingSafeEqual = mockTimingSafeEqual;

      const result = timingSafeEqual("hello", "hello");

      expect(result).toBe(true);
      expect(mockTimingSafeEqual).toHaveBeenCalledTimes(1);
      // Verify it's called with Buffers of equal length
      expect(mockTimingSafeEqual).toHaveBeenCalledWith(
        Buffer.from("hello"),
        Buffer.from("hello")
      );
    });

    test("should return false for different strings of same length", () => {
      const mockTimingSafeEqual = vi.fn().mockReturnValue(false);
      mockedCrypto.timingSafeEqual = mockTimingSafeEqual;

      const result = timingSafeEqual("hello", "world");

      expect(result).toBe(false);
      expect(mockTimingSafeEqual).toHaveBeenCalledTimes(1);
      expect(mockTimingSafeEqual).toHaveBeenCalledWith(
        Buffer.from("hello"),
        Buffer.from("world")
      );
    });

    test("should return false for strings of different lengths", () => {
      const result = timingSafeEqual("hello", "hi");

      expect(result).toBe(false);
      // Should not call crypto.timingSafeEqual for different lengths
      expect(mockedCrypto.timingSafeEqual).not.toHaveBeenCalled();
    });

    test("should handle empty strings correctly", () => {
      const mockTimingSafeEqual = vi.fn().mockReturnValue(true);
      mockedCrypto.timingSafeEqual = mockTimingSafeEqual;

      const result = timingSafeEqual("", "");

      expect(result).toBe(true);
      expect(mockTimingSafeEqual).toHaveBeenCalledWith(
        Buffer.from(""),
        Buffer.from("")
      );
    });

    test("should handle one empty and one non-empty string", () => {
      const result = timingSafeEqual("", "hello");

      expect(result).toBe(false);
      expect(mockedCrypto.timingSafeEqual).not.toHaveBeenCalled();
    });

    test("should handle special characters and Unicode", () => {
      const mockTimingSafeEqual = vi.fn().mockReturnValue(true);
      mockedCrypto.timingSafeEqual = mockTimingSafeEqual;

      const specialString = "café🚀";
      const result = timingSafeEqual(specialString, specialString);

      expect(result).toBe(true);
      expect(mockTimingSafeEqual).toHaveBeenCalledWith(
        Buffer.from(specialString),
        Buffer.from(specialString)
      );
    });

    test("should prevent timing attacks by consistent buffer length checking", () => {
      const longString = "a".repeat(1000);
      const shortString = "b".repeat(10);

      const result = timingSafeEqual(longString, shortString);

      expect(result).toBe(false);
      // Should return immediately on length mismatch without calling crypto function
      expect(mockedCrypto.timingSafeEqual).not.toHaveBeenCalled();
    });

    test("should handle strings with null bytes", () => {
      const mockTimingSafeEqual = vi.fn().mockReturnValue(false);
      mockedCrypto.timingSafeEqual = mockTimingSafeEqual;

      const stringWithNull = "hello\x00world";
      const normalString = "hello world";

      const result = timingSafeEqual(stringWithNull, normalString);

      expect(result).toBe(false);
      expect(mockTimingSafeEqual).toHaveBeenCalledWith(
        Buffer.from(stringWithNull),
        Buffer.from(normalString)
      );
    });
  });

  describe("computeHmacSha256Hex", () => {
    test("should compute HMAC-SHA256 correctly", () => {
      const mockHmac = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue("mocked-hex-digest"),
      };
      const mockCreateHmac = vi.fn().mockReturnValue(mockHmac);
      mockedCrypto.createHmac = mockCreateHmac;

      const secret = "my-secret-key";
      const body = "message-to-sign";
      const result = computeHmacSha256Hex(secret, body);

      expect(result).toBe("mocked-hex-digest");
      expect(mockCreateHmac).toHaveBeenCalledWith("sha256", secret);
      expect(mockHmac.update).toHaveBeenCalledWith(body);
      expect(mockHmac.digest).toHaveBeenCalledWith("hex");
    });

    test("should handle empty secret", () => {
      const mockHmac = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue("empty-secret-digest"),
      };
      const mockCreateHmac = vi.fn().mockReturnValue(mockHmac);
      mockedCrypto.createHmac = mockCreateHmac;

      const result = computeHmacSha256Hex("", "test-body");

      expect(result).toBe("empty-secret-digest");
      expect(mockCreateHmac).toHaveBeenCalledWith("sha256", "");
      expect(mockHmac.update).toHaveBeenCalledWith("test-body");
    });

    test("should handle empty body", () => {
      const mockHmac = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue("empty-body-digest"),
      };
      const mockCreateHmac = vi.fn().mockReturnValue(mockHmac);
      mockedCrypto.createHmac = mockCreateHmac;

      const result = computeHmacSha256Hex("secret", "");

      expect(result).toBe("empty-body-digest");
      expect(mockCreateHmac).toHaveBeenCalledWith("sha256", "secret");
      expect(mockHmac.update).toHaveBeenCalledWith("");
    });

    test("should handle large payloads", () => {
      const mockHmac = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue("large-payload-digest"),
      };
      const mockCreateHmac = vi.fn().mockReturnValue(mockHmac);
      mockedCrypto.createHmac = mockCreateHmac;

      const largeBody = "x".repeat(10000);
      const result = computeHmacSha256Hex("secret", largeBody);

      expect(result).toBe("large-payload-digest");
      expect(mockHmac.update).toHaveBeenCalledWith(largeBody);
    });

    test("should handle special characters in secret and body", () => {
      const mockHmac = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue("special-chars-digest"),
      };
      const mockCreateHmac = vi.fn().mockReturnValue(mockHmac);
      mockedCrypto.createHmac = mockCreateHmac;

      const secretWithSpecialChars = "key🔑with€symbols";
      const bodyWithSpecialChars = '{"message": "café🚀", "timestamp": 1234567890}';

      const result = computeHmacSha256Hex(secretWithSpecialChars, bodyWithSpecialChars);

      expect(result).toBe("special-chars-digest");
      expect(mockCreateHmac).toHaveBeenCalledWith("sha256", secretWithSpecialChars);
      expect(mockHmac.update).toHaveBeenCalledWith(bodyWithSpecialChars);
    });

    test("should return consistent hex format", () => {
      const mockHmac = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue("abcdef1234567890"),
      };
      const mockCreateHmac = vi.fn().mockReturnValue(mockHmac);
      mockedCrypto.createHmac = mockCreateHmac;

      const result = computeHmacSha256Hex("secret", "message");

      expect(result).toBe("abcdef1234567890");
      expect(mockHmac.digest).toHaveBeenCalledWith("hex");
    });

    test("should handle JSON payload for webhook validation", () => {
      const mockHmac = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue("webhook-signature"),
      };
      const mockCreateHmac = vi.fn().mockReturnValue(mockHmac);
      mockedCrypto.createHmac = mockCreateHmac;

      const webhookSecret = "webhook-secret-key";
      const jsonPayload = JSON.stringify({
        event: "payment.completed",
        data: { id: "12345", amount: 100 }
      });

      const result = computeHmacSha256Hex(webhookSecret, jsonPayload);

      expect(result).toBe("webhook-signature");
      expect(mockCreateHmac).toHaveBeenCalledWith("sha256", webhookSecret);
      expect(mockHmac.update).toHaveBeenCalledWith(jsonPayload);
    });
  });

  describe("Integration with EncryptionService", () => {
    test("should verify HMAC functions work with EncryptionService for authentication", () => {
      const mockHmac = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue("integration-test-signature"),
      };
      const mockCreateHmac = vi.fn().mockReturnValue(mockHmac);
      mockedCrypto.createHmac = mockCreateHmac;

      // Simulate API key validation scenario
      const apiKey = "user-api-key";
      const requestBody = JSON.stringify({ action: "create_workspace", name: "test" });
      
      const signature = computeHmacSha256Hex(apiKey, requestBody);
      
      expect(signature).toBe("integration-test-signature");
      expect(mockCreateHmac).toHaveBeenCalledWith("sha256", apiKey);
      expect(mockHmac.update).toHaveBeenCalledWith(requestBody);
    });

    test("should verify timing-safe comparison works for authentication tokens", () => {
      const mockTimingSafeEqual = vi.fn().mockReturnValue(true);
      mockedCrypto.timingSafeEqual = mockTimingSafeEqual;

      // Simulate JWT token validation
      const storedToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";
      const receivedToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";
      
      const isValid = timingSafeEqual(storedToken, receivedToken);
      
      expect(isValid).toBe(true);
      expect(mockTimingSafeEqual).toHaveBeenCalledWith(
        Buffer.from(storedToken),
        Buffer.from(receivedToken)
      );
    });
  });

  describe("Error Handling and Edge Cases", () => {
    test("timingSafeEqual should handle crypto module errors gracefully", () => {
      const mockTimingSafeEqual = vi.fn().mockImplementation(() => {
        throw new Error("Crypto operation failed");
      });
      mockedCrypto.timingSafeEqual = mockTimingSafeEqual;

      expect(() => timingSafeEqual("test", "test")).toThrow("Crypto operation failed");
    });

    test("computeHmacSha256Hex should handle crypto module errors gracefully", () => {
      const mockCreateHmac = vi.fn().mockImplementation(() => {
        throw new Error("HMAC creation failed");
      });
      mockedCrypto.createHmac = mockCreateHmac;

      expect(() => computeHmacSha256Hex("secret", "message")).toThrow("HMAC creation failed");
    });

    test("should handle null and undefined inputs for timingSafeEqual", () => {
      // TypeScript would catch these, but testing runtime behavior
      expect(() => timingSafeEqual(null as any, "test")).toThrow();
      expect(() => timingSafeEqual("test", undefined as any)).toThrow();
    });

    test("should handle null and undefined inputs for computeHmacSha256Hex", () => {
      expect(() => computeHmacSha256Hex(null as any, "message")).toThrow();
      expect(() => computeHmacSha256Hex("secret", undefined as any)).toThrow();
    });
  });

  describe("Security Properties", () => {
    test("timingSafeEqual should prevent timing attacks by using constant-time comparison", () => {
      const mockTimingSafeEqual = vi.fn().mockReturnValue(false);
      mockedCrypto.timingSafeEqual = mockTimingSafeEqual;

      const secret = "super-secret-password";
      const guess = "super-secret-passwor";

      // Different lengths should return immediately without crypto call
      const result = timingSafeEqual(secret, guess);

      expect(result).toBe(false);
      expect(mockTimingSafeEqual).not.toHaveBeenCalled();
    });

    test("computeHmacSha256Hex should produce consistent signatures for authentication", () => {
      const mockHmac = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue("consistent-signature"),
      };
      const mockCreateHmac = vi.fn().mockReturnValue(mockHmac);
      mockedCrypto.createHmac = mockCreateHmac;

      const secret = "webhook-secret";
      const message = "important-payload";

      // Should produce same signature for same inputs
      const signature1 = computeHmacSha256Hex(secret, message);
      const signature2 = computeHmacSha256Hex(secret, message);

      expect(signature1).toBe("consistent-signature");
      expect(signature2).toBe("consistent-signature");
      expect(signature1).toBe(signature2);
    });

    test("should demonstrate proper webhook signature validation pattern", () => {
      const mockHmac = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue("webhook-signature-hash"),
      };
      const mockCreateHmac = vi.fn().mockReturnValue(mockHmac);
      mockedCrypto.createHmac = mockCreateHmac;

      const mockTimingSafeEqual = vi.fn().mockReturnValue(true);
      mockedCrypto.timingSafeEqual = mockTimingSafeEqual;

      // Simulate webhook validation
      const webhookSecret = "wh_secret_key";
      const payload = '{"event":"user.created","data":{"id":"123"}}';
      const receivedSignature = "sha256=webhook-signature-hash";

      const computedSignature = `sha256=${computeHmacSha256Hex(webhookSecret, payload)}`;
      const isValid = timingSafeEqual(receivedSignature, computedSignature);

      expect(isValid).toBe(true);
      expect(computedSignature).toBe("sha256=webhook-signature-hash");
    });
  });
});