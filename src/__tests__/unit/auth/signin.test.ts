import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { ensureMockWorkspaceForUser } from "@/utils/mockSetup";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    account: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn(),
    })),
  },
}));

vi.mock("@/utils/mockSetup", () => ({
  ensureMockWorkspaceForUser: vi.fn(),
}));

// Import the signIn function from NextAuth config
// Since it's part of the NextAuth configuration object, we need to extract it
import { authOptions } from "@/lib/auth/nextauth";

describe("signIn Authentication Logic - Unit Tests", () => {
  let mockEncryptionService: any;
  let signInCallback: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockEncryptionService = {
      encryptField: vi.fn().mockReturnValue({
        data: "encrypted_data",
        iv: "test_iv",
        tag: "test_tag",
        keyId: "test_key",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00.000Z",
      }),
    };

    (EncryptionService.getInstance as any).mockReturnValue(mockEncryptionService);
    
    // Extract signIn callback from authOptions
    signInCallback = authOptions.callbacks?.signIn;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Mock Provider Authentication", () => {
    test("should create new user for mock provider with email", async () => {
      const mockUser = {
        id: "test-user-id",
        name: "Test User",
        email: "test@example.com",
        image: "https://example.com/avatar.jpg",
      };

      const mockAccount = {
        provider: "mock",
        type: "oauth",
        providerAccountId: "mock-123",
      };

      const mockNewUser = {
        id: "new-user-id",
        name: "Test User",
        email: "test@example.com",
        image: "https://example.com/avatar.jpg",
        emailVerified: expect.any(Date),
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue(mockNewUser);
      (ensureMockWorkspaceForUser as any).mockResolvedValue("mock-workspace-slug");

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true);
      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { email: "test@example.com" },
      });
      expect(db.user.create).toHaveBeenCalledWith({
        data: {
          name: "Test User",
          email: "test@example.com",
          image: "https://example.com/avatar.jpg",
          emailVerified: expect.any(Date),
        },
      });
      expect(ensureMockWorkspaceForUser).toHaveBeenCalledWith("new-user-id");
      expect(mockUser.id).toBe("new-user-id");
    });

    test("should use existing user for mock provider", async () => {
      const mockUser = {
        id: "test-user-id",
        name: "Test User",
        email: "test@example.com",
        image: "https://example.com/avatar.jpg",
      };

      const mockAccount = {
        provider: "mock",
        type: "oauth",
        providerAccountId: "mock-123",
      };

      const existingUser = {
        id: "existing-user-id",
        name: "Existing User",
        email: "test@example.com",
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (ensureMockWorkspaceForUser as any).mockResolvedValue("mock-workspace-slug");

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true);
      expect(db.user.create).not.toHaveBeenCalled();
      expect(ensureMockWorkspaceForUser).toHaveBeenCalledWith("existing-user-id");
      expect(mockUser.id).toBe("existing-user-id");
    });

    test("should handle mock authentication error gracefully", async () => {
      const mockUser = {
        id: "test-user-id",
        name: "Test User",
        email: "test@example.com",
      };

      const mockAccount = {
        provider: "mock",
        type: "oauth",
        providerAccountId: "mock-123",
      };

      (db.user.findUnique as any).mockRejectedValue(new Error("Database error"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error handling mock authentication:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test("should create mock user with default name when name is missing", async () => {
      const mockUser = {
        id: "test-user-id",
        email: "test@example.com",
        image: null,
      };

      const mockAccount = {
        provider: "mock",
        type: "oauth",
        providerAccountId: "mock-123",
      };

      const mockNewUser = {
        id: "new-user-id",
        name: "Mock User",
        email: "test@example.com",
        image: null,
        emailVerified: expect.any(Date),
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue(mockNewUser);

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true);
      expect(db.user.create).toHaveBeenCalledWith({
        data: {
          name: "Mock User",
          email: "test@example.com",
          image: null,
          emailVerified: expect.any(Date),
        },
      });
    });
  });

  describe("GitHub Provider Authentication", () => {
    test("should create new GitHub account for existing user", async () => {
      const mockUser = {
        id: "test-user-id",
        name: "GitHub User",
        email: "github@example.com",
      };

      const mockAccount = {
        provider: "github",
        type: "oauth",
        providerAccountId: "github-123",
        access_token: "github_access_token",
        refresh_token: "github_refresh_token",
        id_token: "github_id_token",
        expires_at: 1234567890,
        token_type: "bearer",
        scope: "read:user user:email",
        session_state: "state123",
      };

      const existingUser = {
        id: "existing-user-id",
        email: "github@example.com",
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(null);
      (db.account.create as any).mockResolvedValue({ id: "new-account-id" });

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true);
      expect(mockUser.id).toBe("existing-user-id");
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("access_token", "github_access_token");
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("refresh_token", "github_refresh_token");
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("id_token", "github_id_token");
      expect(db.account.create).toHaveBeenCalledWith({
        data: {
          userId: "existing-user-id",
          type: "oauth",
          provider: "github",
          providerAccountId: "github-123",
          access_token: JSON.stringify(mockEncryptionService.encryptField()),
          refresh_token: JSON.stringify(mockEncryptionService.encryptField()),
          id_token: JSON.stringify(mockEncryptionService.encryptField()),
          expires_at: 1234567890,
          token_type: "bearer",
          scope: "read:user user:email",
          session_state: "state123",
        },
      });
    });

    test("should update existing GitHub account tokens", async () => {
      const mockUser = {
        id: "test-user-id",
        name: "GitHub User",
        email: "github@example.com",
      };

      const mockAccount = {
        provider: "github",
        type: "oauth",
        providerAccountId: "github-123",
        access_token: "new_github_access_token",
        refresh_token: "new_github_refresh_token",
        id_token: "new_github_id_token",
        scope: "read:user user:email repo",
      };

      const existingUser = {
        id: "existing-user-id",
        email: "github@example.com",
      };

      const existingAccount = {
        id: "existing-account-id",
        refresh_token: "old_refresh_token",
        id_token: "old_id_token",
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(existingAccount);
      (db.account.update as any).mockResolvedValue({ id: "existing-account-id" });

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true);
      expect(db.account.update).toHaveBeenCalledWith({
        where: { id: "existing-account-id" },
        data: {
          access_token: JSON.stringify(mockEncryptionService.encryptField()),
          scope: "read:user user:email repo",
          refresh_token: JSON.stringify(mockEncryptionService.encryptField()),
          id_token: JSON.stringify(mockEncryptionService.encryptField()),
        },
      });
    });

    test("should handle GitHub authentication without existing user", async () => {
      const mockUser = {
        id: "test-user-id",
        name: "GitHub User",
        email: "github@example.com",
      };

      const mockAccount = {
        provider: "github",
        type: "oauth",
        providerAccountId: "github-123",
        access_token: "github_access_token",
      };

      (db.user.findUnique as any).mockResolvedValue(null);

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true);
      expect(db.account.findFirst).not.toHaveBeenCalled();
      expect(db.account.create).not.toHaveBeenCalled();
    });

    test("should handle GitHub user without email", async () => {
      const mockUser = {
        id: "test-user-id",
        name: "GitHub User",
        email: null,
      };

      const mockAccount = {
        provider: "github",
        type: "oauth",
        providerAccountId: "github-123",
        access_token: "github_access_token",
      };

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true);
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });

    test("should handle GitHub re-authentication error gracefully", async () => {
      const mockUser = {
        id: "test-user-id",
        name: "GitHub User",
        email: "github@example.com",
      };

      const mockAccount = {
        provider: "github",
        type: "oauth",
        providerAccountId: "github-123",
        access_token: "github_access_token",
      };

      (db.user.findUnique as any).mockRejectedValue(new Error("Database error"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true); // Should still return true despite error
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error handling GitHub re-authentication:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test("should handle partial token updates for GitHub", async () => {
      const mockUser = {
        id: "test-user-id",
        name: "GitHub User",
        email: "github@example.com",
      };

      const mockAccount = {
        provider: "github",
        type: "oauth",
        providerAccountId: "github-123",
        access_token: "new_access_token",
        // No refresh_token or id_token
        scope: "read:user",
      };

      const existingUser = {
        id: "existing-user-id",
        email: "github@example.com",
      };

      const existingAccount = {
        id: "existing-account-id",
        refresh_token: "existing_refresh_token",
        id_token: "existing_id_token",
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(existingAccount);

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true);
      expect(db.account.update).toHaveBeenCalledWith({
        where: { id: "existing-account-id" },
        data: {
          access_token: JSON.stringify(mockEncryptionService.encryptField()),
          scope: "read:user",
          refresh_token: "existing_refresh_token", // Should preserve existing
          id_token: "existing_id_token", // Should preserve existing
        },
      });
    });
  });

  describe("Token Encryption", () => {
    test("should encrypt all GitHub tokens properly", async () => {
      const mockUser = {
        id: "test-user-id",
        email: "github@example.com",
      };

      const mockAccount = {
        provider: "github",
        type: "oauth",
        providerAccountId: "github-123",
        access_token: "sensitive_access_token",
        refresh_token: "sensitive_refresh_token",
        id_token: "sensitive_id_token",
      };

      const existingUser = { id: "existing-user-id", email: "github@example.com" };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(null);

      await signInCallback({ user: mockUser, account: mockAccount });

      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("access_token", "sensitive_access_token");
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("refresh_token", "sensitive_refresh_token");
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("id_token", "sensitive_id_token");
    });

    test("should handle encryption service failure", async () => {
      const mockUser = {
        id: "test-user-id",
        email: "github@example.com",
      };

      const mockAccount = {
        provider: "github",
        type: "oauth",
        providerAccountId: "github-123",
        access_token: "access_token",
      };

      const existingUser = { id: "existing-user-id", email: "github@example.com" };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(null);
      // Mock encryption to fail only for access_token
      mockEncryptionService.encryptField.mockImplementation((fieldName: string, value: string) => {
        if (fieldName === "access_token") {
          throw new Error("Encryption failed");
        }
        return {
          data: "encrypted_data",
          iv: "test_iv",
          tag: "test_tag",
          keyId: "test_key",
          version: "1",
          encryptedAt: "2024-01-01T00:00:00.000Z",
        };
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true); // Should still return true despite encryption error
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error handling GitHub re-authentication:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test("should not encrypt null or undefined tokens", async () => {
      const mockUser = {
        id: "test-user-id",
        email: "github@example.com",
      };

      const mockAccount = {
        provider: "github",
        type: "oauth",
        providerAccountId: "github-123",
        access_token: "access_token",
        refresh_token: null,
        id_token: undefined,
      };

      const existingUser = { id: "existing-user-id", email: "github@example.com" };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(null);

      await signInCallback({ user: mockUser, account: mockAccount });

      // Should encrypt non-null access_token
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("access_token", "access_token");
      // Should only be called once for access_token, not for null/undefined tokens
      expect(mockEncryptionService.encryptField).toHaveBeenCalledTimes(1);

      expect(db.account.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          refresh_token: null,
          id_token: null,
        }),
      });
    });
  });

  describe("Error Scenarios", () => {
    test("should handle database connection failure for mock provider", async () => {
      const mockUser = {
        id: "test-user-id",
        email: "test@example.com",
      };

      const mockAccount = {
        provider: "mock",
        type: "oauth",
        providerAccountId: "mock-123",
      };

      (db.user.findUnique as any).mockRejectedValue(new Error("Connection timeout"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error handling mock authentication:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test("should handle workspace creation failure for mock provider", async () => {
      const mockUser = {
        id: "test-user-id",
        email: "test@example.com",
      };

      const mockAccount = {
        provider: "mock",
        type: "oauth",
        providerAccountId: "mock-123",
      };

      const newUser = { id: "new-user-id", email: "test@example.com" };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue(newUser);
      (ensureMockWorkspaceForUser as any).mockRejectedValue(new Error("Workspace creation failed"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error handling mock authentication:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test("should handle account creation failure for GitHub", async () => {
      const mockUser = {
        id: "test-user-id",
        email: "github@example.com",
      };

      const mockAccount = {
        provider: "github",
        type: "oauth",
        providerAccountId: "github-123",
        access_token: "access_token",
      };

      const existingUser = { id: "existing-user-id", email: "github@example.com" };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(null);
      (db.account.create as any).mockRejectedValue(new Error("Account creation failed"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true); // Should still return true for GitHub errors
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error handling GitHub re-authentication:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test("should handle unknown provider gracefully", async () => {
      const mockUser = {
        id: "test-user-id",
        email: "unknown@example.com",
      };

      const mockAccount = {
        provider: "unknown",
        type: "oauth",
        providerAccountId: "unknown-123",
      };

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true);
      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(db.user.create).not.toHaveBeenCalled();
    });

    test("should handle missing user or account", async () => {
      const result1 = await signInCallback({ user: null, account: null });
      expect(result1).toBe(true);

      const result2 = await signInCallback({});
      expect(result2).toBe(true);
    });
  });

  describe("User Creation Validation", () => {
    test("should verify mock user creation with all fields", async () => {
      const mockUser = {
        id: "test-user-id",
        name: "Complete User",
        email: "complete@example.com",
        image: "https://example.com/complete.jpg",
      };

      const mockAccount = {
        provider: "mock",
        type: "oauth",
        providerAccountId: "mock-123",
      };

      const createdUser = {
        id: "new-user-id",
        name: "Complete User",
        email: "complete@example.com",
        image: "https://example.com/complete.jpg",
        emailVerified: new Date(),
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue(createdUser);

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true);
      expect(db.user.create).toHaveBeenCalledWith({
        data: {
          name: "Complete User",
          email: "complete@example.com",
          image: "https://example.com/complete.jpg",
          emailVerified: expect.any(Date),
        },
      });
      expect(mockUser.id).toBe("new-user-id");
    });

    test("should handle user creation with minimal data", async () => {
      const mockUser = {
        id: "test-user-id",
        email: "minimal@example.com",
      };

      const mockAccount = {
        provider: "mock",
        type: "oauth",
        providerAccountId: "mock-123",
      };

      const createdUser = {
        id: "new-user-id",
        name: "Mock User",
        email: "minimal@example.com",
        image: undefined,
        emailVerified: new Date(),
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue(createdUser);

      const result = await signInCallback({ user: mockUser, account: mockAccount });

      expect(result).toBe(true);
      expect(db.user.create).toHaveBeenCalledWith({
        data: {
          name: "Mock User",
          email: "minimal@example.com",
          image: undefined,
          emailVerified: expect.any(Date),
        },
      });
    });
  });
});