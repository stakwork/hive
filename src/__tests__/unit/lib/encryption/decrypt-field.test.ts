import { describe, it, expect, beforeEach } from "vitest";
import {
  EncryptionService,
  FieldEncryptionService,
  encrypt,
  decrypt,
  isEncrypted,
  hexToBuffer,
  bufferToHex,
  generateKey,
} from "@/lib/encryption";
import type { EncryptedData, EncryptableField } from "@/types/encryption";

// Test helper functions
function createTestKey(): string {
  return bufferToHex(generateKey());
}

function createEncryptedTestData(
  plaintext: string,
  key: string,
  keyId?: string
): EncryptedData {
  const keyBuffer = hexToBuffer(key);
  return encrypt(plaintext, keyBuffer, keyId);
}

function tamperWithAuthTag(encrypted: EncryptedData): EncryptedData {
  return {
    ...encrypted,
    tag: Buffer.from("tampered_tag_data").toString("base64"),
  };
}

function createMalformedJSON(): string {
  return '{"data":"test","iv":"invalid"'; // Missing closing brace and fields
}

describe("FieldEncryptionService.decryptField", () => {
  let service: FieldEncryptionService;
  let testKey: string;
  const testField: EncryptableField = "access_token";

  beforeEach(() => {
    testKey = createTestKey();
    service = new FieldEncryptionService(testKey);
  });

  describe("Valid decryption scenarios", () => {
    it("should decrypt valid EncryptedData object", () => {
      const plaintext = "my-secret-token-123";
      const encrypted = createEncryptedTestData(plaintext, testKey);

      const result = service.decryptField(testField, encrypted);

      expect(result).toBe(plaintext);
    });

    it("should decrypt encrypted data passed as JSON string", () => {
      const plaintext = "another-secret-value";
      const encrypted = createEncryptedTestData(plaintext, testKey);
      const jsonString = JSON.stringify(encrypted);

      const result = service.decryptField(testField, jsonString);

      expect(result).toBe(plaintext);
    });

    it("should handle Unicode characters in decrypted data", () => {
      const plaintext = "🔐 Secret émoji tëxt 日本語";
      const encrypted = createEncryptedTestData(plaintext, testKey);

      const result = service.decryptField(testField, encrypted);

      expect(result).toBe(plaintext);
    });

    it("should decrypt long strings (1000+ characters)", () => {
      const plaintext = "x".repeat(1500);
      const encrypted = createEncryptedTestData(plaintext, testKey);

      const result = service.decryptField(testField, encrypted);

      expect(result).toBe(plaintext);
      expect(result.length).toBe(1500);
    });

    it("should return plain string if not encrypted format", () => {
      const plainString = "not-an-encrypted-value";

      const result = service.decryptField(testField, plainString);

      expect(result).toBe(plainString);
    });

    it("should return plain string if JSON parsing fails", () => {
      const invalidJson = "not-valid-json-{";

      const result = service.decryptField(testField, invalidJson);

      expect(result).toBe(invalidJson);
    });
  });

  describe("Error handling", () => {
    it("should throw EncryptionError for tampered authentication tag", () => {
      const plaintext = "secret-data";
      const encrypted = createEncryptedTestData(plaintext, testKey);
      const tampered = tamperWithAuthTag(encrypted);

      expect(() => {
        service.decryptField(testField, tampered);
      }).toThrow(/Failed to decrypt field: access_token/);
    });

    it("should throw EncryptionError with DECRYPTION_FAILED code for invalid data", () => {
      const plaintext = "test-data";
      const encrypted = createEncryptedTestData(plaintext, testKey);
      const tampered = tamperWithAuthTag(encrypted);

      try {
        service.decryptField(testField, tampered);
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.code).toBe("DECRYPTION_FAILED");
        expect(error.field).toBe(testField);
        expect(error.message).toContain("Failed to decrypt field");
      }
    });

    it("should throw error for wrong decryption key", () => {
      const plaintext = "secret";
      const encrypted = createEncryptedTestData(plaintext, testKey);
      
      const wrongKey = createTestKey();
      const wrongService = new FieldEncryptionService(wrongKey);

      expect(() => {
        wrongService.decryptField(testField, encrypted);
      }).toThrow();
    });

    it("should throw error for invalid encrypted data format", () => {
      const invalidData = {
        data: "test",
        iv: "invalid",
        // Missing required fields
      };

      expect(() => {
        service.decryptField(testField, invalidData as EncryptedData);
      }).toThrow(/Failed to decrypt field: access_token/);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty string plaintext", () => {
      const plaintext = "";
      const encrypted = createEncryptedTestData(plaintext, testKey);

      const result = service.decryptField(testField, encrypted);

      expect(result).toBe("");
    });

    it("should handle whitespace-only plaintext", () => {
      const plaintext = "   ";
      const encrypted = createEncryptedTestData(plaintext, testKey);

      const result = service.decryptField(testField, encrypted);

      expect(result).toBe(plaintext);
    });

    it("should return plain string for malformed JSON", () => {
      const malformedJson = createMalformedJSON();

      const result = service.decryptField(testField, malformedJson);

      expect(result).toBe(malformedJson);
    });

    it("should handle JSON string with non-encrypted object", () => {
      const plainObject = { key: "value", nested: { data: "test" } };
      const jsonString = JSON.stringify(plainObject);

      const result = service.decryptField(testField, jsonString);

      expect(result).toBe(jsonString);
    });

    it("should handle special characters in plaintext", () => {
      const plaintext = 'Special: !@#$%^&*()_+-=[]{}|;:"<>?,./`~';
      const encrypted = createEncryptedTestData(plaintext, testKey);

      const result = service.decryptField(testField, encrypted);

      expect(result).toBe(plaintext);
    });

    it("should handle newlines and tabs in plaintext", () => {
      const plaintext = "Line 1\nLine 2\tTabbed\r\nWindows Line";
      const encrypted = createEncryptedTestData(plaintext, testKey);

      const result = service.decryptField(testField, encrypted);

      expect(result).toBe(plaintext);
    });
  });
});

