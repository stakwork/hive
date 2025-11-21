import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the encryption service first - before importing anything else
const mockEncryptField = vi.fn();

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: mockEncryptField,
    })),
  },
  EncryptableField: {},
  EncryptedData: {},
}));

// Now import the types after mocking
import type { EncryptableField, EncryptedData } from "@/types/encryption";
import { EncryptionService } from "@/lib/encryption";

// Mock console.error to test error logging
const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

// Define the encryptValue function inline for testing (since it's from a script file)
async function encryptValue(fieldName: string, value: string): Promise<string> {
  const encryptionService = EncryptionService.getInstance();
  try {
    const encrypted = encryptionService.encryptField(fieldName as EncryptableField, value);
    return JSON.stringify(encrypted);
  } catch (error) {
    console.error(`Failed to encrypt ${fieldName}:`, error);
    throw error;
  }
}

describe("encryptValue", () => {
  beforeEach(() => {
    mockEncryptField.mockClear();
    mockConsoleError.mockClear();
  });

  afterEach(() => {
    // Don't restore console.error as we want to keep the spy active
    mockEncryptField.mockReset();
  });

  describe("successful encryption", () => {
    it("should encrypt a valid field value and return JSON string", async () => {
      const mockEncryptedData: EncryptedData = {
        data: "encrypted-data-base64",
        iv: "iv-base64",
        tag: "tag-base64",
        keyId: "test-key-id",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      };

      mockEncryptField.mockReturnValue(mockEncryptedData);

      const result = await encryptValue("access_token", "test-token-value");

      expect(mockEncryptField).toHaveBeenCalledWith("access_token", "test-token-value");
      expect(result).toBe(JSON.stringify(mockEncryptedData));
      expect(mockConsoleError).not.toHaveBeenCalled();
    });

    it("should handle all supported EncryptableField types", async () => {
      const encryptableFields: EncryptableField[] = [
        "access_token",
        "refresh_token",
        "id_token",
        "environmentVariables",
        "poolApiKey",
        "swarmApiKey",
        "swarmPassword",
        "stakworkApiKey",
        "githubWebhookSecret",
        "app_access_token",
        "app_refresh_token",
      ];

      const mockEncryptedData: EncryptedData = {
        data: "encrypted-test",
        iv: "test-iv",
        tag: "test-tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      mockEncryptField.mockReturnValue(mockEncryptedData);

      for (const fieldName of encryptableFields) {
        const result = await encryptValue(fieldName, `test-${fieldName}-value`);

        expect(mockEncryptField).toHaveBeenCalledWith(fieldName, `test-${fieldName}-value`);
        expect(result).toBe(JSON.stringify(mockEncryptedData));
        expect(() => JSON.parse(result)).not.toThrow();
      }

      expect(mockEncryptField).toHaveBeenCalledTimes(encryptableFields.length);
    });

    it("should return valid JSON that can be parsed back to EncryptedData", async () => {
      const mockEncryptedData: EncryptedData = {
        data: "ZW5jcnlwdGVkLWRhdGE=",
        iv: "aXYtZGF0YQ==",
        tag: "dGFnLWRhdGE=",
        keyId: "production-key",
        version: "1",
        encryptedAt: "2024-01-15T10:30:45.123Z",
      };

      mockEncryptField.mockReturnValue(mockEncryptedData);

      const result = await encryptValue("stakworkApiKey", "sk-test-key-12345");
      const parsed = JSON.parse(result);

      expect(parsed).toEqual(mockEncryptedData);
      expect(parsed.data).toBe(mockEncryptedData.data);
      expect(parsed.iv).toBe(mockEncryptedData.iv);
      expect(parsed.tag).toBe(mockEncryptedData.tag);
      expect(parsed.keyId).toBe(mockEncryptedData.keyId);
      expect(parsed.version).toBe(mockEncryptedData.version);
      expect(parsed.encryptedAt).toBe(mockEncryptedData.encryptedAt);
    });

    it("should handle special characters and unicode in values", async () => {
      const mockEncryptedData: EncryptedData = {
        data: "encrypted-special-chars",
        iv: "special-iv",
        tag: "special-tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      mockEncryptField.mockReturnValue(mockEncryptedData);

      const specialValue = "test-value-with-特殊字符-and-émojis-🔐-and-symbols-@#$%^&*()";
      const result = await encryptValue("swarmApiKey", specialValue);

      expect(mockEncryptField).toHaveBeenCalledWith("swarmApiKey", specialValue);
      expect(result).toBe(JSON.stringify(mockEncryptedData));
    });
  });

  describe("error handling", () => {
    it("should log error and re-throw when encryptField fails", async () => {
      const encryptionError = new Error("Encryption failed: Invalid key format");
      mockEncryptField.mockImplementation(() => {
        throw encryptionError;
      });

      await expect(encryptValue("access_token", "test-token")).rejects.toThrow("Encryption failed: Invalid key format");

      expect(mockConsoleError).toHaveBeenCalledWith("Failed to encrypt access_token:", encryptionError);
      expect(mockEncryptField).toHaveBeenCalledWith("access_token", "test-token");
    });

    it("should handle EncryptionError with specific error codes", async () => {
      const encryptionError = new Error("Failed to encrypt field: poolApiKey") as any;
      encryptionError.code = "ENCRYPTION_FAILED";
      encryptionError.field = "poolApiKey";
      encryptionError.error = "Invalid encryption key";

      mockEncryptField.mockImplementation(() => {
        throw encryptionError;
      });

      await expect(encryptValue("poolApiKey", "pool-key-123")).rejects.toThrow("Failed to encrypt field: poolApiKey");

      expect(mockConsoleError).toHaveBeenCalledWith("Failed to encrypt poolApiKey:", encryptionError);
    });

    it("should handle network/service errors gracefully", async () => {
      const serviceError = new Error("Service temporarily unavailable");
      mockEncryptField.mockImplementation(() => {
        throw serviceError;
      });

      await expect(encryptValue("githubWebhookSecret", "webhook-secret")).rejects.toThrow(
        "Service temporarily unavailable",
      );

      expect(mockConsoleError).toHaveBeenCalledWith("Failed to encrypt githubWebhookSecret:", serviceError);
    });

    it("should handle malformed field names by re-throwing encryptField errors", async () => {
      const invalidFieldError = new Error("Invalid encryptable field");
      mockEncryptField.mockImplementation(() => {
        throw invalidFieldError;
      });

      await expect(encryptValue("invalid_field", "some-value")).rejects.toThrow("Invalid encryptable field");

      expect(mockConsoleError).toHaveBeenCalledWith("Failed to encrypt invalid_field:", invalidFieldError);
    });

    it("should preserve original error properties when re-throwing", async () => {
      const originalError = new Error("Original encryption error") as any;
      originalError.code = "CUSTOM_ERROR_CODE";
      originalError.customProperty = "custom-value";
      originalError.stack = "Custom stack trace";

      mockEncryptField.mockImplementation(() => {
        throw originalError;
      });

      try {
        await encryptValue("refresh_token", "refresh-123");
      } catch (thrownError: any) {
        expect(thrownError).toBe(originalError);
        expect(thrownError.message).toBe("Original encryption error");
        expect(thrownError.code).toBe("CUSTOM_ERROR_CODE");
        expect(thrownError.customProperty).toBe("custom-value");
        expect(thrownError.stack).toBe("Custom stack trace");
      }

      expect(mockConsoleError).toHaveBeenCalledWith("Failed to encrypt refresh_token:", originalError);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string values", async () => {
      const emptyValueError = new Error("Cannot encrypt empty value for field: id_token");
      mockEncryptField.mockImplementation(() => {
        throw emptyValueError;
      });

      await expect(encryptValue("id_token", "")).rejects.toThrow("Cannot encrypt empty value for field: id_token");

      expect(mockConsoleError).toHaveBeenCalledWith("Failed to encrypt id_token:", emptyValueError);
    });

    it("should handle whitespace-only values", async () => {
      const whitespaceError = new Error("Cannot encrypt empty value for field: swarmPassword");
      mockEncryptField.mockImplementation(() => {
        throw whitespaceError;
      });

      await expect(encryptValue("swarmPassword", "   \t\n  ")).rejects.toThrow(
        "Cannot encrypt empty value for field: swarmPassword",
      );

      expect(mockConsoleError).toHaveBeenCalledWith("Failed to encrypt swarmPassword:", whitespaceError);
    });

    it("should handle very long values", async () => {
      const longValue = "a".repeat(10000);
      const mockEncryptedData: EncryptedData = {
        data: "encrypted-long-value",
        iv: "long-iv",
        tag: "long-tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      mockEncryptField.mockReturnValue(mockEncryptedData);

      const result = await encryptValue("environmentVariables", longValue);

      expect(mockEncryptField).toHaveBeenCalledWith("environmentVariables", longValue);
      expect(result).toBe(JSON.stringify(mockEncryptedData));
    });

    it("should maintain consistency across multiple calls with same input", async () => {
      // Note: In real encryption, each call should produce different results due to random IV
      // But for testing deterministic behavior of the encryptValue wrapper, we can test consistency
      const mockEncryptedData: EncryptedData = {
        data: "consistent-encrypted-data",
        iv: "consistent-iv",
        tag: "consistent-tag",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      };

      mockEncryptField.mockReturnValue(mockEncryptedData);

      const result1 = await encryptValue("app_access_token", "test-token");
      const result2 = await encryptValue("app_access_token", "test-token");

      expect(result1).toBe(result2);
      expect(mockEncryptField).toHaveBeenCalledTimes(2);
      expect(mockEncryptField).toHaveBeenNthCalledWith(1, "app_access_token", "test-token");
      expect(mockEncryptField).toHaveBeenNthCalledWith(2, "app_access_token", "test-token");
    });
  });

  describe("integration with EncryptionService", () => {
    it("should call EncryptionService.getInstance() to get service instance", async () => {
      const mockEncryptedData: EncryptedData = {
        data: "service-test",
        iv: "service-iv",
        tag: "service-tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      mockEncryptField.mockReturnValue(mockEncryptedData);

      await encryptValue("poolApiKey", "service-test-value");

      expect(EncryptionService.getInstance).toHaveBeenCalled();
      expect(mockEncryptField).toHaveBeenCalledWith("poolApiKey", "service-test-value");
    });

    it("should properly type-cast fieldName to EncryptableField", async () => {
      const mockEncryptedData: EncryptedData = {
        data: "type-cast-test",
        iv: "type-iv",
        tag: "type-tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      mockEncryptField.mockReturnValue(mockEncryptedData);

      // Test that string is properly cast to EncryptableField
      await encryptValue("app_refresh_token", "typecast-test");

      expect(mockEncryptField).toHaveBeenCalledWith("app_refresh_token", "typecast-test");
    });
  });
});
