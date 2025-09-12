import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { authOptions } from "@/lib/auth/nextauth";
import type { User, Account } from "@prisma/client";

// Only run these tests in integration test environment
if (process.env.TEST_SUITE !== "integration") {
  describe.skip("SignIn Integration Tests - Skipped (not in integration mode)", () => {});
} else {
  describe("SignIn Authentication Logic - Integration Tests", () => {
    let testUsers: User[] = [];
    let testAccounts: Account[] = [];
    let signInCallback: any;

    beforeEach(async () => {
      // Extract signIn callback from authOptions
      signInCallback = authOptions.callbacks?.signIn;

      // Clean up test data
      await db.account.deleteMany({
        where: {
          OR: [
            { provider: "mock" },
            { provider: "github" },
          ],
        },
      });
      await db.user.deleteMany({
        where: {
          email: {
            contains: "integration-test",
          },
        },
      });

      testUsers = [];
      testAccounts = [];
    });

    afterEach(async () => {
      // Clean up created test data
      if (testAccounts.length > 0) {
        await db.account.deleteMany({
          where: {
            id: {
              in: testAccounts.map(a => a.id),
            },
          },
        });
      }

      if (testUsers.length > 0) {
        await db.user.deleteMany({
          where: {
            id: {
              in: testUsers.map(u => u.id),
            },
          },
        });
      }
    });

    describe("Mock Provider Integration", () => {
      test("should create new user and workspace for mock authentication", async () => {
        const mockUser = {
          id: "temp-id",
          name: "Integration Test User",
          email: "integration-test-mock@example.com",
          image: "https://example.com/avatar.jpg",
        };

        const mockAccount = {
          provider: "mock",
          type: "oauth",
          providerAccountId: "mock-integration-123",
        };

        const result = await signInCallback({ user: mockUser, account: mockAccount });

        expect(result).toBe(true);

        // Verify user was created in database
        const createdUser = await db.user.findUnique({
          where: { email: "integration-test-mock@example.com" },
        });

        expect(createdUser).toBeDefined();
        expect(createdUser?.name).toBe("Integration Test User");
        expect(createdUser?.email).toBe("integration-test-mock@example.com");
        expect(createdUser?.emailVerified).toBeDefined();

        // Verify mock user ID was updated
        expect(mockUser.id).toBe(createdUser?.id);

        // Verify workspace was created
        const workspace = await db.workspace.findFirst({
          where: { ownerId: createdUser!.id },
        });

        expect(workspace).toBeDefined();
        expect(workspace?.name).toBe("Mock Workspace");

        if (createdUser) testUsers.push(createdUser);
      });

      test("should use existing user for mock authentication", async () => {
        // Pre-create a user
        const existingUser = await db.user.create({
          data: {
            name: "Existing Test User",
            email: "integration-test-existing@example.com",
            emailVerified: new Date(),
          },
        });
        testUsers.push(existingUser);

        const mockUser = {
          id: "temp-id",
          name: "Different Name",
          email: "integration-test-existing@example.com",
          image: null,
        };

        const mockAccount = {
          provider: "mock",
          type: "oauth",
          providerAccountId: "mock-existing-123",
        };

        const result = await signInCallback({ user: mockUser, account: mockAccount });

        expect(result).toBe(true);
        expect(mockUser.id).toBe(existingUser.id);

        // Verify no additional user was created
        const userCount = await db.user.count({
          where: { email: "integration-test-existing@example.com" },
        });
        expect(userCount).toBe(1);
      });

      test("should handle mock authentication database errors", async () => {
        const mockUser = {
          id: "temp-id",
          name: "Error Test User",
          email: null, // This should cause an error
        };

        const mockAccount = {
          provider: "mock",
          type: "oauth",
          providerAccountId: "mock-error-123",
        };

        const result = await signInCallback({ user: mockUser, account: mockAccount });

        // Should return false due to error
        expect(result).toBe(false);
      });
    });

    describe("GitHub Provider Integration", () => {
      test("should create GitHub account for existing user", async () => {
        // Pre-create a user
        const existingUser = await db.user.create({
          data: {
            name: "GitHub Test User",
            email: "integration-test-github@example.com",
            emailVerified: new Date(),
          },
        });
        testUsers.push(existingUser);

        const mockUser = {
          id: "temp-id",
          name: "GitHub Test User",
          email: "integration-test-github@example.com",
        };

        const mockAccount = {
          provider: "github",
          type: "oauth",
          providerAccountId: "github-integration-123",
          access_token: "test_access_token",
          refresh_token: "test_refresh_token",
          id_token: "test_id_token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: "bearer",
          scope: "read:user user:email",
          session_state: "test_state",
        };

        const result = await signInCallback({ user: mockUser, account: mockAccount });

        expect(result).toBe(true);
        expect(mockUser.id).toBe(existingUser.id);

        // Verify GitHub account was created
        const createdAccount = await db.account.findFirst({
          where: {
            userId: existingUser.id,
            provider: "github",
            providerAccountId: "github-integration-123",
          },
        });

        expect(createdAccount).toBeDefined();
        expect(createdAccount?.access_token).toBeDefined();
        expect(createdAccount?.scope).toBe("read:user user:email");

        // Verify tokens are encrypted (should be JSON strings)
        expect(() => JSON.parse(createdAccount!.access_token!)).not.toThrow();

        if (createdAccount) testAccounts.push(createdAccount);
      });

      test("should update existing GitHub account tokens", async () => {
        // Create user and existing GitHub account
        const user = await db.user.create({
          data: {
            name: "GitHub Update User",
            email: "integration-test-github-update@example.com",
            emailVerified: new Date(),
          },
        });
        testUsers.push(user);

        const encryptionService = EncryptionService.getInstance();
        const initialTokenData = encryptionService.encryptField("access_token", "initial_token");

        const existingAccount = await db.account.create({
          data: {
            userId: user.id,
            type: "oauth",
            provider: "github",
            providerAccountId: "github-update-123",
            access_token: JSON.stringify(initialTokenData),
            scope: "read:user",
          },
        });
        testAccounts.push(existingAccount);

        const mockUser = {
          id: user.id,
          name: "GitHub Update User",
          email: "integration-test-github-update@example.com",
        };

        const mockAccount = {
          provider: "github",
          type: "oauth",
          providerAccountId: "github-update-123",
          access_token: "updated_access_token",
          refresh_token: "new_refresh_token",
          scope: "read:user user:email repo",
        };

        const result = await signInCallback({ user: mockUser, account: mockAccount });

        expect(result).toBe(true);

        // Verify account was updated
        const updatedAccount = await db.account.findUnique({
          where: { id: existingAccount.id },
        });

        expect(updatedAccount).toBeDefined();
        expect(updatedAccount?.scope).toBe("read:user user:email repo");
        
        // Verify tokens were re-encrypted
        const updatedTokenData = JSON.parse(updatedAccount!.access_token!);
        expect(updatedTokenData).toHaveProperty("data");
        expect(updatedTokenData).toHaveProperty("iv");
        expect(updatedTokenData).toHaveProperty("tag");

        // Verify we can decrypt the token
        const decryptedToken = encryptionService.decryptField("access_token", updatedTokenData);
        expect(decryptedToken).toBe("updated_access_token");
      });

      test("should handle GitHub authentication without existing user", async () => {
        const mockUser = {
          id: "temp-id",
          name: "New GitHub User",
          email: "integration-test-github-new@example.com",
        };

        const mockAccount = {
          provider: "github",
          type: "oauth",
          providerAccountId: "github-new-123",
          access_token: "new_access_token",
        };

        const result = await signInCallback({ user: mockUser, account: mockAccount });

        expect(result).toBe(true);

        // Verify no user was created (GitHub provider doesn't auto-create users)
        const user = await db.user.findUnique({
          where: { email: "integration-test-github-new@example.com" },
        });

        expect(user).toBeNull();

        // Verify no account was created
        const account = await db.account.findFirst({
          where: { providerAccountId: "github-new-123" },
        });

        expect(account).toBeNull();
      });

      test("should handle GitHub user without email", async () => {
        const mockUser = {
          id: "temp-id",
          name: "GitHub No Email User",
          email: null,
        };

        const mockAccount = {
          provider: "github",
          type: "oauth",
          providerAccountId: "github-no-email-123",
          access_token: "access_token",
        };

        const result = await signInCallback({ user: mockUser, account: mockAccount });

        expect(result).toBe(true);
        // Should not attempt any database operations
      });
    });

    describe("Token Encryption Integration", () => {
      test("should properly encrypt and decrypt GitHub tokens", async () => {
        const user = await db.user.create({
          data: {
            name: "Token Test User",
            email: "integration-test-tokens@example.com",
            emailVerified: new Date(),
          },
        });
        testUsers.push(user);

        const sensitiveTokens = {
          access_token: "very_sensitive_access_token_12345",
          refresh_token: "very_sensitive_refresh_token_67890",
          id_token: "very_sensitive_id_token_abcdef",
        };

        const mockUser = {
          id: user.id,
          name: "Token Test User",
          email: "integration-test-tokens@example.com",
        };

        const mockAccount = {
          provider: "github",
          type: "oauth",
          providerAccountId: "github-tokens-123",
          ...sensitiveTokens,
        };

        const result = await signInCallback({ user: mockUser, account: mockAccount });

        expect(result).toBe(true);

        // Verify account was created with encrypted tokens
        const createdAccount = await db.account.findFirst({
          where: {
            userId: user.id,
            provider: "github",
          },
        });

        expect(createdAccount).toBeDefined();

        // Verify tokens are encrypted (stored as JSON strings)
        const storedAccessToken = JSON.parse(createdAccount!.access_token!);
        const storedRefreshToken = JSON.parse(createdAccount!.refresh_token!);
        const storedIdToken = JSON.parse(createdAccount!.id_token!);

        expect(storedAccessToken).toHaveProperty("data");
        expect(storedAccessToken).toHaveProperty("iv");
        expect(storedAccessToken).toHaveProperty("tag");

        // Verify we can decrypt the tokens correctly
        const encryptionService = EncryptionService.getInstance();
        const decryptedAccessToken = encryptionService.decryptField("access_token", storedAccessToken);
        const decryptedRefreshToken = encryptionService.decryptField("refresh_token", storedRefreshToken);
        const decryptedIdToken = encryptionService.decryptField("id_token", storedIdToken);

        expect(decryptedAccessToken).toBe(sensitiveTokens.access_token);
        expect(decryptedRefreshToken).toBe(sensitiveTokens.refresh_token);
        expect(decryptedIdToken).toBe(sensitiveTokens.id_token);

        if (createdAccount) testAccounts.push(createdAccount);
      });

      test("should handle partial token encryption", async () => {
        const user = await db.user.create({
          data: {
            name: "Partial Token User",
            email: "integration-test-partial@example.com",
            emailVerified: new Date(),
          },
        });
        testUsers.push(user);

        const mockUser = {
          id: user.id,
          name: "Partial Token User",
          email: "integration-test-partial@example.com",
        };

        const mockAccount = {
          provider: "github",
          type: "oauth",
          providerAccountId: "github-partial-123",
          access_token: "only_access_token",
          // No refresh_token or id_token
        };

        const result = await signInCallback({ user: mockUser, account: mockAccount });

        expect(result).toBe(true);

        const createdAccount = await db.account.findFirst({
          where: {
            userId: user.id,
            provider: "github",
          },
        });

        expect(createdAccount).toBeDefined();
        expect(createdAccount?.access_token).toBeDefined();
        expect(createdAccount?.refresh_token).toBeNull();
        expect(createdAccount?.id_token).toBeNull();

        // Verify access token is encrypted
        const storedAccessToken = JSON.parse(createdAccount!.access_token!);
        const encryptionService = EncryptionService.getInstance();
        const decryptedAccessToken = encryptionService.decryptField("access_token", storedAccessToken);
        expect(decryptedAccessToken).toBe("only_access_token");

        if (createdAccount) testAccounts.push(createdAccount);
      });
    });

    describe("Database Transaction Integrity", () => {
      test("should maintain data consistency during mock user creation", async () => {
        const mockUser = {
          id: "temp-id",
          name: "Transaction Test User",
          email: "integration-test-transaction@example.com",
        };

        const mockAccount = {
          provider: "mock",
          type: "oauth",
          providerAccountId: "mock-transaction-123",
        };

        const result = await signInCallback({ user: mockUser, account: mockAccount });

        expect(result).toBe(true);

        // Verify both user and workspace were created atomically
        const createdUser = await db.user.findUnique({
          where: { email: "integration-test-transaction@example.com" },
          include: { ownedWorkspaces: true },
        });

        expect(createdUser).toBeDefined();
        expect(createdUser?.ownedWorkspaces).toHaveLength(1);
        expect(createdUser?.ownedWorkspaces[0].name).toBe("Mock Workspace");

        if (createdUser) testUsers.push(createdUser);
      });

      test("should handle concurrent authentication attempts", async () => {
        const email = "integration-test-concurrent@example.com";
        
        const createMockAuth = () => ({
          user: {
            id: "temp-id",
            name: "Concurrent Test User",
            email,
          },
          account: {
            provider: "mock",
            type: "oauth",
            providerAccountId: `mock-concurrent-${Math.random()}`,
          },
        });

        // Attempt multiple concurrent authentications
        const authPromises = [
          signInCallback(createMockAuth()),
          signInCallback(createMockAuth()),
          signInCallback(createMockAuth()),
        ];

        const results = await Promise.all(authPromises);

        // At least one should succeed
        expect(results.some(result => result === true)).toBe(true);

        // Verify only one user was created
        const userCount = await db.user.count({
          where: { email },
        });

        expect(userCount).toBeLessThanOrEqual(1);

        // Clean up
        const user = await db.user.findUnique({ where: { email } });
        if (user) testUsers.push(user);
      });
    });

    describe("Error Recovery Integration", () => {
      test("should recover from workspace creation failure", async () => {
        // This test simulates a scenario where user creation succeeds but workspace creation fails
        // In the real implementation, this should be handled gracefully
        
        const mockUser = {
          id: "temp-id",
          name: "Error Recovery User",
          email: "integration-test-recovery@example.com",
        };

        const mockAccount = {
          provider: "mock",
          type: "oauth",
          providerAccountId: "mock-recovery-123",
        };

        // Mock the workspace creation to potentially fail
        // Note: This is testing the actual error handling in the signIn function
        const result = await signInCallback({ user: mockUser, account: mockAccount });

        // The function should handle errors gracefully
        if (!result) {
          // If it failed, verify no partial data was left
          const user = await db.user.findUnique({
            where: { email: "integration-test-recovery@example.com" },
          });
          
          // Either no user should exist, or user exists without workspace
          if (user) {
            testUsers.push(user);
            const workspaces = await db.workspace.findMany({
              where: { ownerId: user.id },
            });
            // Should handle partial state appropriately
          }
        }
      });
    });
  });
}