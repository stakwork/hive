import { db } from "@/lib/db";
import type { User } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { EncryptionService } from "@/lib/encryption";
import {
  USER_VALUES,
  getRandomUser,
  type UserValueKey,
} from "../values/users";

const encryptionService = EncryptionService.getInstance();

export interface CreateTestUserOptions {
  /** Use named value from USER_VALUES (e.g., "owner", "mockAuthUser") */
  valueKey?: UserValueKey;
  name?: string;
  email?: string;
  role?: "USER" | "ADMIN" | "MODERATOR" | "SUPER_ADMIN";
  withGitHubAuth?: boolean;
  githubUsername?: string;
  /** Lightning Network public key for Sphinx integration */
  lightningPubkey?: string;
  /** Sphinx tribe alias/username */
  sphinxAlias?: string;
  /** If true, return existing user if email matches (default: true) */
  idempotent?: boolean;
}

export async function createTestUser(
  options: CreateTestUserOptions = {},
): Promise<User> {
  // Get base values from valueKey or generate unique defaults
  const baseValues = options.valueKey
    ? USER_VALUES[options.valueKey]
    : null;

  const uniqueId = generateUniqueId("user");
  const email = options.email ?? baseValues?.email ?? `test-${uniqueId}@example.com`;
  const name = options.name ?? baseValues?.name ?? `Test User ${uniqueId}`;
  const role = options.role ?? baseValues?.role ?? "USER";
  const githubUsername = options.githubUsername ??
    (baseValues && "githubUsername" in baseValues ? baseValues.githubUsername : `testuser-${uniqueId}`);

  // Idempotent check (default true for backwards compatibility)
  const idempotent = options.idempotent ?? true;
  if (idempotent) {
    const existingUser = await db.users.findUnique({ where: { email } });
    if (existingUser) return existingUser;
  }

  const user = await db.users.create({
    data: {
      id: generateUniqueId("user"),
      name,
      email,
      role,lightning_pubkey: options.lightningPubkey,sphinx_alias: options.sphinxAlias,
      updated_at: new Date(),
    },
  });

  // Create GitHub auth if requested (default true when using valueKey)
  const withGitHubAuth = options.withGitHubAuth ?? (options.valueKey ? true : false);
  if (withGitHubAuth) {
    await db.github_auth.create({
      data: {user_id: user.id,github_user_id: generateUniqueId("github"),
        githubUsername,
        name: user.name || "Test User",
        bio: "Test bio",public_repos: 10,
        followers: 5,
      },
    });

    // Create GitHub Account with encrypted access token
    if (process.env.TOKEN_ENCRYPTION_KEY) {
      const testAccessToken = `gho_test_token_${uniqueId}`;
      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("access_token", testAccessToken)
      );

      await db.accounts.create({
        data: {user_id: user.id,
          type: "oauth",
          provider: "github",provider_account_id: generateUniqueId("github-account"),
          access_token: encryptedToken,
          token_type: "bearer",scope: "repo,user",
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
