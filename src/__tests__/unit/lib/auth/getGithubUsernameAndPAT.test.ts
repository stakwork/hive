import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
    gitHubAuth: {
      findUnique: vi.fn(),
    },
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

describe("getGithubUsernameAndPAT", () => {
  const mockDb = vi.mocked(db);
  const mockEncryptionService = vi.mocked(EncryptionService);
  const mockDecryptField = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptField.mockClear();
    mockEncryptionService.getInstance.mockReturnValue({
      decryptField: mockDecryptField,
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Mock user handling", () => {
    it("should return null for mock users with @mock.dev email", async () => {
      // Arrange
      const userId = "mock-user-123";
      mockDb.user.findUnique.mockResolvedValue({
        id: userId,
        email: "testuser@mock.dev",
        name: "Test User",
      });

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert
      expect(result).toBeNull();
      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });
      // Should not proceed to query GitHub auth or account tables for mock users
      expect(mockDb.gitHubAuth.findUnique).not.toHaveBeenCalled();
      expect(mockDb.account.findFirst).not.toHaveBeenCalled();
    });

    it("should return null for various mock email patterns", async () => {
      const mockEmails = [
        "user1@mock.dev",
        "test-user@mock.dev", 
        "developer@mock.dev",
        "admin@mock.dev",
      ];

      for (const email of mockEmails) {
        const userId = `test-${email}`;
        mockDb.user.findUnique.mockResolvedValue({
          id: userId,
          email,
          name: "Mock User",
        });

        const result = await getGithubUsernameAndPAT(userId);
        expect(result).toBeNull();
      }
    });

    it("should proceed with GitHub auth for non-mock users", async () => {
      // Arrange
      const userId = "real-user-123";
      mockDb.user.findUnique.mockResolvedValue({
        id: userId,
        email: "user@example.com", // Not a mock email
        name: "Real User",
      });
      mockDb.gitHubAuth.findUnique.mockResolvedValue(null);

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert
      expect(mockDb.gitHubAuth.findUnique).toHaveBeenCalledWith({
        where: { userId },
      });
      // Since we return null early if no githubAuth, account.findFirst shouldn't be called
      expect(mockDb.account.findFirst).not.toHaveBeenCalled();
      expect(result).toBeNull(); // No credentials found
    });
  });

  describe("Successful credential retrieval and decryption", () => {
    it("should successfully retrieve and decrypt GitHub credentials with both pat and appAccessToken", async () => {
      // Arrange
      const userId = "user-123";
      const mockUser = {
        id: userId,
        email: "user@example.com",
        name: "Test User",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: "testuser",
        githubUserId: "12345",
      };
      const mockAccount = {
        userId,
        provider: "github",
        access_token: "encrypted_pat_token",
        app_access_token: "encrypted_app_token",
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockResolvedValue(mockAccount);
      
      // Mock decryption calls
      mockDecryptField
        .mockReturnValueOnce("gho_decrypted_pat_token") // First call for pat
        .mockReturnValueOnce("gho_decrypted_app_token"); // Second call for appAccessToken

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert
      expect(result).toEqual({
        username: "testuser",
        pat: "gho_decrypted_pat_token",
        appAccessToken: "gho_decrypted_app_token",
      });
      expect(mockDecryptField).toHaveBeenCalledTimes(2);
      expect(mockDecryptField).toHaveBeenNthCalledWith(1, "access_token", "encrypted_pat_token");
      expect(mockDecryptField).toHaveBeenNthCalledWith(2, "app_access_token", "encrypted_app_token");
    });

    it("should successfully retrieve credentials with only pat (no app access token)", async () => {
      // Arrange
      const userId = "user-456";
      const mockUser = {
        id: userId,
        email: "user2@example.com",
        name: "Test User 2",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: "testuser2",
        githubUserId: "67890",
      };
      const mockAccount = {
        userId,
        provider: "github",
        access_token: "encrypted_pat_only",
        app_access_token: null, // No app access token
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockResolvedValue(mockAccount);
      mockDecryptField.mockReturnValue("gho_decrypted_pat_only");

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert
      expect(result).toEqual({
        username: "testuser2",
        pat: "gho_decrypted_pat_only",
        appAccessToken: null,
      });
      expect(mockDecryptField).toHaveBeenCalledTimes(1);
      expect(mockDecryptField).toHaveBeenCalledWith("access_token", "encrypted_pat_only");
    });

    it("should handle user with GitHub auth but missing username", async () => {
      // Arrange
      const userId = "user-789";
      const mockUser = {
        id: userId,
        email: "user3@example.com",
        name: "Test User 3",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: null, // Missing username
        githubUserId: "111213",
      };
      const mockAccount = {
        userId,
        provider: "github",
        access_token: "encrypted_token",
        app_access_token: null,
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockResolvedValue(mockAccount);

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert
      expect(result).toBeNull(); // Should return null when username is missing
      expect(mockDecryptField).not.toHaveBeenCalled();
    });
  });

  describe("Error cases and missing credentials", () => {
    it("should return null when user does not exist", async () => {
      // Arrange
      const userId = "nonexistent-user";
      mockDb.user.findUnique.mockResolvedValue(null);

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert
      expect(result).toBeNull();
      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });
      // Should not proceed to other queries
      expect(mockDb.gitHubAuth.findUnique).not.toHaveBeenCalled();
      expect(mockDb.account.findFirst).not.toHaveBeenCalled();
    });

    it("should return null when GitHub auth record does not exist", async () => {
      // Arrange
      const userId = "user-no-auth";
      const mockUser = {
        id: userId,
        email: "user@example.com",
        name: "User No Auth",
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(null);
      mockDb.account.findFirst.mockResolvedValue({
        userId,
        provider: "github",
        access_token: "some_token",
      });

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert
      expect(result).toBeNull();
      expect(mockDb.gitHubAuth.findUnique).toHaveBeenCalledWith({
        where: { userId },
      });
      expect(mockDecryptField).not.toHaveBeenCalled();
    });

    it("should return null when GitHub account does not exist", async () => {
      // Arrange
      const userId = "user-no-account";
      const mockUser = {
        id: userId,
        email: "user@example.com",
        name: "User No Account",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: "usernoauth",
        githubUserId: "99999",
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockResolvedValue(null);

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert
      expect(result).toBeNull();
      expect(mockDb.account.findFirst).toHaveBeenCalledWith({
        where: { userId, provider: "github" },
      });
      expect(mockDecryptField).not.toHaveBeenCalled();
    });

    it("should return null when access token is missing", async () => {
      // Arrange
      const userId = "user-no-token";
      const mockUser = {
        id: userId,
        email: "user@example.com",
        name: "User No Token",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: "usernotoken",
        githubUserId: "88888",
      };
      const mockAccount = {
        userId,
        provider: "github",
        access_token: null, // Missing access token
        app_access_token: null,
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockResolvedValue(mockAccount);

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert
      expect(result).toBeNull();
      expect(mockDecryptField).not.toHaveBeenCalled();
    });

    it("should handle database query errors gracefully", async () => {
      // Arrange
      const userId = "error-user";
      mockDb.user.findUnique.mockRejectedValue(new Error("Database connection error"));

      // Act & Assert
      await expect(getGithubUsernameAndPAT(userId)).rejects.toThrow("Database connection error");
    });

    it("should handle GitHubAuth query errors gracefully", async () => {
      // Arrange
      const userId = "auth-error-user";
      const mockUser = {
        id: userId,
        email: "user@example.com",
        name: "Auth Error User",
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockRejectedValue(new Error("GitHub auth query error"));

      // Act & Assert
      await expect(getGithubUsernameAndPAT(userId)).rejects.toThrow("GitHub auth query error");
    });

    it("should handle Account query errors gracefully", async () => {
      // Arrange
      const userId = "account-error-user";
      const mockUser = {
        id: userId,
        email: "user@example.com",
        name: "Account Error User",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: "accounterror",
        githubUserId: "77777",
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockRejectedValue(new Error("Account query error"));

      // Act & Assert
      await expect(getGithubUsernameAndPAT(userId)).rejects.toThrow("Account query error");
    });
  });

  describe("Decryption security and error handling", () => {
    it("should handle decryption errors for access tokens", async () => {
      // Arrange
      const userId = "decrypt-error-user";
      const mockUser = {
        id: userId,
        email: "user@example.com",
        name: "Decrypt Error User",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: "decrypterror",
        githubUserId: "66666",
      };
      const mockAccount = {
        userId,
        provider: "github",
        access_token: "corrupted_encrypted_token",
        app_access_token: null,
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockResolvedValue(mockAccount);
      mockDecryptField.mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      // Act & Assert
      await expect(getGithubUsernameAndPAT(userId)).rejects.toThrow("Decryption failed");
    });

    it("should handle decryption errors for app access tokens", async () => {
      // Arrange
      const userId = "app-decrypt-error-user";
      const mockUser = {
        id: userId,
        email: "user@example.com",
        name: "App Decrypt Error User",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: "appdecrypterror",
        githubUserId: "55555",
      };
      const mockAccount = {
        userId,
        provider: "github",
        access_token: "valid_encrypted_token",
        app_access_token: "corrupted_app_token",
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockResolvedValue(mockAccount);
      mockDecryptField
        .mockReturnValueOnce("gho_valid_pat_token") // First call succeeds
        .mockImplementationOnce(() => {
          throw new Error("App token decryption failed");
        }); // Second call fails

      // Act & Assert
      await expect(getGithubUsernameAndPAT(userId)).rejects.toThrow("App token decryption failed");
    });

    it("should properly call encryption service with correct field names", async () => {
      // Arrange
      const userId = "encryption-test-user";
      const mockUser = {
        id: userId,
        email: "user@example.com",
        name: "Encryption Test User",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: "encryptiontest",
        githubUserId: "44444",
      };
      const mockAccount = {
        userId,
        provider: "github",
        access_token: "encrypted_pat",
        app_access_token: "encrypted_app",
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockResolvedValue(mockAccount);
      mockDecryptField
        .mockReturnValueOnce("decrypted_pat")
        .mockReturnValueOnce("decrypted_app");

      // Act
      await getGithubUsernameAndPAT(userId);

      // Assert
      expect(mockEncryptionService.getInstance).toHaveBeenCalled();
      expect(mockDecryptField).toHaveBeenCalledWith("access_token", "encrypted_pat");
      expect(mockDecryptField).toHaveBeenCalledWith("app_access_token", "encrypted_app");
    });

    it("should not expose encrypted tokens in response", async () => {
      // Arrange
      const userId = "security-test-user";
      const mockUser = {
        id: userId,
        email: "user@example.com",
        name: "Security Test User",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: "securitytest",
        githubUserId: "33333",
      };
      const mockAccount = {
        userId,
        provider: "github",
        access_token: "encrypted_secret_token_12345",
        app_access_token: "encrypted_app_secret_67890",
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockResolvedValue(mockAccount);
      mockDecryptField
        .mockReturnValueOnce("gho_safe_decrypted_token")
        .mockReturnValueOnce("gho_safe_app_token");

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert
      expect(result).toEqual({
        username: "securitytest",
        pat: "gho_safe_decrypted_token",
        appAccessToken: "gho_safe_app_token",
      });
      
      // Verify encrypted tokens are not in the response
      const responseString = JSON.stringify(result);
      expect(responseString).not.toContain("encrypted_secret_token_12345");
      expect(responseString).not.toContain("encrypted_app_secret_67890");
      expect(responseString).toContain("gho_safe_decrypted_token");
      expect(responseString).toContain("gho_safe_app_token");
    });
  });

  describe("Integration patterns with consuming endpoints", () => {
    it("should return credentials in format expected by GitHub API clients", async () => {
      // Arrange
      const userId = "api-client-user";
      const mockUser = {
        id: userId,
        email: "apiclient@example.com",
        name: "API Client User",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: "apiclientuser",
        githubUserId: "22222",
      };
      const mockAccount = {
        userId,
        provider: "github",
        access_token: "encrypted_github_token",
        app_access_token: "encrypted_github_app_token",
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockResolvedValue(mockAccount);
      mockDecryptField
        .mockReturnValueOnce("ghp_1234567890abcdef")
        .mockReturnValueOnce("ghs_app_token_xyz");

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert - Verify structure matches GithubUsernameAndPAT interface
      expect(result).toBeDefined();
      expect(typeof result!.username).toBe("string");
      expect(typeof result!.pat).toBe("string");
      expect(result!.appAccessToken === null || typeof result!.appAccessToken === "string").toBe(true);
      
      // Verify values
      expect(result!.username).toBe("apiclientuser");
      expect(result!.pat).toBe("ghp_1234567890abcdef");
      expect(result!.appAccessToken).toBe("ghs_app_token_xyz");
    });

    it("should handle null user gracefully for webhook scenarios", async () => {
      // Arrange - Simulate webhook scenario where user might not exist
      const userId = "webhook-missing-user";
      mockDb.user.findUnique.mockResolvedValue(null);

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert - Should return null without throwing
      expect(result).toBeNull();
    });

    it("should work correctly with priority token selection (appAccessToken vs pat)", async () => {
      // Arrange
      const userId = "priority-token-user";
      const mockUser = {
        id: userId,
        email: "priority@example.com",
        name: "Priority Token User",
      };
      const mockGitHubAuth = {
        userId,
        githubUsername: "priorityuser",
        githubUserId: "11111",
      };
      const mockAccount = {
        userId,
        provider: "github",
        access_token: "encrypted_user_token",
        app_access_token: "encrypted_app_token_with_higher_permissions",
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.gitHubAuth.findUnique.mockResolvedValue(mockGitHubAuth);
      mockDb.account.findFirst.mockResolvedValue(mockAccount);
      mockDecryptField
        .mockReturnValueOnce("ghp_user_token_standard")
        .mockReturnValueOnce("ghs_app_token_enhanced");

      // Act
      const result = await getGithubUsernameAndPAT(userId);

      // Assert - Both tokens should be available for consuming code to choose
      expect(result).toEqual({
        username: "priorityuser",
        pat: "ghp_user_token_standard",
        appAccessToken: "ghs_app_token_enhanced",
      });
    });
  });
});
