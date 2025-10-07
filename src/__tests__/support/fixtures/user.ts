import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import type { User, GitHubAuth } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

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
    // Create GitHub auth
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

    // Create OAuth Account with encrypted access token
    const encryptionService = EncryptionService.getInstance();
    const mockAccessToken = `gho_test_token_${generateUniqueId("token")}`;
    const encryptedToken = encryptionService.encryptField("access_token", mockAccessToken);

    await db.account.create({
      data: {
        userId: user.id,
        type: "oauth",
        provider: "github",
        providerAccountId: generateUniqueId("provider-account"),
        access_token: JSON.stringify(encryptedToken),
      },
    });
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
