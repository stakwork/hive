import { describe, it, expect, beforeEach } from "vitest";
import { EncryptionService } from "@/lib/encryption";

describe("Vercel API Token Encryption", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY ||
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    process.env.TOKEN_ENCRYPTION_KEY_ID = "k-test";
  });

  describe("vercelApiToken field encryption/decryption", () => {
    it("encrypts and decrypts Vercel API token successfully", () => {
      const encSvc = EncryptionService.getInstance();
      const apiToken = "vercel_abc123xyz789_test_token";
      
      const encrypted = encSvc.encryptField("vercelApiToken", apiToken);
      expect(encrypted).toHaveProperty("data");
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("tag");
      expect(encrypted.keyId).toBe("k-test");

      const decrypted = encSvc.decryptField("vercelApiToken", encrypted);
      expect(decrypted).toBe(apiToken);
    });

    it("encrypts Vercel API token with explicit key ID", () => {
      const encSvc = EncryptionService.getInstance();
      encSvc.setKey("k-vercel", process.env.TOKEN_ENCRYPTION_KEY!);
      
      const apiToken = "vercel_production_token_xyz";
      const encrypted = encSvc.encryptFieldWithKeyId(
        "vercelApiToken",
        apiToken,
        "k-vercel",
      );
      
      expect(encrypted.keyId).toBe("k-vercel");
      const decrypted = encSvc.decryptField("vercelApiToken", encrypted);
      expect(decrypted).toBe(apiToken);
    });

    it("handles long Vercel API tokens", () => {
      const encSvc = EncryptionService.getInstance();
      const longToken = "vercel_" + "a".repeat(500);
      
      const encrypted = encSvc.encryptField("vercelApiToken", longToken);
      const decrypted = encSvc.decryptField("vercelApiToken", encrypted);
      expect(decrypted).toBe(longToken);
    });

    it("decrypts JSON string representation of encrypted Vercel token", () => {
      const encSvc = EncryptionService.getInstance();
      const apiToken = "vercel_json_test_token";
      
      const encrypted = encSvc.encryptField("vercelApiToken", apiToken);
      const jsonString = JSON.stringify(encrypted);
      
      const decrypted = encSvc.decryptField("vercelApiToken", jsonString);
      expect(decrypted).toBe(apiToken);
    });

    it("encrypts and decrypts empty Vercel API token (API validation should prevent this)", () => {
      const encSvc = EncryptionService.getInstance();
      // Note: EncryptionService allows empty strings - validation happens at API level
      const encrypted = encSvc.encryptField("vercelApiToken", "");
      const decrypted = encSvc.decryptField("vercelApiToken", encrypted);
      expect(decrypted).toBe("");
    });

    it("returns plaintext when decrypting non-encrypted Vercel token string", () => {
      const encSvc = EncryptionService.getInstance();
      const plainToken = "vercel_plaintext_token";
      
      const result = encSvc.decryptField("vercelApiToken", plainToken);
      expect(result).toBe(plainToken);
    });

    it("detects tampered Vercel token encryption", () => {
      const encSvc = EncryptionService.getInstance();
      const apiToken = "vercel_secure_token";
      
      const encrypted = encSvc.encryptField("vercelApiToken", apiToken);
      const tampered = {
        ...encrypted,
        tag: encrypted.tag.slice(0, -4) + "AAAA",
      };
      
      expect(() =>
        encSvc.decryptField("vercelApiToken", tampered),
      ).toThrowError();
    });

    it("handles Vercel tokens with special characters", () => {
      const encSvc = EncryptionService.getInstance();
      const specialToken = "vercel_token_with_!@#$%^&*()_+-=";
      
      const encrypted = encSvc.encryptField("vercelApiToken", specialToken);
      const decrypted = encSvc.decryptField("vercelApiToken", encrypted);
      expect(decrypted).toBe(specialToken);
    });

    it("supports key rotation for Vercel tokens", () => {
      const encSvc = EncryptionService.getInstance();
      const oldKey =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const newKey = process.env.TOKEN_ENCRYPTION_KEY!;

      // Encrypt with old key
      encSvc.setKey("k-old", oldKey);
      encSvc.setActiveKeyId("k-old");
      const encryptedWithOld = encSvc.encryptField(
        "vercelApiToken",
        "vercel_old_key_token",
      );

      // Rotate to new key
      encSvc.setKey("k-new", newKey);
      encSvc.setActiveKeyId("k-new");

      // Should still decrypt data encrypted with old key
      const decrypted = encSvc.decryptField("vercelApiToken", encryptedWithOld);
      expect(decrypted).toBe("vercel_old_key_token");
    });
  });
});
