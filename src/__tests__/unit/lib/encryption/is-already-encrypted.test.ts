import { describe, it, expect } from "vitest";

// Import the function to test - note: this is from the migration script
// We'll need to extract this to a shared utility if it's used elsewhere
async function isAlreadyEncrypted(value: string | null): Promise<boolean> {
  if (!value || value.trim() === "") return false;

  try {
    const parsed = JSON.parse(value);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.data === "string" &&
      typeof parsed.iv === "string" &&
      typeof parsed.tag === "string" &&
      typeof parsed.encryptedAt === "string"
    );
  } catch {
    return false;
  }
}

describe("isAlreadyEncrypted", () => {
  describe("valid encrypted objects", () => {
    it("should return true for properly formatted encrypted object", async () => {
      const encryptedValue = JSON.stringify({
        data: "encrypted-data-string",
        iv: "initialization-vector",
        tag: "authentication-tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(true);
    });

    it("should return true for encrypted object with additional properties", async () => {
      const encryptedValue = JSON.stringify({
        data: "encrypted-data-string",
        iv: "initialization-vector", 
        tag: "authentication-tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
        version: "1",
        keyId: "k-test",
        extraProperty: "should not affect validation",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(true);
    });

    it("should return true for encrypted object with minimal required fields", async () => {
      const encryptedValue = JSON.stringify({
        data: "",
        iv: "",
        tag: "",
        encryptedAt: "",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(true);
    });
  });

  describe("invalid/malformed inputs", () => {
    it("should return false for null value", async () => {
      const result = await isAlreadyEncrypted(null);
      expect(result).toBe(false);
    });

    it("should return false for empty string", async () => {
      const result = await isAlreadyEncrypted("");
      expect(result).toBe(false);
    });

    it("should return false for whitespace-only string", async () => {
      const result = await isAlreadyEncrypted("   ");
      expect(result).toBe(false);
    });

    it("should return false for invalid JSON", async () => {
      const result = await isAlreadyEncrypted("{invalid json}");
      expect(result).toBe(false);
    });

    it("should return false for non-JSON string", async () => {
      const result = await isAlreadyEncrypted("plain-text-value");
      expect(result).toBe(false);
    });

    it("should return false for JSON primitive values", async () => {
      expect(await isAlreadyEncrypted('"string"')).toBe(false);
      expect(await isAlreadyEncrypted("123")).toBe(false);
      expect(await isAlreadyEncrypted("true")).toBe(false);
      expect(await isAlreadyEncrypted("false")).toBe(false);
    });

    it("should return false for JSON array", async () => {
      const result = await isAlreadyEncrypted('["data", "iv", "tag"]');
      expect(result).toBe(false);
    });

    it("should return false for JSON null", async () => {
      const result = await isAlreadyEncrypted("null");
      expect(result).toBe(false);
    });
  });

  describe("missing required properties", () => {
    it("should return false when missing data property", async () => {
      const encryptedValue = JSON.stringify({
        iv: "initialization-vector",
        tag: "authentication-tag", 
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(false);
    });

    it("should return false when missing iv property", async () => {
      const encryptedValue = JSON.stringify({
        data: "encrypted-data-string",
        tag: "authentication-tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(false);
    });

    it("should return false when missing tag property", async () => {
      const encryptedValue = JSON.stringify({
        data: "encrypted-data-string",
        iv: "initialization-vector",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(false);
    });

    it("should return false when missing encryptedAt property", async () => {
      const encryptedValue = JSON.stringify({
        data: "encrypted-data-string",
        iv: "initialization-vector",
        tag: "authentication-tag",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(false);
    });

    it("should return false when missing multiple properties", async () => {
      const encryptedValue = JSON.stringify({
        data: "encrypted-data-string",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(false);
    });

    it("should return false for empty object", async () => {
      const result = await isAlreadyEncrypted("{}");
      expect(result).toBe(false);
    });
  });

  describe("wrong data types for properties", () => {
    it("should return false when data is not a string", async () => {
      const encryptedValue = JSON.stringify({
        data: 123,
        iv: "initialization-vector",
        tag: "authentication-tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(false);
    });

    it("should return false when iv is not a string", async () => {
      const encryptedValue = JSON.stringify({
        data: "encrypted-data-string",
        iv: true,
        tag: "authentication-tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(false);
    });

    it("should return false when tag is not a string", async () => {
      const encryptedValue = JSON.stringify({
        data: "encrypted-data-string", 
        iv: "initialization-vector",
        tag: null,
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(false);
    });

    it("should return false when encryptedAt is not a string", async () => {
      const encryptedValue = JSON.stringify({
        data: "encrypted-data-string",
        iv: "initialization-vector", 
        tag: "authentication-tag",
        encryptedAt: 123456789,
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(false);
    });

    it("should return false when multiple properties have wrong types", async () => {
      const encryptedValue = JSON.stringify({
        data: 123,
        iv: [],
        tag: {},
        encryptedAt: false,
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(false);
    });

    it("should return false when properties are undefined", async () => {
      const encryptedValue = JSON.stringify({
        data: undefined,
        iv: "initialization-vector",
        tag: "authentication-tag", 
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(encryptedValue);
      expect(result).toBe(false);
    });
  });

  describe("error handling and edge cases", () => {
    it("should handle malformed JSON gracefully", async () => {
      const malformedInputs = [
        '{"data": "value"',  // missing closing brace
        '{"data": "value"}extra',  // extra content after JSON
        '{"data": "value",}',  // trailing comma
        '{data: "value"}',  // unquoted key
        "{'data': 'value'}",  // single quotes
        '{"data": "value\\""}',  // escaped quote issue
      ];

      for (const input of malformedInputs) {
        const result = await isAlreadyEncrypted(input);
        expect(result).toBe(false);
      }
    });

    it("should not throw errors for any input", async () => {
      const problematicInputs = [
        null,
        "",
        "invalid",
        "{",
        "}",
        "[]",
        '{"test": }',
        '{"test": undefined}',
        '\n\t\r',
        '{"data": "\u0000"}',  // null character
        '{"data": "' + "x".repeat(10000) + '"}',  // very long string
      ];

      for (const input of problematicInputs) {
        await expect(isAlreadyEncrypted(input)).resolves.toBe(false);
      }
    });

    it("should handle deeply nested objects", async () => {
      const nestedValue = JSON.stringify({
        data: "encrypted-data-string",
        iv: "initialization-vector",
        tag: "authentication-tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
        nested: {
          level1: {
            level2: {
              deep: "value"
            }
          }
        }
      });

      const result = await isAlreadyEncrypted(nestedValue);
      expect(result).toBe(true);
    });

    it("should handle objects with circular reference serialization", async () => {
      // This tests the JSON.parse error handling
      const circularRef = '{"data": "test", "iv": "test", "tag": "test", "encryptedAt": "test", "circular":';
      const result = await isAlreadyEncrypted(circularRef);
      expect(result).toBe(false);
    });
  });

  describe("migration use case scenarios", () => {
    it("should correctly identify already encrypted account tokens", async () => {
      // Simulate encrypted access_token from migration
      const encryptedToken = JSON.stringify({
        data: "abc123encrypted",
        iv: "xyz456init", 
        tag: "def789auth",
        encryptedAt: "2024-01-01T10:00:00.000Z",
        keyId: "k-account",
      });

      const result = await isAlreadyEncrypted(encryptedToken);
      expect(result).toBe(true);
    });

    it("should correctly reject plain text tokens", async () => {
      const plainTextToken = "github_pat_11ABCDEFG";
      const result = await isAlreadyEncrypted(plainTextToken);
      expect(result).toBe(false);
    });

    it("should handle legacy encrypted formats gracefully", async () => {
      // Test with different structure that might exist in legacy data
      const legacyFormat = JSON.stringify({
        encrypted: "data",
        salt: "value", 
        version: "0.1"
      });

      const result = await isAlreadyEncrypted(legacyFormat);
      expect(result).toBe(false);
    });

    it("should handle environment variable encryption format", async () => {
      // Test format that might be used for environment variables
      const envVarFormat = JSON.stringify({
        data: "encrypted-env-value",
        iv: "env-iv",
        tag: "env-tag", 
        encryptedAt: "2024-01-01T12:00:00.000Z",
        fieldName: "API_KEY"
      });

      const result = await isAlreadyEncrypted(envVarFormat);
      expect(result).toBe(true);
    });
  });

  describe("performance and robustness", () => {
    it("should handle very large JSON objects efficiently", async () => {
      const largeData = "x".repeat(100000);
      const largeObject = JSON.stringify({
        data: largeData,
        iv: "initialization-vector",
        tag: "authentication-tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const start = Date.now();
      const result = await isAlreadyEncrypted(largeObject);
      const duration = Date.now() - start;

      expect(result).toBe(true);
      expect(duration).toBeLessThan(100); // Should complete quickly
    });

    it("should handle multiple concurrent calls", async () => {
      const validEncrypted = JSON.stringify({
        data: "test",
        iv: "test", 
        tag: "test",
        encryptedAt: "test"
      });

      const promises = Array(100).fill(null).map(() => 
        isAlreadyEncrypted(validEncrypted)
      );

      const results = await Promise.all(promises);
      expect(results).toEqual(Array(100).fill(true));
    });
  });
});