import { describe, it, expect, beforeEach } from "vitest";
import { EncryptionService, isEncrypted } from "@/lib/encryption";
import type { EncryptedData } from "@/types/encryption";

// Test helper classes
class EncryptionTestFactory {
  private static service: EncryptionService;

  static getService(): EncryptionService {
    if (!this.service) {
      this.service = EncryptionService.getInstance();
    }
    return this.service;
  }

  static createValidEncryptedData(value: string, keyId?: string): EncryptedData {
    const service = this.getService();
    if (keyId) {
      return service.encryptFieldWithKeyId("swarmApiKey", value, keyId);
    }
    return service.encryptField("swarmApiKey", value);
  }

  static createMalformedEncryptedData(overrides: Partial<EncryptedData>): EncryptedData {
    const base: EncryptedData = {
      data: "dGVzdA==",
      iv: "aXZ0ZXN0",
      tag: "dGFndGVzdA==",
      version: "1",
      encryptedAt: new Date().toISOString(),
    };
    return { ...base, ...overrides } as EncryptedData;
  }

  static createInvalidDataScenarios() {
    return [
      { name: "null value", input: null, shouldThrow: true },
      { name: "undefined value", input: undefined, shouldThrow: true },
      { name: "empty string", input: "", shouldReturn: "" },
      { name: "whitespace string", input: "   ", shouldReturn: "   " },
      { name: "plain text", input: "plain-text", shouldReturn: "plain-text" },
    ];
  }

  static createMalformedJSONScenarios() {
    return [
      { name: "invalid JSON", input: '{"data": "test", invalid}' },
      { name: "valid JSON but not encrypted", input: JSON.stringify({ foo: "bar" }) },
      { name: "partial encrypted structure", input: JSON.stringify({ data: "test", iv: "test" }) },
    ];
  }

  static createMissingFieldScenarios() {
    const factory = EncryptionTestFactory;
    return [
      { name: "data field is missing", malformed: factory.createMalformedEncryptedData({ data: undefined as any }) },
      { name: "iv field is missing", malformed: factory.createMalformedEncryptedData({ iv: undefined as any }) },
      { name: "tag field is missing", malformed: factory.createMalformedEncryptedData({ tag: undefined as any }) },
      {
        name: "version field is missing",
        malformed: factory.createMalformedEncryptedData({ version: undefined as any }),
      },
      {
        name: "encryptedAt field is missing",
        malformed: factory.createMalformedEncryptedData({ encryptedAt: undefined as any }),
      },
    ];
  }

  static createInvalidTypeScenarios() {
    const factory = EncryptionTestFactory;
    return [
      { name: "data field is not a string", malformed: factory.createMalformedEncryptedData({ data: 12345 as any }) },
      { name: "iv field is not a string", malformed: factory.createMalformedEncryptedData({ iv: true as any }) },
      { name: "tag field is not a string", malformed: factory.createMalformedEncryptedData({ tag: [] as any }) },
    ];
  }

  static createEmptyFieldScenarios() {
    const factory = EncryptionTestFactory;
    return [
      { name: "data field is empty string", malformed: factory.createMalformedEncryptedData({ data: "" }) },
      { name: "iv field is empty string", malformed: factory.createMalformedEncryptedData({ iv: "" }) },
      { name: "tag field is empty string", malformed: factory.createMalformedEncryptedData({ tag: "" }) },
    ];
  }
}

