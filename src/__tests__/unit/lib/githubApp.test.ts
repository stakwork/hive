import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { getUserAppTokens } from "@/lib/githubApp";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    account: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock the encryption service
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(),
  },
}));

const mockEncryptionService = {
  decryptField: vi.fn(),
};

describe("getUserAppTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    
    // Setup default encryption service mock
    (EncryptionService.getInstance as Mock).mockReturnValue(mockEncryptionService);
  });

  test("should return null when no account is found", async () => {
    // Arrange
    const userId = "test-user-123";
    (db.account.findFirst as Mock).mockResolvedValue(null);

    // Act
    const result = await getUserAppTokens(userId);

    // Assert
    expect(result).toBeNull();
    expect(db.account.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        provider: "github",
        app_access_token: { not: null },
      },
      select: {
        app_access_token: true,
        app_refresh_token: true,
      },
    });
  });

  test("should return null when account has no app_access_token", async () => {
    // Arrange
    const userId = "test-user-123";
    const mockAccount = {
      app_access_token: null,
      app_refresh_token: null,
    };
    (db.account.findFirst as Mock).mockResolvedValue(mockAccount);

    // Act
    const result = await getUserAppTokens(userId);

    // Assert
    expect(result).toBeNull();
    expect(db.account.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        provider: "github",
        app_access_token: { not: null },
      },
      select: {
        app_access_token: true,
        app_refresh_token: true,
      },
    });
  });

  test("should return decrypted tokens when account has both access and refresh tokens", async () => {
    // Arrange
    const userId = "test-user-123";
    const mockAccount = {
      app_access_token: "encrypted_access_token",
      app_refresh_token: "encrypted_refresh_token",
    };
    const decryptedAccessToken = "decrypted_access_token";
    const decryptedRefreshToken = "decrypted_refresh_token";

    (db.account.findFirst as Mock).mockResolvedValue(mockAccount);
    mockEncryptionService.decryptField
      .mockReturnValueOnce(decryptedAccessToken)
      .mockReturnValueOnce(decryptedRefreshToken);

    // Act
    const result = await getUserAppTokens(userId);

    // Assert
    expect(result).toEqual({
      accessToken: decryptedAccessToken,
      refreshToken: decryptedRefreshToken,
    });
    expect(db.account.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        provider: "github",
        app_access_token: { not: null },
      },
      select: {
        app_access_token: true,
        app_refresh_token: true,
      },
    });
    expect(mockEncryptionService.decryptField).toHaveBeenCalledWith(
      "app_access_token",
      mockAccount.app_access_token
    );
    expect(mockEncryptionService.decryptField).toHaveBeenCalledWith(
      "app_refresh_token",
      mockAccount.app_refresh_token
    );
  });

  test("should return only access token when account has no refresh token", async () => {
    // Arrange
    const userId = "test-user-123";
    const mockAccount = {
      app_access_token: "encrypted_access_token",
      app_refresh_token: null,
    };
    const decryptedAccessToken = "decrypted_access_token";

    (db.account.findFirst as Mock).mockResolvedValue(mockAccount);
    mockEncryptionService.decryptField.mockReturnValue(decryptedAccessToken);

    // Act
    const result = await getUserAppTokens(userId);

    // Assert
    expect(result).toEqual({
      accessToken: decryptedAccessToken,
      refreshToken: undefined,
    });
    expect(db.account.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        provider: "github",
        app_access_token: { not: null },
      },
      select: {
        app_access_token: true,
        app_refresh_token: true,
      },
    });
    expect(mockEncryptionService.decryptField).toHaveBeenCalledWith(
      "app_access_token",
      mockAccount.app_access_token
    );
    expect(mockEncryptionService.decryptField).toHaveBeenCalledTimes(1);
  });

  test("should return null when decryption fails", async () => {
    // Arrange
    const userId = "test-user-123";
    const mockAccount = {
      app_access_token: "encrypted_access_token",
      app_refresh_token: "encrypted_refresh_token",
    };
    const decryptionError = new Error("Decryption failed");

    (db.account.findFirst as Mock).mockResolvedValue(mockAccount);
    mockEncryptionService.decryptField.mockImplementation(() => {
      throw decryptionError;
    });

    // Spy on console.error to verify error logging
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Act
    const result = await getUserAppTokens(userId);

    // Assert
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to decrypt GitHub App tokens:",
      decryptionError
    );
    expect(db.account.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        provider: "github",
        app_access_token: { not: null },
      },
      select: {
        app_access_token: true,
        app_refresh_token: true,
      },
    });

    // Cleanup
    consoleSpy.mockRestore();
  });

  test("should handle database query failure gracefully", async () => {
    // Arrange
    const userId = "test-user-123";
    const databaseError = new Error("Database connection failed");

    (db.account.findFirst as Mock).mockRejectedValue(databaseError);

    // Act & Assert
    await expect(getUserAppTokens(userId)).rejects.toThrow("Database connection failed");
    expect(db.account.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        provider: "github",
        app_access_token: { not: null },
      },
      select: {
        app_access_token: true,
        app_refresh_token: true,
      },
    });
  });

  test("should use correct encryption service instance", async () => {
    // Arrange
    const userId = "test-user-123";
    const mockAccount = {
      app_access_token: "encrypted_access_token",
      app_refresh_token: null,
    };
    const decryptedAccessToken = "decrypted_access_token";

    (db.account.findFirst as Mock).mockResolvedValue(mockAccount);
    mockEncryptionService.decryptField.mockReturnValue(decryptedAccessToken);

    // Act
    await getUserAppTokens(userId);

    // Assert
    expect(EncryptionService.getInstance).toHaveBeenCalledTimes(1);
    expect(mockEncryptionService.decryptField).toHaveBeenCalledWith(
      "app_access_token",
      mockAccount.app_access_token
    );
  });

  test("should handle empty string access token as falsy", async () => {
    // Arrange
    const userId = "test-user-123";
    const mockAccount = {
      app_access_token: "",
      app_refresh_token: null,
    };
    (db.account.findFirst as Mock).mockResolvedValue(mockAccount);

    // Act
    const result = await getUserAppTokens(userId);

    // Assert
    expect(result).toBeNull();
    expect(db.account.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        provider: "github",
        app_access_token: { not: null },
      },
      select: {
        app_access_token: true,
        app_refresh_token: true,
      },
    });
    // Should not call decryptField when access token is empty string
    expect(mockEncryptionService.decryptField).not.toHaveBeenCalled();
  });
});