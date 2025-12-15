/**
 * User Factory - Creates user entities with data from values layer
 */
import { db } from "@/lib/db";
import type { User } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import {
  USER_VALUES,
  getRandomUser,
  type UserValueKey,
} from "../values/users";

const encryptionService = EncryptionService.getInstance();

export interface CreateUserOptions {
  // Use named value from USER_VALUES
  valueKey?: UserValueKey;
  // Or provide custom values (overrides valueKey)
  name?: string;
  email?: string;
  role?: "USER" | "ADMIN";
  // GitHub auth options
  withGitHubAuth?: boolean;
  githubUsername?: string;
  // Control behavior
  idempotent?: boolean; // If true, return existing if email matches
}

/**
 * Create a single user with optional GitHub auth
 *
 * @example
 * // Use named value
 * const owner = await createUser({ valueKey: "owner", idempotent: true });
 *
 * @example
 * // Use random values
 * const user = await createUser({ withGitHubAuth: true });
 *
 * @example
 * // Use custom values
 * const user = await createUser({ name: "Custom Name", email: "custom@test.com" });
 */
export async function createUser(options: CreateUserOptions = {}): Promise<User> {
  // Get base values from valueKey or random pool
  const baseValues = options.valueKey
    ? USER_VALUES[options.valueKey]
    : getRandomUser();

  const uniqueId = generateUniqueId("user");
  const data = {
    name: options.name ?? baseValues.name,
    email: options.email ?? baseValues.email,
    role: options.role ?? baseValues.role ?? "USER",
  };

  // Idempotent: check if exists
  if (options.idempotent) {
    const existing = await db.user.findUnique({ where: { email: data.email } });
    if (existing) return existing;
  }

  const user = await db.user.create({ data });

  // Create GitHub auth if requested
  const withGitHubAuth = options.withGitHubAuth ?? (options.valueKey ? true : false);
  if (withGitHubAuth) {
    const githubUsername = options.githubUsername ??
      ("githubUsername" in baseValues ? baseValues.githubUsername : `user-${uniqueId}`);

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

/**
 * Create multiple users with varied data
 *
 * @example
 * const users = await createUsers(10); // 10 users with random data
 * const users = await createUsers(5, { withGitHubAuth: true });
 */
export async function createUsers(
  count: number,
  options: Omit<CreateUserOptions, "valueKey" | "name" | "email" | "idempotent"> = {}
): Promise<User[]> {
  const users: User[] = [];

  for (let i = 0; i < count; i++) {
    const user = await createUser({
      ...options,
      // Each user gets random values from pool
    });
    users.push(user);
  }

  return users;
}

/**
 * Get or create a user by email (always idempotent)
 */
export async function getOrCreateUser(email: string, options: Omit<CreateUserOptions, "email" | "idempotent"> = {}): Promise<User> {
  return createUser({ ...options, email, idempotent: true });
}
