import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock instance with decryptField and encryptField methods BEFORE imports
const mockDecryptField = vi.fn();
const mockEncryptField = vi.fn();
const mockEncryptionInstance = {
  decryptField: mockDecryptField,
  encryptField: mockEncryptField,
};

// Mock dependencies BEFORE imports
vi.mock("@/lib/db", () => ({
  db: {
    sourceControlToken: {
      findFirst: vi.fn(),
    },
    account: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => mockEncryptionInstance),
  },
}));

// Mock env config
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    optionalEnvVars: {
      ...actual.optionalEnvVars,
      GITHUB_OAUTH_TOKEN_URL: "https://github.com/login/oauth/access_token",
    },
  };
});

// Now import after mocking
import { getUserAppTokens, getPersonalOAuthToken } from "@/lib/githubApp";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Typed aliases for the account mocks (resolved after import)
const getAccountFindFirst = () => vi.mocked(db.account.findFirst);
const getAccountUpdate = () => vi.mocked(db.account.update);

describe("getUserAppTokens", () => {
  const mockUserId = "user-123";
  const mockGithubOwner = "test-owner";
  const mockAccessToken = "gho_test_access_token_123";
  const mockRefreshToken = "ghr_test_refresh_token_456";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("successful token retrieval with githubOwner", () => {
    it("should return access and refresh tokens when both are present", async () => {
      // Arrange
      const mockEncryptedAccessToken = {
        data: "encrypted_access_data",
        iv: "iv_string",
        tag: "tag_string",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };
      const mockEncryptedRefreshToken = {
        data: "encrypted_refresh_data",
        iv: "iv_string",
        tag: "tag_string",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: mockEncryptedRefreshToken,
      });

      mockDecryptField
        .mockReturnValueOnce(mockAccessToken)
        .mockReturnValueOnce(mockRefreshToken);

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toEqual({
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      });

      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          sourceControlOrg: {
            githubLogin: mockGithubOwner,
          },
        },
        select: {
          token: true,
          refreshToken: true,
        },
      });

      expect(EncryptionService.getInstance).toHaveBeenCalled();
      expect(mockDecryptField).toHaveBeenCalledTimes(2);
      expect(mockDecryptField).toHaveBeenNthCalledWith(
        1,
        "source_control_token",
        mockEncryptedAccessToken
      );
      expect(mockDecryptField).toHaveBeenNthCalledWith(
        2,
        "source_control_refresh_token",
        mockEncryptedRefreshToken
      );
    });

    it("should return only access token when refresh token is null", async () => {
      // Arrange
      const mockEncryptedAccessToken = {
        data: "encrypted_access_data",
        iv: "iv_string",
        tag: "tag_string",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: null,
      });

      mockDecryptField.mockReturnValueOnce(mockAccessToken);

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toEqual({
        accessToken: mockAccessToken,
        refreshToken: undefined,
      });

      expect(mockDecryptField).toHaveBeenCalledTimes(1);
      expect(mockDecryptField).toHaveBeenCalledWith(
        "source_control_token",
        mockEncryptedAccessToken
      );
    });

    it("should query database with correct userId and githubOwner", async () => {
      // Arrange
      const differentUserId = "different-user-456";
      const differentGithubOwner = "different-owner";

      const mockEncryptedAccessToken = {
        data: "encrypted_data",
        iv: "iv_string",
        tag: "tag_string",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: null,
      });

      mockDecryptField.mockReturnValueOnce(mockAccessToken);

      // Act
      await getUserAppTokens(differentUserId, differentGithubOwner);

      // Assert
      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: differentUserId,
          sourceControlOrg: {
            githubLogin: differentGithubOwner,
          },
        },
        select: {
          token: true,
          refreshToken: true,
        },
      });
    });
  });

  describe("fallback query without githubOwner", () => {
    it("should query without sourceControlOrg filter when githubOwner is undefined", async () => {
      // Arrange
      const mockEncryptedAccessToken = {
        data: "encrypted_data",
        iv: "iv_string",
        tag: "tag_string",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: null,
      });

      mockDecryptField.mockReturnValueOnce(mockAccessToken);

      // Act
      const result = await getUserAppTokens(mockUserId);

      // Assert
      expect(result).toEqual({
        accessToken: mockAccessToken,
        refreshToken: undefined,
      });

      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        select: {
          token: true,
          refreshToken: true,
        },
      });
    });

    it("should return tokens when githubOwner is not provided", async () => {
      // Arrange
      const mockEncryptedAccessToken = {
        data: "encrypted_access",
        iv: "iv",
        tag: "tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };
      const mockEncryptedRefreshToken = {
        data: "encrypted_refresh",
        iv: "iv",
        tag: "tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: mockEncryptedRefreshToken,
      });

      mockDecryptField
        .mockReturnValueOnce(mockAccessToken)
        .mockReturnValueOnce(mockRefreshToken);

      // Act
      const result = await getUserAppTokens(mockUserId, undefined);

      // Assert
      expect(result).toEqual({
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      });

      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        select: {
          token: true,
          refreshToken: true,
        },
      });
    });
  });

  describe("error handling - no tokens found", () => {
    it("should return null when no token record exists in database", async () => {
      // Arrange
      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(null);

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toBeNull();
      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          sourceControlOrg: {
            githubLogin: mockGithubOwner,
          },
        },
        select: {
          token: true,
          refreshToken: true,
        },
      });
      expect(mockDecryptField).not.toHaveBeenCalled();
    });

    it("should return null when token exists but token field is null", async () => {
      // Arrange
      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: null,
        refreshToken: null,
      });

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toBeNull();
      expect(mockDecryptField).not.toHaveBeenCalled();
    });

    it("should return null when token field is undefined", async () => {
      // Arrange
      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: undefined,
        refreshToken: null,
      });

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toBeNull();
      expect(mockDecryptField).not.toHaveBeenCalled();
    });
  });

  describe("error handling - decryption failures", () => {
    it("should return null when access token decryption fails", async () => {
      // Arrange
      const mockEncryptedAccessToken = {
        data: "encrypted_access_data",
        iv: "iv_string",
        tag: "tag_string",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: null,
      });

      mockDecryptField.mockImplementation(() => {
        throw new Error("Decryption failed: Invalid authentication tag");
      });

      // Suppress console.error for this test
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toBeNull();
      expect(mockDecryptField).toHaveBeenCalledWith(
        "source_control_token",
        mockEncryptedAccessToken
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to decrypt GitHub App tokens:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it("should return null when refresh token decryption fails", async () => {
      // Arrange
      const mockEncryptedAccessToken = {
        data: "encrypted_access_data",
        iv: "iv_string",
        tag: "tag_string",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };
      const mockEncryptedRefreshToken = {
        data: "encrypted_refresh_data",
        iv: "iv_string",
        tag: "tag_string",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: mockEncryptedRefreshToken,
      });

      mockDecryptField
        .mockReturnValueOnce(mockAccessToken)
        .mockImplementationOnce(() => {
          throw new Error("Decryption failed: Invalid key version");
        });

      // Suppress console.error for this test
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toBeNull();
      expect(mockDecryptField).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to decrypt GitHub App tokens:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it("should log error to console when decryption fails", async () => {
      // Arrange
      const mockEncryptedAccessToken = {
        data: "encrypted_data",
        iv: "iv",
        tag: "tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: null,
      });

      const decryptionError = new Error("Invalid cipher");
      mockDecryptField.mockImplementation(() => {
        throw decryptionError;
      });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Act
      await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to decrypt GitHub App tokens:",
        decryptionError
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("error handling - database errors", () => {
    it("should propagate database connection errors", async () => {
      // Arrange
      const dbError = new Error("Database connection timeout");
      vi.mocked(db.sourceControlToken.findFirst).mockRejectedValue(dbError);

      // Act & Assert
      await expect(
        getUserAppTokens(mockUserId, mockGithubOwner)
      ).rejects.toThrow("Database connection timeout");

      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          sourceControlOrg: {
            githubLogin: mockGithubOwner,
          },
        },
        select: {
          token: true,
          refreshToken: true,
        },
      });
    });

    it("should propagate Prisma query errors", async () => {
      // Arrange
      const prismaError = new Error(
        "Invalid `prisma.sourceControlToken.findFirst()` invocation"
      );
      vi.mocked(db.sourceControlToken.findFirst).mockRejectedValue(prismaError);

      // Act & Assert
      await expect(
        getUserAppTokens(mockUserId, mockGithubOwner)
      ).rejects.toThrow(
        "Invalid `prisma.sourceControlToken.findFirst()` invocation"
      );
    });
  });

  describe("edge cases", () => {
    it("should handle empty string userId", async () => {
      // Arrange
      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(null);

      // Act
      const result = await getUserAppTokens("", mockGithubOwner);

      // Assert
      expect(result).toBeNull();
      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "",
          sourceControlOrg: {
            githubLogin: mockGithubOwner,
          },
        },
        select: {
          token: true,
          refreshToken: true,
        },
      });
    });

    it("should handle empty string githubOwner as falsy value", async () => {
      // Arrange
      // Empty string is falsy, so it should query without sourceControlOrg filter
      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(null);

      // Act
      const result = await getUserAppTokens(mockUserId, "");

      // Assert
      expect(result).toBeNull();
      // Empty string is falsy, so query should not include sourceControlOrg filter
      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
        },
        select: {
          token: true,
          refreshToken: true,
        },
      });
    });

    it("should handle special characters in githubOwner", async () => {
      // Arrange
      const specialGithubOwner = "test-owner_123.special";
      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue(null);

      // Act
      const result = await getUserAppTokens(mockUserId, specialGithubOwner);

      // Assert
      expect(result).toBeNull();
      expect(db.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          sourceControlOrg: {
            githubLogin: specialGithubOwner,
          },
        },
        select: {
          token: true,
          refreshToken: true,
        },
      });
    });
  });

  describe("decryption service integration", () => {
    it("should call getInstance to get encryption service instance", async () => {
      // Arrange
      const mockEncryptedAccessToken = {
        data: "encrypted_data",
        iv: "iv",
        tag: "tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: null,
      });

      mockDecryptField.mockReturnValueOnce(mockAccessToken);

      // Act
      await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(EncryptionService.getInstance).toHaveBeenCalled();
      expect(mockDecryptField).toHaveBeenCalledWith(
        "source_control_token",
        mockEncryptedAccessToken
      );
    });

    it("should decrypt access token with correct field name and encrypted data", async () => {
      // Arrange
      const mockEncryptedAccessToken = {
        data: "base64_encrypted_data",
        iv: "initialization_vector",
        tag: "authentication_tag",
        keyId: "k2",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: null,
      });

      mockDecryptField.mockReturnValueOnce(mockAccessToken);

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toEqual({
        accessToken: mockAccessToken,
        refreshToken: undefined,
      });

      expect(mockDecryptField).toHaveBeenCalledWith(
        "source_control_token",
        mockEncryptedAccessToken
      );
    });

    it("should decrypt both tokens with correct field names", async () => {
      // Arrange
      const mockEncryptedAccessToken = {
        data: "encrypted_access",
        iv: "iv_access",
        tag: "tag_access",
        keyId: "k2",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };
      const mockEncryptedRefreshToken = {
        data: "encrypted_refresh",
        iv: "iv_refresh",
        tag: "tag_refresh",
        keyId: "k1",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: mockEncryptedRefreshToken,
      });

      mockDecryptField
        .mockReturnValueOnce(mockAccessToken)
        .mockReturnValueOnce(mockRefreshToken);

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toEqual({
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      });

      expect(mockDecryptField).toHaveBeenNthCalledWith(
        1,
        "source_control_token",
        mockEncryptedAccessToken
      );
      expect(mockDecryptField).toHaveBeenNthCalledWith(
        2,
        "source_control_refresh_token",
        mockEncryptedRefreshToken
      );
    });

    it("should handle tokens encrypted with different key versions", async () => {
      // Arrange
      const mockEncryptedAccessToken = {
        data: "encrypted_access",
        iv: "iv_access",
        tag: "tag_access",
        keyId: "k3",
        version: "2",
        encryptedAt: new Date().toISOString(),
      };
      const mockEncryptedRefreshToken = {
        data: "encrypted_refresh",
        iv: "iv_refresh",
        tag: "tag_refresh",
        keyId: "k1",
        version: "1",
        encryptedAt: new Date().toISOString(),
      };

      vi.mocked(db.sourceControlToken.findFirst).mockResolvedValue({
        token: mockEncryptedAccessToken,
        refreshToken: mockEncryptedRefreshToken,
      });

      mockDecryptField
        .mockReturnValueOnce(mockAccessToken)
        .mockReturnValueOnce(mockRefreshToken);

      // Act
      const result = await getUserAppTokens(mockUserId, mockGithubOwner);

      // Assert
      expect(result).toEqual({
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      });
      expect(mockDecryptField).toHaveBeenCalledTimes(2);
    });
  });
});

