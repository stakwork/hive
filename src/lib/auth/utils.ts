import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

const encryptionService: EncryptionService = EncryptionService.getInstance();

/**
 * Get the user's decrypted OAuth access token for a specific provider
 */
export async function getOAuthAccessToken(
  userId: string, 
  provider: string = "github"
): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
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
      (account) => account.access_token && account.provider === provider,
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
      (account) => account.access_token && account.provider === provider,
    );
    return accountWithToken?.access_token || null;
  }

  return null;
}

/**
 * Get the user's GitHub access token (convenience function)
 */
export async function getGitHubAccessToken(userId: string): Promise<string | null> {
  return getOAuthAccessToken(userId, "github");
}

/**
 * Get the user's GitHub username
 */
export async function getGitHubUsername(userId: string): Promise<string | null> {
  const githubAuth = await db.gitHubAuth.findUnique({ where: { userId } });
  return githubAuth?.githubUsername || null;
}