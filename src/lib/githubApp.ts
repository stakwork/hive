import { db } from "@/lib/db";
import { config, optionalEnvVars } from "@/config/env";
import { serviceConfigs } from "@/config/services";
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
 * Refresh a GitHub App user access token using the refresh token
 */
async function refreshUserToken(refreshToken: string): Promise<RefreshTokenResponse> {
  const response = await fetch(optionalEnvVars.GITHUB_OAUTH_TOKEN_URL, {
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

    // Development-only logging (localhost only)
    if (process.env.NODE_ENV === 'development' && process.env.NEXTAUTH_URL?.includes('localhost')) {
      console.log('[DEV] GitHub App OAuth Token:', accessToken);
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
 * Check if a GitHub App installation has access to a specific repository
 * @param userId - The user ID
 * @param installationId - The GitHub App installation ID
 * @param repositoryUrl - The repository URL to check access for
 * @returns Promise<boolean> - true if the installation has access to the repository
 */
export async function checkRepositoryAccess(
  userId: string,
  installationId: string,
  repositoryUrl: string,
): Promise<boolean> {
  console.log("[REPO ACCESS] Starting repository access check:", {
    userId,
    installationId,
    repositoryUrl,
  });

  try {
    // Extract owner and repo name from repository URL
    const githubMatch = repositoryUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (!githubMatch) {
      console.error("[REPO ACCESS] Invalid GitHub repository URL:", repositoryUrl);
      return false;
    }

    const [, owner, repo] = githubMatch;
    const targetRepoFullName = `${owner}/${repo}`.toLowerCase();
    console.log("[REPO ACCESS] Parsed repository:", { owner, repo, targetRepoFullName });

    // Get access token for the specific GitHub owner
    console.log("[REPO ACCESS] Getting tokens for user:", userId, "and owner:", owner);
    const tokens = await getUserAppTokens(userId, owner);
    if (!tokens?.accessToken) {
      console.error("[REPO ACCESS] No access token available for user:", userId, "and owner:", owner);
      return false;
    }
    console.log("[REPO ACCESS] Successfully retrieved access token");

    const baseUrl = `${serviceConfigs.github.baseURL}/user/installations/${installationId}/repositories`;
    console.log("[REPO ACCESS] Making GitHub API request to:", baseUrl);

    // Fetch repositories with pagination (GitHub defaults to 30 per page, max is 100)
    let page = 1;
    let hasAccess = false;
    let totalCount = 0;
    let fetchedCount = 0;

    while (true) {
      const url = `${baseUrl}?per_page=100&page=${page}`;
      console.log(`[REPO ACCESS] Fetching page ${page}:`, url);

      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${tokens.accessToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      console.log("[REPO ACCESS] GitHub API response status:", response.status);

      if (!response.ok) {
        console.error("[REPO ACCESS] Failed to fetch installation repositories:", response.status, response.statusText);
        const errorText = await response.text();
        console.error("[REPO ACCESS] Error response body:", errorText);
        return false;
      }

      const data = await response.json();
      const repositories = data.repositories || [];
      totalCount = data.total_count || 0;
      fetchedCount += repositories.length;

      console.log(`[REPO ACCESS] Page ${page}: fetched ${repositories.length} repos (${fetchedCount}/${totalCount} total)`);

      // Check if the target repository is in this page
      hasAccess = repositories.some(
        (repository: { full_name: string }) => repository.full_name.toLowerCase() === targetRepoFullName,
      );

      if (hasAccess) {
        console.log(`[REPO ACCESS] Found repository ${targetRepoFullName} on page ${page}`);
        break;
      }

      // Check if there are more pages
      if (repositories.length === 0 || fetchedCount >= totalCount) {
        console.log(`[REPO ACCESS] Finished pagination: checked ${fetchedCount} repositories across ${page} pages`);
        break;
      }

      page++;
    }

    console.log(`Looking for repository: ${targetRepoFullName}`);
    console.log(`Repository access check result: ${hasAccess ? "GRANTED" : "DENIED"}`);

    console.log("[REPO ACCESS] Final result:", hasAccess ? "ACCESS GRANTED" : "ACCESS DENIED");
    return !!hasAccess;
  } catch (error) {
    console.error("[REPO ACCESS] Error during repository access check:", error);
    return false;
  }
}
