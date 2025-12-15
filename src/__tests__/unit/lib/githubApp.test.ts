import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock instance with decryptField method BEFORE imports
const mockDecryptField = vi.fn();
const mockEncryptionInstance = {
  decryptField: mockDecryptField,
};

// Mock dependencies BEFORE imports
vi.mock("@/lib/db", () => ({
  db: {
    sourceControlToken: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => mockEncryptionInstance),
  },
}));

// Now import after mocking
import { getUserAppTokens } from "@/lib/githubApp";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

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
