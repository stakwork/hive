/**
 * GitHub OAuth Repository Access Check
 *
 * This module provides functionality to check repository access
 * using GitHub OAuth tokens (not GitHub App installation tokens).
 * Used during the OAuth callback flow to verify repository permissions.
 */

import { serviceConfigs } from "@/config/services";

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
 * Check repository access using GitHub OAuth token
 * @param accessToken - GitHub OAuth access token
 * @param repoUrl - Repository URL (https:// or git@)
 * @returns Repository access information including push permissions
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
    const response = await fetch(`${serviceConfigs.github.baseURL}/repos/${owner}/${repo}`, {
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
