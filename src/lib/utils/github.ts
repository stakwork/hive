import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

const encryptionService: EncryptionService = EncryptionService.getInstance();

/**
 * Get the user's decrypted GitHub access token
 */
export async function getUserAccessToken(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { userId },
    select: {
      accounts: {
        select: {
          access_token: true,
          provider: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  try {
    const accountWithToken = user.accounts.find(
      (account) => account.access_token && account.provider === "github",
    );
    
    if (accountWithToken?.access_token) {
      return encryptionService.decryptField(
        "access_token",
        accountWithToken.access_token,
      );
    }
  } catch (error) {
    console.error("Failed to decrypt access_token:", error);
    // Fallback to unencrypted token if decryption fails
    const accountWithToken = user.accounts.find(
      (account) => account.access_token && account.provider === "github",
    );
    return accountWithToken?.access_token || null;
  }

  return null;
}

/**
 * Get the user's GitHub username
 */
export async function getUserGitHubUsername(userId: string): Promise<string | null> {
  const githubAuth = await db.gitHubAuth.findUnique({ where: { userId } });
  return githubAuth?.githubUsername || null;
}