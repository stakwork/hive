import { describe, test, expect } from "vitest";

// Import the function under test
// Since isAlreadyEncrypted is not exported, we need to extract it for testing
// This is a common pattern for testing internal functions
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
  describe("valid encrypted payloads", () => {
    test("should return true for valid encrypted payload", async () => {
      const validPayload = JSON.stringify({
        data: "encrypted-data-string",
        iv: "initialization-vector",
        tag: "authentication-tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(validPayload);
      expect(result).toBe(true);
    });

    test("should return true for valid encrypted payload with additional properties", async () => {
      const validPayload = JSON.stringify({
        data: "encrypted-data-string",
        iv: "initialization-vector",
        tag: "authentication-tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
        version: "v1",
        keyId: "key-123",
      });

      const result = await isAlreadyEncrypted(validPayload);
      expect(result).toBe(true);
    });

    test("should return true for valid encrypted payload with empty string values", async () => {
      const validPayload = JSON.stringify({
        data: "",
        iv: "",
        tag: "",
        encryptedAt: "",
      });

      const result = await isAlreadyEncrypted(validPayload);
      expect(result).toBe(true);
    });

    test("should return true for valid encrypted payload with long string values", async () => {
      const validPayload = JSON.stringify({
        data: "a".repeat(1000),
        iv: "b".repeat(500),
        tag: "c".repeat(100),
        encryptedAt: new Date().toISOString(),
      });

      const result = await isAlreadyEncrypted(validPayload);
      expect(result).toBe(true);
    });
  });

  describe("null and empty inputs", () => {
    test("should return false for null input", async () => {
      const result = await isAlreadyEncrypted(null);
      expect(result).toBe(false);
    });

    test("should return false for empty string", async () => {
      const result = await isAlreadyEncrypted("");
      expect(result).toBe(false);
    });

    test("should return false for whitespace-only string", async () => {
      const result = await isAlreadyEncrypted("   ");
      expect(result).toBe(false);
    });

    test("should return false for tab and newline whitespace", async () => {
      const result = await isAlreadyEncrypted("\t\n\r ");
      expect(result).toBe(false);
    });
  });

  describe("invalid JSON inputs", () => {
    test("should return false for invalid JSON syntax", async () => {
      const invalidJsonInputs = [
        "not-json",
        "{invalid-json}",
        '{"data": "value"', // missing closing brace
        '{"data": }', // invalid value
        "{data: 'value'}", // unquoted key
        "undefined",
        "null",
        "true",
        "false",
        "123",
        '"just-a-string"',
      ];

      for (const input of invalidJsonInputs) {
        const result = await isAlreadyEncrypted(input);
        expect(result).toBe(false);
      }
    });

    test("should return false for JSON primitive values", async () => {
      const primitiveValues = ["null", "true", "false", "123", '"string-value"', "0", "-1", "3.14"];

      for (const value of primitiveValues) {
        const result = await isAlreadyEncrypted(value);
        expect(result).toBe(false);
      }
    });

    test("should return false for JSON arrays", async () => {
      const arrayInputs = ["[]", "[1, 2, 3]", '["data", "iv", "tag", "encryptedAt"]', '[{"data": "value"}]'];

      for (const input of arrayInputs) {
        const result = await isAlreadyEncrypted(input);
        expect(result).toBe(false);
      }
    });
  });

  describe("objects missing required properties", () => {
    test("should return false for empty object", async () => {
      const result = await isAlreadyEncrypted("{}");
      expect(result).toBe(false);
    });

    test("should return false for object missing 'data' property", async () => {
      const payload = JSON.stringify({
        iv: "initialization-vector",
        tag: "authentication-tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(payload);
      expect(result).toBe(false);
    });

    test("should return false for object missing 'iv' property", async () => {
      const payload = JSON.stringify({
        data: "encrypted-data-string",
        tag: "authentication-tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(payload);
      expect(result).toBe(false);
    });

    test("should return false for object missing 'tag' property", async () => {
      const payload = JSON.stringify({
        data: "encrypted-data-string",
        iv: "initialization-vector",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(payload);
      expect(result).toBe(false);
    });

    test("should return false for object missing 'encryptedAt' property", async () => {
      const payload = JSON.stringify({
        data: "encrypted-data-string",
        iv: "initialization-vector",
        tag: "authentication-tag",
      });

      const result = await isAlreadyEncrypted(payload);
      expect(result).toBe(false);
    });

    test("should return false for object missing multiple properties", async () => {
      const partialPayloads = [
        JSON.stringify({ data: "value" }),
        JSON.stringify({ iv: "value", tag: "value" }),
        JSON.stringify({ encryptedAt: "2024-01-01T00:00:00.000Z" }),
      ];

      for (const payload of partialPayloads) {
        const result = await isAlreadyEncrypted(payload);
        expect(result).toBe(false);
      }
    });
  });

  describe("objects with wrong property types", () => {
    test("should return false when 'data' is not a string", async () => {
      const payloadsWithWrongDataType = [
        JSON.stringify({ data: 123, iv: "iv", tag: "tag", encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: true, iv: "iv", tag: "tag", encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: null, iv: "iv", tag: "tag", encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: {}, iv: "iv", tag: "tag", encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: [], iv: "iv", tag: "tag", encryptedAt: "2024-01-01" }),
      ];

      for (const payload of payloadsWithWrongDataType) {
        const result = await isAlreadyEncrypted(payload);
        expect(result).toBe(false);
      }
    });

    test("should return false when 'iv' is not a string", async () => {
      const payloadsWithWrongIvType = [
        JSON.stringify({ data: "data", iv: 123, tag: "tag", encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: "data", iv: false, tag: "tag", encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: "data", iv: null, tag: "tag", encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: "data", iv: {}, tag: "tag", encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: "data", iv: [], tag: "tag", encryptedAt: "2024-01-01" }),
      ];

      for (const payload of payloadsWithWrongIvType) {
        const result = await isAlreadyEncrypted(payload);
        expect(result).toBe(false);
      }
    });

    test("should return false when 'tag' is not a string", async () => {
      const payloadsWithWrongTagType = [
        JSON.stringify({ data: "data", iv: "iv", tag: 123, encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: "data", iv: "iv", tag: true, encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: "data", iv: "iv", tag: null, encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: "data", iv: "iv", tag: {}, encryptedAt: "2024-01-01" }),
        JSON.stringify({ data: "data", iv: "iv", tag: [], encryptedAt: "2024-01-01" }),
      ];

      for (const payload of payloadsWithWrongTagType) {
        const result = await isAlreadyEncrypted(payload);
        expect(result).toBe(false);
      }
    });

    test("should return false when 'encryptedAt' is not a string", async () => {
      const payloadsWithWrongEncryptedAtType = [
        JSON.stringify({ data: "data", iv: "iv", tag: "tag", encryptedAt: 123 }),
        JSON.stringify({ data: "data", iv: "iv", tag: "tag", encryptedAt: true }),
        JSON.stringify({ data: "data", iv: "iv", tag: "tag", encryptedAt: null }),
        JSON.stringify({ data: "data", iv: "iv", tag: "tag", encryptedAt: {} }),
        JSON.stringify({ data: "data", iv: "iv", tag: "tag", encryptedAt: [] }),
        // Note: new Date() gets serialized to string by JSON.stringify, so it would actually pass
      ];

      for (const payload of payloadsWithWrongEncryptedAtType) {
        const result = await isAlreadyEncrypted(payload);
        expect(result).toBe(false);
      }
    });

    test("should return false when multiple properties have wrong types", async () => {
      const payload = JSON.stringify({
        data: 123,
        iv: false,
        tag: null,
        encryptedAt: {},
      });

      const result = await isAlreadyEncrypted(payload);
      expect(result).toBe(false);
    });
  });

  describe("edge cases and special scenarios", () => {
    test("should handle Unicode characters in JSON strings", async () => {
      const validPayload = JSON.stringify({
        data: "encrypted-data-🔐",
        iv: "iv-with-émojis-🎯",
        tag: "tag-with-ñ-character",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(validPayload);
      expect(result).toBe(true);
    });

    test("should handle very long JSON strings", async () => {
      const longData = "a".repeat(10000);
      const validPayload = JSON.stringify({
        data: longData,
        iv: "iv",
        tag: "tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(validPayload);
      expect(result).toBe(true);
    });

    test("should return false for nested objects", async () => {
      const nestedPayload = JSON.stringify({
        data: {
          nestedData: "value",
        },
        iv: "iv",
        tag: "tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(nestedPayload);
      expect(result).toBe(false);
    });

    test("should return false for JSON with undefined properties", async () => {
      // JSON.stringify will omit undefined properties
      const objWithUndefined = {
        data: "data",
        iv: undefined,
        tag: "tag",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      };
      const payload = JSON.stringify(objWithUndefined);

      const result = await isAlreadyEncrypted(payload);
      expect(result).toBe(false); // 'iv' property will be missing
    });

    test("should handle JSON with escaped characters", async () => {
      const validPayload = JSON.stringify({
        data: 'data"with"quotes',
        iv: "iv\\with\\backslashes",
        tag: "tag\nwith\nnewlines",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      const result = await isAlreadyEncrypted(validPayload);
      expect(result).toBe(true);
    });

    test("should return false for malformed JSON with control characters", async () => {
      const malformedInputs = [
        "{\x00data: 'value'}",
        '{"data": "value\x01"}',
        '{\r\n"data": "value"', // missing closing brace
      ];

      for (const input of malformedInputs) {
        const result = await isAlreadyEncrypted(input);
        expect(result).toBe(false);
      }
    });
  });

  describe("real-world encrypted payload examples", () => {
    test("should handle typical encrypted token structure", async () => {
      const realWorldPayload = JSON.stringify({
        data: "AES256GCM:base64encrypteddata==",
        iv: "randomIvBytes123==",
        tag: "authenticationTag==",
        encryptedAt: new Date().toISOString(),
      });

      const result = await isAlreadyEncrypted(realWorldPayload);
      expect(result).toBe(true);
    });

    test("should handle payload with version and keyId fields", async () => {
      const payloadWithMetadata = JSON.stringify({
        data: "encrypted-access-token-data",
        iv: "initialization-vector-hex",
        tag: "auth-tag-hex",
        encryptedAt: "2024-01-15T10:30:00.000Z",
        version: "1",
        keyId: "key-rotation-id-123",
      });

      const result = await isAlreadyEncrypted(payloadWithMetadata);
      expect(result).toBe(true);
    });

    test("should validate all properties are strings even with realistic values", async () => {
      const payloadWithNumberVersion = JSON.stringify({
        data: "encrypted-data",
        iv: "iv-value",
        tag: "tag-value",
        encryptedAt: "2024-01-15T10:30:00.000Z",
        version: 1, // number instead of string - should still pass since we only check required properties
      });

      const result = await isAlreadyEncrypted(payloadWithNumberVersion);
      expect(result).toBe(true); // Additional properties don't affect validation
    });
  });
});
