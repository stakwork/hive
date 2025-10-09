/**
 * GitHub Repository Permissions Checker
 * 
 * Verifies user access and permission levels for GitHub repositories.
 * Used by the API route handler to check repository access before operations.
 */

/**
 * Permission check result returned by checkRepositoryPermissions
 */
export interface RepositoryPermissionResult {
  hasAccess: boolean;
  canPush: boolean;
  canAdmin: boolean;
  permissions?: Record<string, boolean>;
  repositoryData?: {
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
  };
  error?: string;
}

/**
 * Checks repository permissions for a given access token and repository URL.
 * 
 * This function:
 * 1. Parses the GitHub repository URL to extract owner and repo name
 * 2. Makes an authenticated request to GitHub API to fetch repository details
 * 3. Calculates permission levels based on the response
 * 4. Returns structured permission information or error details
 * 
 * @param accessToken - GitHub access token with repository permissions
 * @param repoUrl - Full GitHub repository URL (supports HTTPS, SSH, with/without .git)
 * @returns Promise resolving to permission check result
 * 
 * @example
 * ```typescript
 * const result = await checkRepositoryPermissions(
 *   'ghp_token123',
 *   'https://github.com/owner/repo'
 * );
 * 
 * if (result.hasAccess && result.canPush) {
 *   // User can push to repository
 * }
 * ```
 */
export async function checkRepositoryPermissions(
  accessToken: string,
  repoUrl: string
): Promise<RepositoryPermissionResult> {
  try {
    // Extract owner/repo from URL
    // Supports formats: 
    // - https://github.com/owner/repo
    // - git@github.com:owner/repo.git
    // - https://github.com/owner/repo.git
    const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (!githubMatch) {
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'invalid_repository_url'
      };
    }

    const [, owner, repo] = githubMatch;

    // Check repository access and permissions via GitHub API
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (response.ok) {
      const repositoryData = await response.json();

      // Parse permissions from GitHub API response
      // GitHub returns permissions object with boolean flags for each level
      const permissions = repositoryData.permissions || {};
      
      // Calculate permission levels:
      // - canPush: user can push commits (requires push, admin, or maintain)
      // - canAdmin: user has admin access (requires admin)
      const canPush = permissions.push === true || permissions.admin === true || permissions.maintain === true;
      const canAdmin = permissions.admin === true;

      return {
        hasAccess: true,
        canPush,
        canAdmin,
        permissions,
        repositoryData: {
          name: repositoryData.name,
          full_name: repositoryData.full_name,
          private: repositoryData.private,
          default_branch: repositoryData.default_branch,
        }
      };
    } else if (response.status === 404) {
      // Repository not found OR user doesn't have access (GitHub returns 404 for both)
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'repository_not_found_or_no_access'
      };
    } else if (response.status === 403) {
      // Access forbidden - token lacks required permissions
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'access_forbidden'
      };
    } else {
      // Other HTTP errors (500, 502, etc.)
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: `http_error_${response.status}`
      };
    }
  } catch (error) {
    console.error('Error checking repository permissions:', error);
    return {
      hasAccess: false,
      canPush: false,
      canAdmin: false,
      error: 'network_error'
    };
  }
}