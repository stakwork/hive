/**
 * GitHub repository permissions checker
 * Extracted from API route for reuse and better testability
 */

export async function checkRepositoryPermissions(accessToken: string, repoUrl: string): Promise<{
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
}> {
  try {
    // Extract owner/repo from URL
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

    // Check repository access and permissions
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (response.ok) {
      const repositoryData = await response.json();

      // Parse permissions
      const permissions = repositoryData.permissions || {};
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
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'repository_not_found_or_no_access'
      };
    } else if (response.status === 403) {
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'access_forbidden'
      };
    } else {
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