// =============================================================================
// getPersonalOAuthToken
// =============================================================================

describe("getPersonalOAuthToken", () => {
  const mockUserId = "user-abc";
  const encryptedAccessToken = JSON.stringify({
    data: "enc_access",
    iv: "iv_a",
    tag: "tag_a",
    version: "1",
    encryptedAt: new Date().toISOString(),
  });
  const encryptedRefreshToken = JSON.stringify({
    data: "enc_refresh",
    iv: "iv_r",
    tag: "tag_r",
    version: "1",
    encryptedAt: new Date().toISOString(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptField.mockReset();
    mockEncryptField.mockReset();
    global.fetch = vi.fn();
  });

  it("returns token when expires_at is null (long-lived OAuth App token)", async () => {
    getAccountFindFirst().mockResolvedValue({
      id: "acc-1",
      access_token: encryptedAccessToken,
      refresh_token: null,
      expires_at: null,
    });
    mockDecryptField.mockReturnValue("plain_token");

    const result = await getPersonalOAuthToken(mockUserId);

    expect(result).toBe("plain_token");
    // decryptField receives the raw string from DB
    expect(mockDecryptField).toHaveBeenCalledWith("access_token", encryptedAccessToken);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns token when expires_at is well in the future (not expired)", async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    getAccountFindFirst().mockResolvedValue({
      id: "acc-1",
      access_token: encryptedAccessToken,
      refresh_token: null,
      expires_at: futureExpiry,
    });
    mockDecryptField.mockReturnValue("plain_token");

    const result = await getPersonalOAuthToken(mockUserId);

    expect(result).toBe("plain_token");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refreshes and returns new token when within 5-minute buffer", async () => {
    const soonExpiry = Math.floor(Date.now() / 1000) + 200; // expires in 200s (< 300s buffer)
    getAccountFindFirst().mockResolvedValue({
      id: "acc-1",
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: soonExpiry,
    });

    // decryptField is called with the raw refresh_token string from DB
    mockDecryptField.mockReturnValue("plain_refresh_token");
    const newEncryptedAccessToken = { data: "new_enc_access", iv: "iv", tag: "t", version: "1", encryptedAt: "" };
    const newEncryptedRefreshToken = { data: "new_enc_refresh", iv: "iv", tag: "t", version: "1", encryptedAt: "" };
    mockEncryptField
      .mockReturnValueOnce(newEncryptedAccessToken)
      .mockReturnValueOnce(newEncryptedRefreshToken);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new_access_token",
        refresh_token: "new_refresh_token",
        expires_in: 28800,
      }),
    });
    getAccountUpdate().mockResolvedValue({} as any);

    const result = await getPersonalOAuthToken(mockUserId);

    expect(result).toBe("new_access_token");
    // decryptField receives the raw string from DB
    expect(mockDecryptField).toHaveBeenCalledWith("refresh_token", encryptedRefreshToken);
    expect(getAccountUpdate()).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: expect.objectContaining({
        access_token: JSON.stringify(newEncryptedAccessToken),
        refresh_token: JSON.stringify(newEncryptedRefreshToken),
      }),
    });
  });

  it("returns null when token is expired and refresh_token is null", async () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 100;
    getAccountFindFirst().mockResolvedValue({
      id: "acc-1",
      access_token: encryptedAccessToken,
      refresh_token: null,
      expires_at: expiredAt,
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await getPersonalOAuthToken(mockUserId);

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[getPersonalOAuthToken] Token expired and no refresh token available"),
    );
    expect(global.fetch).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns null when refresh API call fails (non-ok response)", async () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 100;
    getAccountFindFirst().mockResolvedValue({
      id: "acc-1",
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: expiredAt,
    });
    mockDecryptField.mockReturnValue("plain_refresh_token");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await getPersonalOAuthToken(mockUserId);

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[getPersonalOAuthToken] Token refresh failed for user"),
    );
    consoleSpy.mockRestore();
  });

  it("returns null when refresh response contains an error field", async () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 100;
    getAccountFindFirst().mockResolvedValue({
      id: "acc-1",
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: expiredAt,
    });
    mockDecryptField.mockReturnValue("plain_refresh_token");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ error: "bad_verification_code", error_description: "Token is expired." }),
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await getPersonalOAuthToken(mockUserId);

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[getPersonalOAuthToken] Token refresh failed for user"),
    );
    consoleSpy.mockRestore();
  });

  it("returns null when account has no access_token", async () => {
    getAccountFindFirst().mockResolvedValue(null);

    const result = await getPersonalOAuthToken(mockUserId);

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
