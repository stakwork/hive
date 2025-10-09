/**
 * Utility functions for checking GitHub repository access and permissions
 */

export interface RepositoryAccessResult {
  hasAccess: boolean;
  canPush: boolean;
  repositoryData?: {
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
    permissions?: Record<string, boolean>;
  };
  error?: string;
}

/**
 * Check if an access token has access to a specific GitHub repository
 * and determine the level of permissions (push, admin)
 * 
 * @param accessToken - GitHub access token
 * @param repoUrl - Repository URL (supports HTTPS and SSH formats)
 * @returns Repository access information including permissions
 */
export async function checkRepositoryAccess(
  accessToken: string,
  repoUrl: string,
): Promise<RepositoryAccessResult> {
  try {
    // Extract owner/repo from URL
    const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (!githubMatch) {
      return { hasAccess: false, canPush: false, error: "invalid_repository_url" };
    }

    const [, owner, repo] = githubMatch;

    // Check if we can access the repository
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (response.ok) {
      const repositoryData = await response.json();

      // Check push permissions
      const canPush =
        repositoryData.permissions?.push === true ||
        repositoryData.permissions?.admin === true ||
        repositoryData.permissions?.maintain === true;

      console.log(`Repository permissions for ${owner}/${repo}:`, repositoryData.permissions);
      console.log(`Can push: ${canPush}`);

      return {
        hasAccess: true,
        canPush: canPush,
        repositoryData: {
          name: repositoryData.name,
          full_name: repositoryData.full_name,
          private: repositoryData.private,
          default_branch: repositoryData.default_branch,
          permissions: repositoryData.permissions,
        },
      };
    } else if (response.status === 404) {
      return { hasAccess: false, canPush: false, error: "repository_not_found_or_no_access" };
    } else if (response.status === 403) {
      return { hasAccess: false, canPush: false, error: "access_forbidden" };
    } else {
      return { hasAccess: false, canPush: false, error: `http_error_${response.status}` };
    }
  } catch (error) {
    console.error("Error checking repository access:", error);
    return { hasAccess: false, canPush: false, error: "network_error" };
  }
}