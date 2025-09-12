import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { EncryptionService } from "@/lib/encryption";
import { encrypt, decrypt, isEncrypted, generateKey } from "@/lib/encryption/crypto";
import type { EncryptedData } from "@/types/encryption";

describe("Authentication Token Encryption - Unit Tests", () => {
  let encryptionService: EncryptionService;
  let testKey: Buffer;

  beforeEach(() => {
    // Generate a test key for encryption
    testKey = generateKey();
    
    // Create a fresh encryption service instance
    // Need to reset the singleton to ensure clean state
    (EncryptionService as any).instance = null;
    
    // Set environment variable to control key ID
    process.env.TOKEN_ENCRYPTION_KEY_ID = "test-key";
    process.env.TOKEN_ENCRYPTION_KEY = testKey.toString("hex");
    
    encryptionService = EncryptionService.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Token Field Encryption", () => {
    test("should encrypt access_token field correctly", () => {
      const sensitiveToken = "github_access_token_12345_sensitive";
      
      const encrypted = encryptionService.encryptField("access_token", sensitiveToken);
      
      expect(encrypted).toHaveProperty("data");
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("tag");
      expect(encrypted).toHaveProperty("keyId", "test-key");
      expect(encrypted).toHaveProperty("version", "1");
      expect(encrypted).toHaveProperty("encryptedAt");
      
      // Verify the encrypted data is different from original
      expect(encrypted.data).not.toBe(sensitiveToken);
      expect(encrypted.data).toMatch(/^[A-Za-z0-9+/]+=*$/); // Base64 format
    });

    test("should encrypt refresh_token field correctly", () => {
      const refreshToken = "refresh_token_abcdef_67890";
      
      const encrypted = encryptionService.encryptField("refresh_token", refreshToken);
      
      expect(encrypted).toHaveProperty("data");
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("tag");
      expect(encrypted.keyId).toBe("test-key");
      
      // Each encryption should produce different IV and data
      const encrypted2 = encryptionService.encryptField("refresh_token", refreshToken);
      expect(encrypted.iv).not.toBe(encrypted2.iv);
      expect(encrypted.data).not.toBe(encrypted2.data);
    });

    test("should encrypt id_token field correctly", () => {
      const idToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjE2NzAyODk";
      
      const encrypted = encryptionService.encryptField("id_token", idToken);
      
      expect(encrypted).toHaveProperty("data");
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("tag");
      expect(encrypted.keyId).toBe("test-key");
    });

    test("should handle empty token strings", () => {
      const emptyToken = "";
      
      const encrypted = encryptionService.encryptField("access_token", emptyToken);
      
      expect(encrypted).toHaveProperty("data");
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("tag");
      
      const decrypted = encryptionService.decryptField("access_token", encrypted);
      expect(decrypted).toBe("");
    });

    test("should handle very long tokens", () => {
      const longToken = "a".repeat(10000);
      
      const encrypted = encryptionService.encryptField("access_token", longToken);
      
      expect(encrypted).toHaveProperty("data");
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("tag");
      
      const decrypted = encryptionService.decryptField("access_token", encrypted);
      expect(decrypted).toBe(longToken);
    });

    test("should handle tokens with special characters", () => {
      const specialToken = "token_with_special_chars_!@#$%^&*()_+-=[]{}|;':\",./<>?";
      
      const encrypted = encryptionService.encryptField("access_token", specialToken);
      const decrypted = encryptionService.decryptField("access_token", encrypted);
      
      expect(decrypted).toBe(specialToken);
    });
  });

  describe("Token Decryption", () => {
    test("should decrypt encrypted tokens correctly", () => {
      const originalToken = "github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      
      const encrypted = encryptionService.encryptField("access_token", originalToken);
      const decrypted = encryptionService.decryptField("access_token", encrypted);
      
      expect(decrypted).toBe(originalToken);
    });

    test("should handle decryption of JSON-stringified encrypted data", () => {
      const originalToken = "refresh_token_xyz_789";
      
      const encrypted = encryptionService.encryptField("refresh_token", originalToken);
      const jsonString = JSON.stringify(encrypted);
      const decrypted = encryptionService.decryptField("refresh_token", jsonString);
      
      expect(decrypted).toBe(originalToken);
    });

    test("should handle plain text fallback for unencrypted data", () => {
      const plainToken = "plain_text_token";
      
      const result = encryptionService.decryptField("access_token", plainToken);
      
      expect(result).toBe(plainToken);
    });

    test("should throw error for invalid encrypted data", () => {
      const invalidEncryptedData: EncryptedData = {
        data: "invalid_data",
        iv: "invalid_iv",
        tag: "invalid_tag",
        keyId: "test-key",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      };
      
      expect(() => {
        encryptionService.decryptField("access_token", invalidEncryptedData);
      }).toThrow();
    });

    test("should handle decryption with missing key", () => {
      const originalToken = "token_with_missing_key";
      const encrypted = encryptionService.encryptField("access_token", originalToken);
      
      // Change the key ID to something that doesn't exist
      encrypted.keyId = "non-existent-key";
      
      expect(() => {
        encryptionService.decryptField("access_token", encrypted);
      }).toThrow("Decryption key for keyId 'non-existent-key' not found");
    });
  });

  describe("Encryption Validation", () => {
    test("should correctly identify encrypted data", () => {
      const token = "test_token_123";
      const encrypted = encryptionService.encryptField("access_token", token);
      
      expect(isEncrypted(encrypted)).toBe(true);
      expect(isEncrypted(token)).toBe(false);
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
      expect(isEncrypted({})).toBe(false);
    });

    test("should validate encrypted data structure", () => {
      const validEncrypted: EncryptedData = {
        data: "encrypted_data",
        iv: "initialization_vector",
        tag: "auth_tag",
        keyId: "key_id",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      };
      
      expect(isEncrypted(validEncrypted)).toBe(true);
      
      // Test missing required fields
      expect(isEncrypted({ ...validEncrypted, data: undefined })).toBe(false);
      expect(isEncrypted({ ...validEncrypted, iv: undefined })).toBe(false);
      expect(isEncrypted({ ...validEncrypted, tag: undefined })).toBe(false);
    });

    test("should handle optional keyId in validation", () => {
      const encryptedWithoutKeyId = {
        data: "encrypted_data",
        iv: "initialization_vector",
        tag: "auth_tag",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      };
      
      expect(isEncrypted(encryptedWithoutKeyId)).toBe(true);
    });
  });

  describe("Key Management", () => {
    test("should use correct key for encryption", () => {
      const token = "test_token_for_key_management";
      
      const encrypted = encryptionService.encryptField("access_token", token);
      
      expect(encrypted.keyId).toBe("test-key");
    });

    test("should handle multiple keys", () => {
      const token = "test_token_multiple_keys";
      const newKey = generateKey();
      
      // Add a second key
      encryptionService.setKey("key-2", newKey.toString("hex"));
      
      // Encrypt with first key
      const encrypted1 = encryptionService.encryptFieldWithKeyId("access_token", token, "test-key");
      expect(encrypted1.keyId).toBe("test-key");
      
      // Encrypt with second key
      const encrypted2 = encryptionService.encryptFieldWithKeyId("access_token", token, "key-2");
      expect(encrypted2.keyId).toBe("key-2");
      
      // Both should decrypt correctly
      const decrypted1 = encryptionService.decryptField("access_token", encrypted1);
      const decrypted2 = encryptionService.decryptField("access_token", encrypted2);
      
      expect(decrypted1).toBe(token);
      expect(decrypted2).toBe(token);
    });

    test("should throw error for missing encryption key", () => {
      expect(() => {
        encryptionService.encryptFieldWithKeyId("access_token", "token", "missing-key");
      }).toThrow("Encryption key for keyId 'missing-key' not found");
    });
  });

  describe("Crypto Module Direct Testing", () => {
    test("should encrypt and decrypt using crypto module directly", () => {
      const testData = "direct_crypto_test_data";
      const key = generateKey();
      
      const encrypted = encrypt(testData, key, "direct-test-key");
      const decrypted = decrypt(encrypted, key);
      
      expect(decrypted).toBe(testData);
      expect(encrypted.keyId).toBe("direct-test-key");
    });

    test("should throw encryption error for invalid inputs", () => {
      const invalidKey = Buffer.from("too_short_key", "utf8"); // Invalid key length
      
      expect(() => {
        encrypt("test_data", invalidKey);
      }).toThrow("Encryption failed");
    });

    test("should throw decryption error for tampered data", () => {
      const testData = "tampered_test_data";
      const key = generateKey();
      
      const encrypted = encrypt(testData, key);
      // Tamper with the encrypted data
      encrypted.data = "tampered_data";
      
      expect(() => {
        decrypt(encrypted, key);
      }).toThrow("Decryption failed");
    });

    test("should generate unique keys", () => {
      const key1 = generateKey();
      const key2 = generateKey();
      
      expect(key1).not.toEqual(key2);
      expect(key1.length).toBe(32); // 256 bits
      expect(key2.length).toBe(32); // 256 bits
    });
  });

  describe("Authentication Token Security", () => {
    test("should produce different ciphertext for same plaintext", () => {
      const token = "same_token_multiple_encryptions";
      
      const encrypted1 = encryptionService.encryptField("access_token", token);
      const encrypted2 = encryptionService.encryptField("access_token", token);
      
      // Same plaintext should produce different ciphertext due to random IV
      expect(encrypted1.data).not.toBe(encrypted2.data);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      
      // But both should decrypt to the same plaintext
      const decrypted1 = encryptionService.decryptField("access_token", encrypted1);
      const decrypted2 = encryptionService.decryptField("access_token", encrypted2);
      
      expect(decrypted1).toBe(token);
      expect(decrypted2).toBe(token);
    });

    test("should handle concurrent encryption operations", async () => {
      const tokens = Array.from({ length: 10 }, (_, i) => `concurrent_token_${i}`);
      
      const encryptionPromises = tokens.map(token => 
        Promise.resolve(encryptionService.encryptField("access_token", token))
      );
      
      const encryptedTokens = await Promise.all(encryptionPromises);
      
      // All encryptions should succeed
      expect(encryptedTokens).toHaveLength(10);
      encryptedTokens.forEach((encrypted, index) => {
        expect(encrypted).toHaveProperty("data");
        expect(encrypted).toHaveProperty("iv");
        expect(encrypted).toHaveProperty("tag");
        
        const decrypted = encryptionService.decryptField("access_token", encrypted);
        expect(decrypted).toBe(`concurrent_token_${index}`);
      });
    });

    test("should maintain encryption integrity over time", () => {
      const token = "time_integrity_test_token";
      
      const encrypted = encryptionService.encryptField("access_token", token);
      
      // Simulate time passing
      setTimeout(() => {
        const decrypted = encryptionService.decryptField("access_token", encrypted);
        expect(decrypted).toBe(token);
      }, 10);
    });
  });
});