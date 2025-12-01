import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { getPoolManagerApiKey } from "@/services/pool-manager/api/auth";
import { config } from "@/config/env";
import { EncryptionService } from "@/lib/encryption";

// Mock the config module
vi.mock("@/lib/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool-manager.example.com",
    POOL_MANAGER_API_USERNAME: "test-username",
    POOL_MANAGER_API_PASSWORD: "test-password",
  },
}));

// Mock the EncryptionService
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(),
  },
}));

// Mock global fetch
global.fetch = vi.fn();

const mockEncryptionService = {
  encryptField: vi.fn(),
};

describe("getPoolManagerApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    
    // Setup EncryptionService mock
    (EncryptionService.getInstance as Mock).mockReturnValue(mockEncryptionService);
  });

  describe("successful authentication", () => {
    test("should authenticate and return encrypted API key", async () => {
      const mockToken = "pool-api-key-12345";
      const mockEncryptedData = {
        data: "encrypted-data",
        iv: "initialization-vector",
        tag: "auth-tag",
        keyId: "default",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      };

      // Mock successful API response
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          token: mockToken,
        }),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);

      // Mock encryption service
      mockEncryptionService.encryptField.mockReturnValue(mockEncryptedData);

      const result = await getPoolManagerApiKey();

      // Verify fetch was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        "https://pool-manager.example.com/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "test-username",
            password: "test-password",
          }),
        }
      );

      // Verify encryption service was called
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
        "poolApiKey",
        mockToken
      );

      // Verify result is JSON stringified encrypted data
      expect(result).toBe(JSON.stringify(mockEncryptedData));
    });

    test("should handle different response formats", async () => {
      const mockToken = "different-api-key";
      const mockEncryptedData = {
        data: "different-encrypted-data",
        iv: "different-iv",
        tag: "different-tag",
        keyId: "custom-key",
        version: "1",
        encryptedAt: "2024-01-02T00:00:00.000Z",
      };

      const mockResponse = {
        ok: true,
        status: 201, // Different success status
        json: vi.fn().mockResolvedValue({
          success: true,
          token: mockToken,
          message: "Login successful",
        }),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);
      mockEncryptionService.encryptField.mockReturnValue(mockEncryptedData);

      const result = await getPoolManagerApiKey();

      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
        "poolApiKey",
        mockToken
      );
      expect(result).toBe(JSON.stringify(mockEncryptedData));
    });
  });

  describe("HTTP request failures", () => {
    test("should throw error for 401 unauthorized", async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        json: vi.fn(),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);

      await expect(getPoolManagerApiKey()).rejects.toThrow(
        "Unexpected status code: 401"
      );

      // Verify encryption service was not called
      expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
    });

    test("should throw error for 500 internal server error", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        json: vi.fn(),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);

      await expect(getPoolManagerApiKey()).rejects.toThrow(
        "Unexpected status code: 500"
      );

      expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
    });

    test("should throw error for network failures", async () => {
      const networkError = new Error("Network request failed");
      (global.fetch as Mock).mockRejectedValue(networkError);

      await expect(getPoolManagerApiKey()).rejects.toThrow(
        "Network request failed"
      );

      expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
    });

    test("should throw error for timeout", async () => {
      const timeoutError = new Error("Request timeout");
      (global.fetch as Mock).mockRejectedValue(timeoutError);

      await expect(getPoolManagerApiKey()).rejects.toThrow("Request timeout");

      expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
    });
  });

  describe("authentication failures", () => {
    test("should throw error when success is false", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: false,
          error: "Invalid credentials",
        }),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);

      await expect(getPoolManagerApiKey()).rejects.toThrow(
        "Authentication failed"
      );

      expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
    });

    test("should throw error when success is missing", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          token: "some-token",
          // success field missing
        }),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);

      await expect(getPoolManagerApiKey()).rejects.toThrow(
        "Authentication failed"
      );

      expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
    });

    test("should throw error when response is malformed JSON", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);

      await expect(getPoolManagerApiKey()).rejects.toThrow("Invalid JSON");

      expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
    });
  });

  describe("encryption service integration", () => {
    test("should pass correct field name to encryption service", async () => {
      const mockToken = "api-key-for-field-test";
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          token: mockToken,
        }),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);
      
      const mockEncryptedData = {
        data: "encrypted",
        iv: "iv",
        tag: "tag",
        keyId: "default",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      };
      mockEncryptionService.encryptField.mockReturnValue(mockEncryptedData);

      await getPoolManagerApiKey();

      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
        "poolApiKey", // Verify correct field name
        mockToken
      );
    });

    test("should handle encryption service errors", async () => {
      const mockToken = "api-key-encryption-error";
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          token: mockToken,
        }),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);

      // Mock encryption service throwing error
      const encryptionError = new Error("Encryption failed");
      mockEncryptionService.encryptField.mockImplementation(() => {
        throw encryptionError;
      });

      await expect(getPoolManagerApiKey()).rejects.toThrow("Encryption failed");
    });

    test("should handle different encrypted data structures", async () => {
      const mockToken = "structured-data-test";
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          token: mockToken,
        }),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);

      const mockEncryptedData = {
        data: "complex-encrypted-data-structure",
        iv: "complex-iv-vector",
        tag: "complex-auth-tag",
        keyId: "production-key-id",
        version: "2",
        encryptedAt: "2024-12-01T10:30:00.000Z",
        additionalMetadata: "some-metadata",
      };
      mockEncryptionService.encryptField.mockReturnValue(mockEncryptedData);

      const result = await getPoolManagerApiKey();

      expect(result).toBe(JSON.stringify(mockEncryptedData));
    });
  });

  describe("configuration validation", () => {
    test("should use correct API endpoint from config", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          token: "test-token",
        }),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);
      mockEncryptionService.encryptField.mockReturnValue({
        data: "encrypted",
        iv: "iv",
        tag: "tag",
        keyId: "default",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      await getPoolManagerApiKey();

      expect(global.fetch).toHaveBeenCalledWith(
        "https://pool-manager.example.com/auth/login",
        expect.any(Object)
      );
    });

    test("should use correct credentials from config", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          token: "test-token",
        }),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);
      mockEncryptionService.encryptField.mockReturnValue({
        data: "encrypted",
        iv: "iv",
        tag: "tag",
        keyId: "default",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      });

      await getPoolManagerApiKey();

      const [, requestOptions] = (global.fetch as Mock).mock.calls[0];
      const requestBody = JSON.parse(requestOptions.body);

      expect(requestBody).toEqual({
        username: "test-username",
        password: "test-password",
      });
    });
  });

  describe("edge cases", () => {
    test("should handle empty token in successful response", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          token: "",
        }),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);
      
      const mockEncryptedData = {
        data: "encrypted-empty",
        iv: "iv",
        tag: "tag",
        keyId: "default",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      };
      mockEncryptionService.encryptField.mockReturnValue(mockEncryptedData);

      const result = await getPoolManagerApiKey();

      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
        "poolApiKey",
        ""
      );
      expect(result).toBe(JSON.stringify(mockEncryptedData));
    });

    test("should handle null token in response", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          token: null,
        }),
      };
      (global.fetch as Mock).mockResolvedValue(mockResponse);
      
      const mockEncryptedData = {
        data: "encrypted-null",
        iv: "iv",
        tag: "tag",
        keyId: "default",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      };
      mockEncryptionService.encryptField.mockReturnValue(mockEncryptedData);

      const result = await getPoolManagerApiKey();

      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
        "poolApiKey",
        null
      );
      expect(result).toBe(JSON.stringify(mockEncryptedData));
    });
  });
});