describe("EncryptionService.decryptField", () => {
  let encryptionService: EncryptionService;
  let testKey: string;
  let testKeyId: string;
  const testField: EncryptableField = "environmentVariables";

  beforeEach(() => {
    encryptionService = EncryptionService.getInstance();
    testKey = createTestKey();
    testKeyId = "test-key-v1";
    
    // Set up key registry
    encryptionService.setKey(testKeyId, testKey);
    encryptionService.setActiveKeyId(testKeyId);
  });

  describe("Valid decryption scenarios", () => {
    it("should decrypt data with explicit keyId", () => {
      const plaintext = "environment-secret-value";
      const encrypted = encryptionService.encryptFieldWithKeyId(
        testField,
        plaintext,
        testKeyId
      );

      const result = encryptionService.decryptField(testField, encrypted);

      expect(result).toBe(plaintext);
      expect(encrypted.keyId).toBe(testKeyId);
    });

    it("should decrypt data using activeKeyId when keyId not specified", () => {
      const plaintext = "active-key-data";
      const encrypted = encryptionService.encryptField(testField, plaintext);

      const result = encryptionService.decryptField(testField, encrypted);

      expect(result).toBe(plaintext);
    });

    it("should decrypt JSON string with valid encrypted data", () => {
      const plaintext = "json-string-test";
      const encrypted = encryptionService.encryptField(testField, plaintext);
      const jsonString = JSON.stringify(encrypted);

      const result = encryptionService.decryptField(testField, jsonString);

      expect(result).toBe(plaintext);
    });

    it("should handle key rotation with multiple keys in registry", () => {
      const oldKeyId = "old-key";
      const oldKey = createTestKey();
      const newKeyId = "new-key";
      const newKey = createTestKey();

      encryptionService.setKey(oldKeyId, oldKey);
      encryptionService.setKey(newKeyId, newKey);
      encryptionService.setActiveKeyId(newKeyId);

      // Encrypt with old key
      const plaintext = "rotated-key-data";
      const encryptedWithOldKey = encryptionService.encryptFieldWithKeyId(
        testField,
        plaintext,
        oldKeyId
      );

      // Should decrypt using keyId from encrypted data
      const result = encryptionService.decryptField(
        testField,
        encryptedWithOldKey
      );

      expect(result).toBe(plaintext);
    });

    it("should return plain string for non-encrypted data", () => {
      const plainString = "not-encrypted-value";

      const result = encryptionService.decryptField(testField, plainString);

      expect(result).toBe(plainString);
    });
  });

  describe("Error handling", () => {
    it("should throw error when keyId not found in registry", () => {
      const plaintext = "test-data";
      const nonExistentKeyId = "non-existent-key";
      const encrypted = createEncryptedTestData(plaintext, testKey, nonExistentKeyId);

      expect(() => {
        encryptionService.decryptField(testField, encrypted);
      }).toThrow(/Decryption key for keyId 'non-existent-key' not found/);
    });

    it("should throw error for tampered encrypted data", () => {
      const plaintext = "sensitive-data";
      const encrypted = encryptionService.encryptField(testField, plaintext);
      const tampered = tamperWithAuthTag(encrypted);

      expect(() => {
        encryptionService.decryptField(testField, tampered);
      }).toThrow();
    });

    it("should throw error for invalid encrypted data format", () => {
      const invalidData = {
        someField: "value",
        notEncrypted: true,
      };

      expect(() => {
        encryptionService.decryptField(testField, invalidData as any);
      }).toThrow(/Invalid encrypted data format/);
    });

    it("should use activeKeyId fallback when keyId missing from encrypted data", () => {
      const plaintext = "fallback-test";
      const encrypted = createEncryptedTestData(plaintext, testKey);
      // Remove keyId to test fallback
      delete encrypted.keyId;

      const result = encryptionService.decryptField(testField, encrypted);

      expect(result).toBe(plaintext);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty encrypted string", () => {
      const emptyString = "";

      const result = encryptionService.decryptField(testField, emptyString);

      expect(result).toBe(emptyString);
    });

    it("should handle whitespace-only encrypted string", () => {
      const whitespace = "   ";

      const result = encryptionService.decryptField(testField, whitespace);

      expect(result).toBe(whitespace);
    });

    it("should handle malformed JSON gracefully", () => {
      const malformedJson = createMalformedJSON();

      const result = encryptionService.decryptField(testField, malformedJson);

      expect(result).toBe(malformedJson);
    });

    it("should handle JSON string without encrypted structure", () => {
      const plainJson = JSON.stringify({ key: "value" });

      const result = encryptionService.decryptField(testField, plainJson);

      expect(result).toBe(plainJson);
    });

    it("should decrypt with default keyId when not specified", () => {
      const plaintext = "default-key-test";
      
      // Create encrypted data without keyId
      const keyBuffer = hexToBuffer(testKey);
      const encrypted = encrypt(plaintext, keyBuffer);

      const result = encryptionService.decryptField(testField, encrypted);

      expect(result).toBe(plaintext);
    });

    it("should handle very long keyId strings", () => {
      const longKeyId = "very-long-key-id-" + "x".repeat(500);
      const longKey = createTestKey();
      encryptionService.setKey(longKeyId, longKey);

      const plaintext = "long-keyid-test";
      const encrypted = encryptionService.encryptFieldWithKeyId(
        testField,
        plaintext,
        longKeyId
      );

      const result = encryptionService.decryptField(testField, encrypted);

      expect(result).toBe(plaintext);
    });
  });

  describe("Key rotation scenarios", () => {
    it("should handle multiple key versions in registry", () => {
      const keys = [
        { id: "v1", key: createTestKey() },
        { id: "v2", key: createTestKey() },
        { id: "v3", key: createTestKey() },
      ];

      keys.forEach(({ id, key }) => {
        encryptionService.setKey(id, key);
      });

      // Encrypt data with each key version
      const testData = keys.map(({ id }) => {
        const plaintext = `data-encrypted-with-${id}`;
        const encrypted = encryptionService.encryptFieldWithKeyId(
          testField,
          plaintext,
          id
        );
        return { plaintext, encrypted, keyId: id };
      });

      // Verify all can be decrypted regardless of active key
      encryptionService.setActiveKeyId("v3");
      testData.forEach(({ plaintext, encrypted, keyId }) => {
        const result = encryptionService.decryptField(testField, encrypted);
        expect(result).toBe(plaintext);
        expect(encrypted.keyId).toBe(keyId);
      });
    });

    it("should throw error when attempting to decrypt with missing keyId", () => {
      const nonExistentKeyId = "non-existent-key";
      const plaintext = "data-with-nonexistent-key";
      const encrypted = createEncryptedTestData(plaintext, testKey, nonExistentKeyId);

      expect(() => {
        encryptionService.decryptField(testField, encrypted);
      }).toThrow(/Decryption key for keyId 'non-existent-key' not found/);
    });
  });
});