describe("EncryptionService", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY || "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    process.env.TOKEN_ENCRYPTION_KEY_ID = "k-test";
  });

  describe("basic encryption/decryption", () => {
    it("includes keyId in ciphertext and decrypts with registry", () => {
      const encSvc = EncryptionService.getInstance();
      const enc = encSvc.encryptField("swarmApiKey", "swarm-secret");
      expect(isEncrypted(enc)).toBe(true);
      expect(enc.keyId).toBe("k-test");

      const plain = encSvc.decryptField("swarmApiKey", enc);
      expect(plain).toBe("swarm-secret");
    });

    it("encrypts with explicit key id and decrypts", () => {
      const encSvc = EncryptionService.getInstance();
      encSvc.setKey("k-alt", process.env.TOKEN_ENCRYPTION_KEY!);
      const enc = encSvc.encryptFieldWithKeyId("poolApiKey", "pool-secret", "k-alt");
      expect(enc.keyId).toBe("k-alt");
      const plain = encSvc.decryptField("poolApiKey", enc);
      expect(plain).toBe("pool-secret");
    });

    it("throws if key id missing in registry", () => {
      const encSvc = EncryptionService.getInstance();
      const ciphertext = encSvc.encryptFieldWithKeyId("stakworkApiKey", "abc", "k-test");
      // simulate ciphertext with unknown key id
      const tampered = { ...ciphertext, keyId: "unknown" } as typeof ciphertext;
      expect(() => encSvc.decryptField("stakworkApiKey", tampered)).toThrowError(
        /Decryption key for keyId 'unknown' not found/,
      );
    });
  });

  describe("input validation - null/undefined/empty", () => {
    it("throws when decrypting null value", () => {
      const encSvc = EncryptionService.getInstance();
      expect(() => encSvc.decryptField("swarmApiKey", null as any)).toThrowError();
    });

    it("throws when decrypting undefined value", () => {
      const encSvc = EncryptionService.getInstance();
      expect(() => encSvc.decryptField("swarmApiKey", undefined as any)).toThrowError();
    });

    it("returns empty string when input is empty string", () => {
      const encSvc = EncryptionService.getInstance();
      const result = encSvc.decryptField("swarmApiKey", "");
      expect(result).toBe("");
    });

    it("returns whitespace string unchanged when not valid JSON", () => {
      const encSvc = EncryptionService.getInstance();
      const result = encSvc.decryptField("swarmApiKey", "   ");
      expect(result).toBe("   ");
    });

    it("returns plain text string when not encrypted JSON", () => {
      const encSvc = EncryptionService.getInstance();
      const plainText = "this-is-not-encrypted";
      const result = encSvc.decryptField("swarmApiKey", plainText);
      expect(result).toBe(plainText);
    });
  });

  describe("input validation - malformed JSON strings", () => {
    it("returns original string when JSON parsing fails", () => {
      const encSvc = EncryptionService.getInstance();
      const malformedJson = '{"data": "test", invalid}';
      const result = encSvc.decryptField("swarmApiKey", malformedJson);
      expect(result).toBe(malformedJson);
    });

    it("returns original string when JSON is valid but not encrypted format", () => {
      const encSvc = EncryptionService.getInstance();
      const validJsonNotEncrypted = JSON.stringify({ foo: "bar" });
      const result = encSvc.decryptField("swarmApiKey", validJsonNotEncrypted);
      expect(result).toBe(validJsonNotEncrypted);
    });

    it("returns original string when JSON contains partial encrypted structure", () => {
      const encSvc = EncryptionService.getInstance();
      const partialEncrypted = JSON.stringify({ data: "test", iv: "test" });
      const result = encSvc.decryptField("swarmApiKey", partialEncrypted);
      expect(result).toBe(partialEncrypted);
    });
  });

  describe("invalid EncryptedData format - missing required fields", () => {
    const missingFieldScenarios = EncryptionTestFactory.createMissingFieldScenarios();

    test.each(missingFieldScenarios)("throws when $name", ({ malformed }) => {
      const encSvc = EncryptionTestFactory.getService();
      expect(() => encSvc.decryptField("swarmApiKey", malformed)).toThrowError(/Invalid encrypted data format/);
    });
  });

  describe("invalid EncryptedData format - invalid field types", () => {
    const invalidTypeScenarios = EncryptionTestFactory.createInvalidTypeScenarios();

    test.each(invalidTypeScenarios)("throws when $name", ({ malformed }) => {
      const encSvc = EncryptionTestFactory.getService();
      expect(() => encSvc.decryptField("swarmApiKey", malformed)).toThrowError();
    });
  });

  describe("invalid EncryptedData format - empty field values", () => {
    const emptyFieldScenarios = EncryptionTestFactory.createEmptyFieldScenarios();

    test.each(emptyFieldScenarios)("throws when $name", ({ malformed }) => {
      const encSvc = EncryptionTestFactory.getService();
      expect(() => encSvc.decryptField("swarmApiKey", malformed)).toThrowError();
    });
  });

  describe("security - tampered data detection", () => {
    it("throws when authentication tag is tampered", () => {
      const encSvc = EncryptionTestFactory.getService();
      const encrypted = EncryptionTestFactory.createValidEncryptedData("secret-data");
      const tampered = {
        ...encrypted,
        tag: encrypted.tag.slice(0, -4) + "AAAA",
      };
      expect(() => encSvc.decryptField("swarmApiKey", tampered)).toThrowError();
    });

    it("throws when ciphertext data is modified", () => {
      const encSvc = EncryptionTestFactory.getService();
      const encrypted = EncryptionTestFactory.createValidEncryptedData("secret-data");
      const tampered = {
        ...encrypted,
        data: encrypted.data.slice(0, -4) + "BBBB",
      };
      expect(() => encSvc.decryptField("swarmApiKey", tampered)).toThrowError();
    });

    it("throws when initialization vector is modified", () => {
      const encSvc = EncryptionTestFactory.getService();
      const encrypted = EncryptionTestFactory.createValidEncryptedData("secret-data");
      const tampered = {
        ...encrypted,
        iv: encrypted.iv.slice(0, -4) + "CCCC",
      };
      expect(() => encSvc.decryptField("swarmApiKey", tampered)).toThrowError();
    });
  });

  describe("key management - keyId fallback logic", () => {
    it("uses encrypted data keyId when present", () => {
      const encSvc = EncryptionTestFactory.getService();
      encSvc.setKey("k-explicit", process.env.TOKEN_ENCRYPTION_KEY!);
      const encrypted = EncryptionTestFactory.createValidEncryptedData("test", "k-explicit");
      expect(encrypted.keyId).toBe("k-explicit");

      const decrypted = encSvc.decryptField("swarmApiKey", encrypted);
      expect(decrypted).toBe("test");
    });

    it("falls back to activeKeyId when encrypted data has no keyId", () => {
      const encSvc = EncryptionTestFactory.getService();
      encSvc.setActiveKeyId("k-test");
      const encrypted = EncryptionTestFactory.createValidEncryptedData("test");
      const withoutKeyId = { ...encrypted, keyId: undefined };

      const decrypted = encSvc.decryptField("swarmApiKey", withoutKeyId);
      expect(decrypted).toBe("test");
    });

    it("falls back to default keyId when neither encrypted nor active keyId present", () => {
      const encSvc = EncryptionTestFactory.getService();
      encSvc.setKey("default", process.env.TOKEN_ENCRYPTION_KEY!);
      encSvc.setActiveKeyId("default");
      const encrypted = EncryptionTestFactory.createValidEncryptedData("test", "default");
      const withoutKeyId = { ...encrypted, keyId: undefined };

      const decrypted = encSvc.decryptField("swarmApiKey", withoutKeyId);
      expect(decrypted).toBe("test");
    });
  });

  describe("key management - key rotation scenarios", () => {
    it("decrypts data encrypted with old key after key rotation", () => {
      const encSvc = EncryptionService.getInstance();
      const oldKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const newKey = process.env.TOKEN_ENCRYPTION_KEY!;

      encSvc.setKey("k-old", oldKey);
      encSvc.setActiveKeyId("k-old");
      const encryptedWithOld = encSvc.encryptField("swarmApiKey", "old-secret");

      encSvc.setKey("k-new", newKey);
      encSvc.setActiveKeyId("k-new");

      const decrypted = encSvc.decryptField("swarmApiKey", encryptedWithOld);
      expect(decrypted).toBe("old-secret");
    });

    it("handles multiple keys in registry simultaneously", () => {
      const encSvc = EncryptionService.getInstance();
      const key1 = "1111111111111111111111111111111111111111111111111111111111111111";
      const key2 = "2222222222222222222222222222222222222222222222222222222222222222";

      encSvc.setKey("k-1", key1);
      encSvc.setKey("k-2", key2);

      const enc1 = encSvc.encryptFieldWithKeyId("swarmApiKey", "data1", "k-1");
      const enc2 = encSvc.encryptFieldWithKeyId("poolApiKey", "data2", "k-2");

      expect(encSvc.decryptField("swarmApiKey", enc1)).toBe("data1");
      expect(encSvc.decryptField("poolApiKey", enc2)).toBe("data2");
    });
  });

  describe("key management - wrong key scenarios", () => {
    it("throws when decrypting with wrong key", () => {
      const encSvc = EncryptionTestFactory.getService();
      const correctKey = process.env.TOKEN_ENCRYPTION_KEY!;
      const wrongKey = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

      encSvc.setKey("k-correct", correctKey);
      encSvc.setActiveKeyId("k-correct");
      const encrypted = encSvc.encryptField("swarmApiKey", "secret");

      encSvc.setKey("k-correct", wrongKey);

      expect(() => encSvc.decryptField("swarmApiKey", encrypted)).toThrowError();
    });

    it("throws descriptive error when keyId not found in registry", () => {
      const encSvc = EncryptionTestFactory.getService();
      const encrypted = EncryptionTestFactory.createValidEncryptedData("test");
      const withMissingKey = { ...encrypted, keyId: "k-nonexistent" };

      expect(() => encSvc.decryptField("swarmApiKey", withMissingKey)).toThrowError(
        /Decryption key for keyId 'k-nonexistent' not found/,
      );
    });
  });

  describe("edge cases - data variations", () => {
    it("decrypts unicode characters correctly", () => {
      const encSvc = EncryptionTestFactory.getService();
      const unicodeData = "Hello 世界 🌍 émojis ✨";
      const encrypted = EncryptionTestFactory.createValidEncryptedData(unicodeData);
      const decrypted = encSvc.decryptField("swarmApiKey", encrypted);
      expect(decrypted).toBe(unicodeData);
    });

    it("decrypts long data strings correctly", () => {
      const encSvc = EncryptionTestFactory.getService();
      const longData = "x".repeat(10000);
      const encrypted = EncryptionTestFactory.createValidEncryptedData(longData);
      const decrypted = encSvc.decryptField("swarmApiKey", encrypted);
      expect(decrypted).toBe(longData);
    });

    it("handles special characters in encrypted data", () => {
      const encSvc = EncryptionTestFactory.getService();
      const specialChars = "!@#$%^&*()_+-=[]{}|;':\",./<>?\\`~";
      const encrypted = EncryptionTestFactory.createValidEncryptedData(specialChars);
      const decrypted = encSvc.decryptField("swarmApiKey", encrypted);
      expect(decrypted).toBe(specialChars);
    });

    it("decrypts empty string successfully", () => {
      const encSvc = EncryptionTestFactory.getService();
      const encrypted = EncryptionTestFactory.createValidEncryptedData("");
      const decrypted = encSvc.decryptField("swarmApiKey", encrypted);
      expect(decrypted).toBe("");
    });
  });

  describe("edge cases - string JSON input parsing", () => {
    it("decrypts valid JSON string representation of encrypted data", () => {
      const encSvc = EncryptionTestFactory.getService();
      const encrypted = EncryptionTestFactory.createValidEncryptedData("test-value");
      const jsonString = JSON.stringify(encrypted);

      const decrypted = encSvc.decryptField("swarmApiKey", jsonString);
      expect(decrypted).toBe("test-value");
    });

    it("handles JSON string with extra whitespace", () => {
      const encSvc = EncryptionTestFactory.getService();
      const encrypted = EncryptionTestFactory.createValidEncryptedData("test");
      const jsonWithWhitespace = JSON.stringify(encrypted, null, 2);

      const decrypted = encSvc.decryptField("swarmApiKey", jsonWithWhitespace);
      expect(decrypted).toBe("test");
    });
  });
});
