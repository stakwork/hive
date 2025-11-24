import { db } from "@/lib/db";
import type { User, GitHubAuth, Account, Session } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = EncryptionService.getInstance();

export interface CreateTestUserOptions {
  name?: string;
  email?: string;
  role?: "USER" | "ADMIN";
  withGitHubAuth?: boolean;
  githubUsername?: string;
}

export async function createTestUser(
  options: CreateTestUserOptions = {},
): Promise<User> {
  const uniqueId = generateUniqueId("user");
  const githubUsername = options.githubUsername || `testuser-${uniqueId}`;

  // Check if user with this email already exists
  const existingUser = await db.user.findUnique({
    where: { email: options.email || `test-${uniqueId}@example.com` },
  });

  if (existingUser) {
    return existingUser;
  }

  const user = await db.user.create({
    data: {
      name: options.name || `Test User ${uniqueId}`,
      email: options.email || `test-${uniqueId}@example.com`,
      role: options.role || "USER",
    },
  });

  if (options.withGitHubAuth) {
    await db.gitHubAuth.create({
      data: {
        userId: user.id,
        githubUserId: generateUniqueId("github"),
        githubUsername,
        name: user.name || "Test User",
        bio: "Test bio",
        publicRepos: 10,
        followers: 5,
      },
    });

    // Create GitHub Account with encrypted access token
    if (process.env.TOKEN_ENCRYPTION_KEY) {
      const testAccessToken = `gho_test_token_${uniqueId}`;
      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("access_token", testAccessToken)
      );

      await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: generateUniqueId("github-account"),
          access_token: encryptedToken,
          token_type: "bearer",
          scope: "repo,user",
        },
      });
    }
  }

  return user;
}

export async function createTestUsers(count: number): Promise<User[]> {
  const users: User[] = [];

  for (let i = 0; i < count; i++) {
    const user = await createTestUser({
      name: `Test User ${i + 1}`,
      email: `test-user-${i + 1}@example.com`,
    });

    users.push(user);
  }

  return users;
}

export interface CreateTestUserWithGitHubAccountOptions {
  accessToken?: string;
  includeGitHubAuth?: boolean;
  includeSessions?: boolean;
}

export interface CreateTestUserWithGitHubAccountResult {
  testUser: User;
  testAccount: Account;
  testGitHubAuth: GitHubAuth | null;
  testSessions?: Session[];
}

/**
 * Creates a test user with GitHub OAuth account and optionally GitHub auth record and sessions.
 * Useful for testing GitHub API integration endpoints.
 */
export async function createTestUserWithGitHubAccount(
  options?: CreateTestUserWithGitHubAccountOptions,
): Promise<CreateTestUserWithGitHubAccountResult> {
  const {
    accessToken = "github_pat_test_token",
    includeGitHubAuth = true,
    includeSessions = false,
  } = options || {};

  return await db.$transaction(async (tx) => {
    // Create test user
    const testUser = await tx.user.create({
      data: {
        id: generateUniqueId("test-user"),
        email: `test-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });

    // Create GitHub account with encrypted access token
    const encryptedToken = encryptionService.encryptField("access_token", accessToken);
    const testAccount = await tx.account.create({
      data: {
        id: generateUniqueId("test-account"),
        userId: testUser.id,
        type: "oauth",
        provider: "github",
        providerAccountId: generateUniqueId(),
        access_token: JSON.stringify(encryptedToken),
        scope: "read:user,repo",
      },
    });

    let testGitHubAuth: GitHubAuth | null = null;
    if (includeGitHubAuth) {
      testGitHubAuth = await tx.gitHubAuth.create({
        data: {
          userId: testUser.id,
          githubUserId: "123456",
          githubUsername: "testuser",
          githubNodeId: "U_test123",
          name: "Test User",
          publicRepos: 5,
          followers: 10,
          following: 5,
          accountType: "User",
        },
      });
    }

    let testSessions: Session[] = [];
    if (includeSessions) {
      const session1 = await tx.session.create({
        data: {
          sessionToken: generateUniqueId("session"),
          userId: testUser.id,
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        },
      });

      const session2 = await tx.session.create({
        data: {
          sessionToken: generateUniqueId("session"),
          userId: testUser.id,
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        },
      });

      testSessions = [session1, session2];
    }

    return {
      testUser,
      testAccount,
      testGitHubAuth,
      ...(includeSessions && { testSessions }),
    };
  });
}