describe("Integration: Round-trip encryption/decryption", () => {
  it("should successfully round-trip with FieldEncryptionService", () => {
    const key = createTestKey();
    const service = new FieldEncryptionService(key);
    const field: EncryptableField = "refresh_token";
    const plaintext = "original-refresh-token-value";

    const encrypted = service.encryptField(field, plaintext);
    expect(isEncrypted(encrypted)).toBe(true);

    const decrypted = service.decryptField(field, encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should successfully round-trip with EncryptionService", () => {
    const encService = EncryptionService.getInstance();
    const keyId = "round-trip-key";
    const key = createTestKey();
    
    encService.setKey(keyId, key);
    encService.setActiveKeyId(keyId);

    const field: EncryptableField = "poolApiKey";
    const plaintext = "pool-manager-api-key-12345";

    const encrypted = encService.encryptField(field, plaintext);
    expect(encrypted.keyId).toBe(keyId);
    expect(isEncrypted(encrypted)).toBe(true);

    const decrypted = encService.decryptField(field, encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should handle multiple round-trips without data corruption", () => {
    const key = createTestKey();
    const service = new FieldEncryptionService(key);
    const field: EncryptableField = "access_token";
    let plaintext = "initial-token-value";

    // Perform 10 encrypt/decrypt cycles
    for (let i = 0; i < 10; i++) {
      const encrypted = service.encryptField(field, plaintext);
      const decrypted = service.decryptField(field, encrypted);
      expect(decrypted).toBe(plaintext);
      plaintext = decrypted + `-cycle-${i}`;
    }
  });
});