import { db } from "@/lib/db";
import { config } from "@/lib/env";
import { EncryptionService } from "@/lib/encryption";

export interface AppInstallationStatus {
  installed: boolean;
  installationId?: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  scope: string;
  token_type: string;
}

/**
 * Check if the GitHub App is installed for a workspace
 */
export async function checkAppInstalled(workspaceSlug: string): Promise<AppInstallationStatus> {
  // Check if we already have an installation ID for this workspace
  const swarm = await db.swarm.findFirst({
    where: {
      workspace: { slug: workspaceSlug },
      githubInstallationId: { not: null },
    },
    select: { githubInstallationId: true },
  });

  if (swarm?.githubInstallationId) {
    return { installed: true, installationId: swarm.githubInstallationId };
  }

  return { installed: false };
}

/**
 * Refresh a GitHub App user access token using the refresh token
 */
async function refreshUserToken(refreshToken: string): Promise<RefreshTokenResponse> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.GITHUB_APP_CLIENT_ID,
      client_secret: config.GITHUB_APP_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`GitHub API error: ${data.error_description || data.error}`);
  }

  return data;
}

/**
 * Get and decrypt GitHub App tokens for a user for a specific GitHub org/user
 */
export async function getUserAppTokens(
  userId: string,
  githubOwner?: string,
): Promise<{ accessToken?: string; refreshToken?: string } | null> {
  let sourceControlToken;

  if (githubOwner) {
    // Get tokens for specific GitHub org/user
    sourceControlToken = await db.sourceControlToken.findFirst({
      where: {
        userId,
        sourceControlOrg: {
          githubLogin: githubOwner,
        },
      },
      select: {
        token: true,
        refreshToken: true,
      },
    });
  } else {
    // Get any token for this user (fallback for checking installation status)
    sourceControlToken = await db.sourceControlToken.findFirst({
      where: { userId },
      select: {
        token: true,
        refreshToken: true,
      },
    });
  }

  if (!sourceControlToken?.token) {
    return null;
  }

  try {
    const encryptionService = EncryptionService.getInstance();
    const accessToken = encryptionService.decryptField("source_control_token", sourceControlToken.token);

    let refreshToken;
    if (sourceControlToken.refreshToken) {
      refreshToken = encryptionService.decryptField("source_control_refresh_token", sourceControlToken.refreshToken);
    }

    return { accessToken, refreshToken };
  } catch (error) {
    console.error("Failed to decrypt GitHub App tokens:", error);
    return null;
  }
}

/**
 * Update GitHub App tokens for a user (encrypts before storing)
 */
async function updateUserAppTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn?: number,
): Promise<void> {
  const encryptionService = EncryptionService.getInstance();
  const encryptedAccessToken = JSON.stringify(encryptionService.encryptField("app_access_token", accessToken));
  let encryptedRefreshToken;
  if (refreshToken) {
    encryptedRefreshToken = JSON.stringify(encryptionService.encryptField("app_refresh_token", refreshToken));
  }

  const expiresAt = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined;

  // Find existing account first
  const existingAccount = await db.account.findFirst({
    where: {
      userId,
      provider: "github",
    },
  });

  if (existingAccount) {
    // Update existing account
    await db.account.update({
      where: {
        id: existingAccount.id,
      },
      data: {
        app_access_token: encryptedAccessToken,
        app_refresh_token: encryptedRefreshToken,
        app_expires_at: expiresAt,
      },
    });
  } else {
    // Create new account
    await db.account.create({
      data: {
        userId,
        type: "oauth",
        provider: "github",
        providerAccountId: userId, // Use userId as fallback
        app_access_token: encryptedAccessToken,
        app_refresh_token: encryptedRefreshToken,
        app_expires_at: expiresAt,
      },
    });
  }
}

/**
 * Refresh and update GitHub App tokens for a user
 * This function handles the complete flow: refresh token -> update database
 */
export async function refreshAndUpdateAccessTokens(userId: string): Promise<boolean> {
  try {
    // Get current tokens
    const currentTokens = await getUserAppTokens(userId);
    if (!currentTokens?.refreshToken) {
      console.error("No refresh token found for user:", userId);
      return false;
    }

    // Refresh the token
    const newTokens = await refreshUserToken(currentTokens.refreshToken);

    // Update the database with new tokens
    await updateUserAppTokens(userId, newTokens.access_token, newTokens.refresh_token, newTokens.expires_in);

    return true;
  } catch (error) {
    console.error("Failed to refresh and update user app tokens:", error);
    return false;
  }
}

/**
 * Get a valid access token, refreshing if it's close to expiration
 * @param userId - The user ID
 * @param refreshThresholdSeconds - Number of seconds before expiration to trigger refresh (default: 3600 = 1 hour)
 * @returns The access token (either current or newly refreshed)
 */
export async function getOrRefreshAccessToken(
  userId: string,
  refreshThresholdSeconds: number = 3600,
): Promise<string | null> {
  try {
    // Get current tokens and expiration
    const account = await db.account.findFirst({
      where: {
        userId,
        provider: "github",
        app_access_token: { not: null },
      },
      select: {
        app_access_token: true,
        app_refresh_token: true,
        app_expires_at: true,
      },
    });

    if (!account?.app_access_token) {
      console.error("No GitHub App tokens found for user:", userId);
      return null;
    }

    if (account?.app_refresh_token) {
      // Check if token is close to expiration
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = account.app_expires_at;

      if (expiresAt && expiresAt - now <= refreshThresholdSeconds) {
        console.log(`Token expires in ${expiresAt - now} seconds, refreshing...`);

        // Token is close to expiration, refresh it
        const refreshSuccess = await refreshAndUpdateAccessTokens(userId);
        if (!refreshSuccess) {
          console.error("Failed to refresh token for user:", userId);
          return null;
        }

        // Get the newly refreshed token
        const newTokens = await getUserAppTokens(userId);
        return newTokens?.accessToken || null;
      }
    }

    // Token is still valid, decrypt and return it
    const encryptionService = EncryptionService.getInstance();
    const accessToken = encryptionService.decryptField("app_access_token", account.app_access_token);
    return accessToken;
  } catch (error) {
    console.error("Failed to get or refresh access token:", error);
    return null;
  }
}
