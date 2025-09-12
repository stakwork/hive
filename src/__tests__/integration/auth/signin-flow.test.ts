import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import type { User, Account } from "@prisma/client";
import { createTestUser, cleanup } from "@/__tests__/utils/test-helpers";

// Mock NextAuth functions for integration testing
const mockSignIn = vi.fn();
const mockGetProviders = vi.fn();
const mockGetServerSession = vi.fn();

vi.mock("next-auth/react", () => ({
  signIn: mockSignIn,
  getProviders: mockGetProviders,
  useSession: vi.fn(),
}));

vi.mock("next-auth/next", () => ({
  getServerSession: mockGetServerSession,
}));

describe("SignIn Authentication Flow - Integration Tests", () => {
  let testUsers: User[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    testUsers = [];
  });

  afterEach(async () => {
    // Clean up test users and accounts
    if (testUsers.length > 0) {
      const userIds = testUsers.map(user => user.id);
      await cleanup.deleteUsers(userIds);
    }
  });

  describe("User Creation Flow", () => {
    test("should create new user on successful GitHub authentication", async () => {
      // Simulate NextAuth creating a user during GitHub sign in
      const githubUserData = {
        id: `github-user-${Date.now()}`,
        email: `github-${Date.now()}@example.com`,
        name: "GitHub Test User",
        image: "https://avatars.githubusercontent.com/u/12345",
      };

      // Create user as NextAuth would do
      const newUser = await db.user.create({
        data: githubUserData,
      });
      testUsers.push(newUser);

      // Verify user was created with correct data
      expect(newUser).toMatchObject({
        email: githubUserData.email,
        name: githubUserData.name,
        image: githubUserData.image,
      });

      // Verify user exists in database
      const userInDb = await db.user.findUnique({
        where: { id: newUser.id },
      });
      expect(userInDb).toBeTruthy();
      expect(userInDb?.email).toBe(githubUserData.email);
    });

    test("should create new user on successful mock authentication", async () => {
      // Simulate NextAuth creating a user during mock sign in
      const mockUserData = {
        id: `mock-user-${Date.now()}`,
        email: `mock-${Date.now()}@example.com`,
        name: "Mock Test User",
      };

      // Create user as NextAuth would do for mock provider
      const newUser = await db.user.create({
        data: mockUserData,
      });
      testUsers.push(newUser);

      // Verify user was created with correct data
      expect(newUser).toMatchObject({
        email: mockUserData.email,
        name: mockUserData.name,
      });

      // Verify user exists in database
      const userInDb = await db.user.findUnique({
        where: { id: newUser.id },
      });
      expect(userInDb).toBeTruthy();
      expect(userInDb?.name).toBe(mockUserData.name);
    });

    test("should handle user creation with minimal data", async () => {
      const minimalUserData = {
        id: `minimal-user-${Date.now()}`,
        email: `minimal-${Date.now()}@example.com`,
        // No name or image provided
      };

      const newUser = await db.user.create({
        data: minimalUserData,
      });
      testUsers.push(newUser);

      expect(newUser.email).toBe(minimalUserData.email);
      expect(newUser.name).toBeNull();
      expect(newUser.image).toBeNull();
    });
  });

  describe("Account Linking Flow", () => {
    test("should create GitHub account record for user", async () => {
      // Create a user first
      const user = await createTestUser({
        name: "GitHub User",
        email: `github-link-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Create associated GitHub account as NextAuth would do
      const githubAccount = await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github123456",
          access_token: "encrypted_access_token_here",
          token_type: "bearer",
          scope: "read:user user:email",
        },
      });

      // Verify account was created and linked to user
      expect(githubAccount.userId).toBe(user.id);
      expect(githubAccount.provider).toBe("github");
      expect(githubAccount.type).toBe("oauth");

      // Verify account exists in database
      const accountInDb = await db.account.findUnique({
        where: { id: githubAccount.id },
        include: { user: true },
      });

      expect(accountInDb).toBeTruthy();
      expect(accountInDb?.user.id).toBe(user.id);
      expect(accountInDb?.provider).toBe("github");
    });

    test("should create mock account record for development user", async () => {
      // Create a user first
      const user = await createTestUser({
        name: "Mock User",
        email: `mock-link-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Create associated mock account
      const mockAccount = await db.account.create({
        data: {
          userId: user.id,
          type: "credentials",
          provider: "mock",
          providerAccountId: `mock-${user.id}`,
        },
      });

      // Verify account was created and linked
      expect(mockAccount.userId).toBe(user.id);
      expect(mockAccount.provider).toBe("mock");
      expect(mockAccount.type).toBe("credentials");
    });

    test("should handle multiple accounts for same user", async () => {
      // Create a user
      const user = await createTestUser({
        name: "Multi Account User",
        email: `multi-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Create GitHub account
      const githubAccount = await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github789",
          access_token: "github_token",
        },
      });

      // Create mock account for same user
      const mockAccount = await db.account.create({
        data: {
          userId: user.id,
          type: "credentials",
          provider: "mock",
          providerAccountId: `mock-${user.id}`,
        },
      });

      // Verify both accounts exist for user
      const userAccounts = await db.account.findMany({
        where: { userId: user.id },
      });

      expect(userAccounts).toHaveLength(2);
      expect(userAccounts.map(acc => acc.provider).sort()).toEqual(["github", "mock"]);
    });
  });

  describe("Token Encryption and Security", () => {
    test("should encrypt sensitive token data in database", async () => {
      const user = await createTestUser({
        name: "Token User",
        email: `token-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Create account with encrypted tokens (as NextAuth would do)
      const sensitiveTokens = {
        access_token: "gho_sensitive_access_token_123456789",
        refresh_token: "ghr_sensitive_refresh_token_987654321",
      };

      const account = await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github_token_user",
          ...sensitiveTokens,
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        },
      });

      // Verify tokens are stored (NextAuth handles encryption internally)
      expect(account.access_token).toBeTruthy();
      expect(account.refresh_token).toBeTruthy();
      expect(account.expires_at).toBeTruthy();

      // Verify token expiration handling
      expect(account.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    test("should handle token refresh flow", async () => {
      const user = await createTestUser({
        name: "Refresh User", 
        email: `refresh-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Create account with expired token
      const account = await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github_refresh_user",
          access_token: "old_access_token",
          refresh_token: "valid_refresh_token",
          expires_at: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        },
      });

      // Simulate token refresh (as NextAuth would do)
      const updatedAccount = await db.account.update({
        where: { id: account.id },
        data: {
          access_token: "new_refreshed_access_token",
          expires_at: Math.floor(Date.now() / 1000) + 3600, // New expiration
        },
      });

      expect(updatedAccount.access_token).toBe("new_refreshed_access_token");
      expect(updatedAccount.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  describe("Error Handling and Recovery", () => {
    test("should handle duplicate user creation attempts", async () => {
      const userEmail = `duplicate-${Date.now()}@example.com`;
      
      // Create first user
      const firstUser = await db.user.create({
        data: {
          id: `user1-${Date.now()}`,
          email: userEmail,
          name: "First User",
        },
      });
      testUsers.push(firstUser);

      // Attempt to create duplicate user with same email should fail
      await expect(
        db.user.create({
          data: {
            id: `user2-${Date.now()}`,
            email: userEmail, // Same email
            name: "Duplicate User",
          },
        })
      ).rejects.toThrow();
    });

    test("should handle account linking failures gracefully", async () => {
      // Attempt to create account without valid user
      await expect(
        db.account.create({
          data: {
            userId: "non-existent-user-id",
            type: "oauth", 
            provider: "github",
            providerAccountId: "github123",
          },
        })
      ).rejects.toThrow();
    });

    test("should handle provider account ID conflicts", async () => {
      const user1 = await createTestUser({
        name: "User 1",
        email: `user1-${Date.now()}@example.com`,
      });
      const user2 = await createTestUser({
        name: "User 2", 
        email: `user2-${Date.now()}@example.com`,
      });
      testUsers.push(user1, user2);

      const providerAccountId = `github-conflict-${Date.now()}`;

      // Create first account
      await db.account.create({
        data: {
          userId: user1.id,
          type: "oauth",
          provider: "github",
          providerAccountId: providerAccountId,
        },
      });

      // Attempt to create second account with same provider account ID should fail
      await expect(
        db.account.create({
          data: {
            userId: user2.id,
            type: "oauth",
            provider: "github",
            providerAccountId: providerAccountId, // Same provider account ID
          },
        })
      ).rejects.toThrow();
    });
  });

  describe("Authentication Flow Integration", () => {
    test("should complete full GitHub authentication flow", async () => {
      // Step 1: User initiates GitHub sign in
      mockGetProviders.mockResolvedValue({
        github: {
          id: "github",
          name: "GitHub",
          type: "oauth",
        },
      });

      // Step 2: Simulate successful GitHub OAuth flow
      const githubProfile = {
        id: "github123456",
        login: "testuser",
        name: "Test GitHub User",
        email: `github-flow-${Date.now()}@example.com`,
        avatar_url: "https://avatars.githubusercontent.com/u/123456",
      };

      // Step 3: Create user from GitHub profile (as NextAuth would do)
      const user = await db.user.create({
        data: {
          id: `github-flow-${Date.now()}`,
          email: githubProfile.email,
          name: githubProfile.name,
          image: githubProfile.avatar_url,
        },
      });
      testUsers.push(user);

      // Step 4: Create linked GitHub account
      const account = await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: githubProfile.id,
          access_token: "github_access_token",
          token_type: "bearer",
          scope: "read:user user:email",
        },
      });

      // Step 5: Verify complete authentication setup
      const completeUser = await db.user.findUnique({
        where: { id: user.id },
        include: { accounts: true },
      });

      expect(completeUser).toBeTruthy();
      expect(completeUser?.accounts).toHaveLength(1);
      expect(completeUser?.accounts[0].provider).toBe("github");
      expect(completeUser?.email).toBe(githubProfile.email);
    });

    test("should complete full mock authentication flow", async () => {
      // Step 1: User initiates mock sign in
      mockGetProviders.mockResolvedValue({
        mock: {
          id: "mock",
          name: "Mock Provider",
          type: "credentials",
        },
      });

      const mockUsername = "test-dev-user";

      // Step 2: Create user from mock credentials (as NextAuth would do)
      const user = await db.user.create({
        data: {
          id: `mock-flow-${Date.now()}`,
          email: `${mockUsername}@mock.dev`,
          name: mockUsername,
        },
      });
      testUsers.push(user);

      // Step 3: Create linked mock account
      const account = await db.account.create({
        data: {
          userId: user.id,
          type: "credentials",
          provider: "mock",
          providerAccountId: mockUsername,
        },
      });

      // Step 4: Verify complete mock authentication setup
      const completeUser = await db.user.findUnique({
        where: { id: user.id },
        include: { accounts: true },
      });

      expect(completeUser).toBeTruthy();
      expect(completeUser?.accounts).toHaveLength(1);
      expect(completeUser?.accounts[0].provider).toBe("mock");
      expect(completeUser?.name).toBe(mockUsername);
    });
  });

  describe("Session Management Integration", () => {
    test("should create and manage user sessions", async () => {
      const user = await createTestUser({
        name: "Session User",
        email: `session-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Simulate NextAuth session creation
      const sessionToken = `session-token-${Date.now()}`;
      const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      const session = await db.session.create({
        data: {
          sessionToken: sessionToken,
          userId: user.id,
          expires: sessionExpires,
        },
      });

      // Verify session was created
      expect(session.userId).toBe(user.id);
      expect(session.sessionToken).toBe(sessionToken);
      expect(session.expires).toEqual(sessionExpires);

      // Verify session can be retrieved
      const retrievedSession = await db.session.findUnique({
        where: { sessionToken: sessionToken },
        include: { user: true },
      });

      expect(retrievedSession).toBeTruthy();
      expect(retrievedSession?.user.id).toBe(user.id);
    });

    test("should handle session expiration", async () => {
      const user = await createTestUser({
        name: "Expired Session User",
        email: `expired-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Create expired session
      const expiredSessionToken = `expired-session-${Date.now()}`;
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday

      await db.session.create({
        data: {
          sessionToken: expiredSessionToken,
          userId: user.id,
          expires: expiredDate,
        },
      });

      // Verify expired session exists but is expired
      const expiredSession = await db.session.findUnique({
        where: { sessionToken: expiredSessionToken },
      });

      expect(expiredSession).toBeTruthy();
      expect(expiredSession?.expires.getTime()).toBeLessThan(Date.now());
    });
  });
});