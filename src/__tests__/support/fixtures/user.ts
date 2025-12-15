import { db } from "@/lib/db";
import type { User, GitHubAuth } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { EncryptionService } from "@/lib/encryption";
import { USER_VALUES } from "@/__tests__/support/values";

const encryptionService = EncryptionService.getInstance();

export interface CreateTestUserOptions {
  name?: string;
  email?: string;
  role?: "USER" | "ADMIN";
  withGitHubAuth?: boolean;
  githubUsername?: string;
  idempotent?: boolean;
}

export async function createTestUser(
  options: CreateTestUserOptions = {},
): Promise<User> {
  const uniqueId = generateUniqueId("user");
  const githubUsername = options.githubUsername || `testuser-${uniqueId}`;
  
  // Use VALUES layer for default data
  const randomUser = USER_VALUES.getRandomUser();
  const email = options.email || `test-${uniqueId}@example.com`;
  const name = options.name || randomUser.name;
  const role = options.role;

  // Check for existing user if idempotent flag is true (or always check by email)
  const shouldCheckExisting = options.idempotent !== false; // Default to true for backwards compatibility
  if (shouldCheckExisting) {
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return existingUser;
    }
  }

  const user = await db.user.create({
    data: {
      name,
      email,
      role: role || "USER",
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
