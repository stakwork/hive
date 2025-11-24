/**
 * Repository access checking utility for GitHub App integration
 * 
 * This function validates if the authenticated user has push access to a given repository
 * through the GitHub App installation. It handles various error scenarios including:
 * - Authentication failures (expired/invalid tokens)
 * - Installation permission issues (repository not included in app permissions)
 * - Network/API failures
 * 
 * @param repositoryUrl - Full GitHub repository URL (supports https and ssh formats)
 * @returns Promise resolving to access status with error details
 */
export async function checkRepositoryAccess(repositoryUrl: string): Promise<{
  hasAccess: boolean;
  error?: string;
  requiresReauth?: boolean;
  requiresInstallationUpdate?: boolean;
  installationId?: number;
}> {
  try {
    const statusResponse = await fetch(
      `/api/github/app/check?repositoryUrl=${encodeURIComponent(repositoryUrl)}`
    );
    const statusData = await statusResponse.json();

    // If there's an error field in response, treat it as no access
    if (statusData.error) {
      return {
        hasAccess: false,
        error: statusData.error,
        requiresReauth: statusData.requiresReauth,
        requiresInstallationUpdate: statusData.requiresInstallationUpdate,
        installationId: statusData.installationId,
      };
    }

    // Success case: check if user has push access
    return { hasAccess: statusData.hasPushAccess === true };
  } catch (error) {
    // Network or unexpected errors
    console.error("Failed to check repository access:", error);
    return {
      hasAccess: false,
      error: "Failed to check repository access",
    };
  }
}