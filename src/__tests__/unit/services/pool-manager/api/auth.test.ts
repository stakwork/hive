import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { getPoolManagerApiKey } from "@/services/pool-manager/api/auth";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/lib/env";

// Mock the encryption service
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(),
  },
}));

// Mock the config
vi.mock("@/lib/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://test-pool-manager.example.com",
    POOL_MANAGER_API_USERNAME: "test-username",
    POOL_MANAGER_API_PASSWORD: "test-password",
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("getPoolManagerApiKey", () => {
  let mockEncryptionService: {
    encryptField: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();

    // Setup encryption service mock
    mockEncryptionService = {
      encryptField: vi.fn(),
    };
    (EncryptionService.getInstance as Mock).mockReturnValue(mockEncryptionService);
  });

  test("should successfully authenticate and return encrypted API key", async () => {
    // Mock successful fetch response
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        token: "mock-api-token-12345",
      }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    // Mock encryption service
    const mockEncryptedData = {
      data: "encrypted-token-data",
      iv: "mock-iv",
      tag: "mock-tag",
      keyId: "default",
      version: "1",
      encryptedAt: "2024-01-01T00:00:00.000Z",
    };
    mockEncryptionService.encryptField.mockReturnValue(mockEncryptedData);

    const result = await getPoolManagerApiKey();

    // Verify fetch was called with correct parameters
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test-pool-manager.example.com/auth/login",
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

    // Verify response was parsed
    expect(mockResponse.json).toHaveBeenCalledOnce();

    // Verify encryption service was called correctly
    expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
      "poolApiKey",
      "mock-api-token-12345"
    );

    // Verify result is JSON stringified encrypted data
    expect(result).toBe(JSON.stringify(mockEncryptedData));
  });

  test("should throw error for non-OK HTTP response", async () => {
    // Mock failed HTTP response
    const mockResponse = {
      ok: false,
      status: 401,
    };
    mockFetch.mockResolvedValue(mockResponse);

    await expect(getPoolManagerApiKey()).rejects.toThrow(
      "Unexpected status code: 401"
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
  });

  test("should throw error when authentication fails (success: false)", async () => {
    // Mock successful HTTP response but failed authentication
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: false,
        error: "Invalid credentials",
      }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    await expect(getPoolManagerApiKey()).rejects.toThrow("Authentication failed");

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockResponse.json).toHaveBeenCalledOnce();
    expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
  });

  test("should handle network errors", async () => {
    // Mock fetch rejection (network error)
    const networkError = new Error("Network error: Connection refused");
    mockFetch.mockRejectedValue(networkError);

    await expect(getPoolManagerApiKey()).rejects.toThrow(
      "Network error: Connection refused"
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
  });

  test("should handle JSON parsing errors", async () => {
    // Mock response that fails JSON parsing
    const mockResponse = {
      ok: true,
      json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
    };
    mockFetch.mockResolvedValue(mockResponse);

    await expect(getPoolManagerApiKey()).rejects.toThrow("Invalid JSON");

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockResponse.json).toHaveBeenCalledOnce();
    expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
  });

  test("should handle encryption service errors", async () => {
    // Mock successful fetch response
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        token: "mock-api-token-12345",
      }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    // Mock encryption service error
    const encryptionError = new Error("Encryption failed");
    mockEncryptionService.encryptField.mockImplementation(() => {
      throw encryptionError;
    });

    await expect(getPoolManagerApiKey()).rejects.toThrow("Encryption failed");

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockResponse.json).toHaveBeenCalledOnce();
    expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
      "poolApiKey",
      "mock-api-token-12345"
    );
  });

  test("should handle missing token in response", async () => {
    // Mock successful response but missing token
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        // token is missing
      }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    // Mock encryption service to handle undefined token
    mockEncryptionService.encryptField.mockReturnValue({
      data: "encrypted-undefined",
      iv: "mock-iv",
      tag: "mock-tag",
      keyId: "default",
      version: "1",
      encryptedAt: "2024-01-01T00:00:00.000Z",
    });

    const result = await getPoolManagerApiKey();

    expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
      "poolApiKey",
      undefined
    );
    expect(result).toBeDefined();
  });

  test("should handle different HTTP error status codes", async () => {
    const statusCodes = [400, 401, 403, 404, 500, 502, 503];

    for (const statusCode of statusCodes) {
      vi.clearAllMocks();

      const mockResponse = {
        ok: false,
        status: statusCode,
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(getPoolManagerApiKey()).rejects.toThrow(
        `Unexpected status code: ${statusCode}`
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
    }
  });

  test("should use correct environment configuration", async () => {
    // Mock successful response
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        token: "test-token",
      }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    mockEncryptionService.encryptField.mockReturnValue({
      data: "encrypted",
      iv: "iv",
      tag: "tag",
      keyId: "default",
      version: "1",
      encryptedAt: "2024-01-01T00:00:00.000Z",
    });

    await getPoolManagerApiKey();

    // Verify the correct URL and credentials were used
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://test-pool-manager.example.com/auth/login");
    
    const requestBody = JSON.parse(options.body);
    expect(requestBody).toEqual({
      username: "test-username",
      password: "test-password",
    });

    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  test("should handle malformed response data", async () => {
    // Mock response with unexpected structure
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        // Missing success field entirely
        data: "some-data",
        token: "some-token",
      }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    // This should throw because success is falsy (undefined)
    await expect(getPoolManagerApiKey()).rejects.toThrow("Authentication failed");

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockResponse.json).toHaveBeenCalledOnce();
    expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
  });
});