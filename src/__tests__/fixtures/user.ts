import { db } from "@/lib/db";
import type { User, GitHubAuth } from "@prisma/client";

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
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const uniqueId = `${timestamp}-${random}`;
  const githubUsername = options.githubUsername || `testuser-${uniqueId}`;

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
        githubUserId: `github-${uniqueId}`,
        githubUsername,
        name: user.name || "Test User",
        bio: "Test bio",
        publicRepos: 10,
        followers: 5,
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
