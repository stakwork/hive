import { BaseServiceClass } from "@/lib/base-service";
import type { ServiceConfig } from "@/types";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

export class PullRequestService extends BaseServiceClass {
  public readonly serviceName = "githubPullRequest";

  constructor(config: ServiceConfig) {
    super(config);
  }

  /**
   * Add a label to a pull request
   */
  async addLabelToPullRequest({
    userId,
    workspaceSlug,
    repositoryUrl,
    prNumber,
    label,
  }: {
    userId: string;
    workspaceSlug: string;
    repositoryUrl: string;
    prNumber: number;
    label: string;
  }): Promise<void> {
    const githubProfile = await getGithubUsernameAndPAT(userId, workspaceSlug);
    if (!githubProfile?.token) {
      throw new Error("GitHub access token not found for user");
    }

    const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);

    // First, ensure the label exists in the repository
    await this.ensureLabelExists(githubProfile.token, owner, repo, label);

    // Then add the label to the PR
    const response = await fetch(
      `${this.config.baseURL}/repos/${owner}/${repo}/issues/${prNumber}/labels`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${githubProfile.token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          labels: [label],
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to add label to PR:", {
        status: response.status,
        error: errorText,
        prNumber,
        label,
      });
      
      if (response.status === 403) {
        throw new Error("INSUFFICIENT_PERMISSIONS");
      }
      throw new Error(`Failed to add label to PR: ${response.status}`);
    }

    console.log(`Successfully added label "${label}" to PR #${prNumber}`, {
      owner,
      repo,
      prNumber,
    });
  }

  /**
   * Ensure a label exists in the repository, create it if it doesn't
   */
  private async ensureLabelExists(
    token: string,
    owner: string,
    repo: string,
    labelName: string,
  ): Promise<void> {
    // Check if label exists
    const checkResponse = await fetch(
      `${this.config.baseURL}/repos/${owner}/${repo}/labels/${labelName}`,
      {
        method: "GET",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (checkResponse.ok) {
      // Label already exists
      return;
    }

    if (checkResponse.status === 404) {
      // Label doesn't exist, create it
      const createResponse = await fetch(
        `${this.config.baseURL}/repos/${owner}/${repo}/labels`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: labelName,
            color: "0E8A16", // Green color for janitor label
            description: "Pull request created by Hive Janitor",
          }),
        },
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error("Failed to create label:", {
          status: createResponse.status,
          error: errorText,
          labelName,
        });
        // Don't throw here - we'll try to add the label anyway
        // in case it was created by another process
      } else {
        console.log(`Created label "${labelName}" in ${owner}/${repo}`);
      }
    }
  }

  /**
   * Get pull request details
   */
  async getPullRequest({
    userId,
    workspaceSlug,
    repositoryUrl,
    prNumber,
  }: {
    userId: string;
    workspaceSlug: string;
    repositoryUrl: string;
    prNumber: number;
  }): Promise<any> {
    const githubProfile = await getGithubUsernameAndPAT(userId, workspaceSlug);
    if (!githubProfile?.token) {
      throw new Error("GitHub access token not found for user");
    }

    const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);

    const response = await fetch(
      `${this.config.baseURL}/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        method: "GET",
        headers: {
          Authorization: `token ${githubProfile.token}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to get PR details:", {
        status: response.status,
        error: errorText,
        prNumber,
      });
      throw new Error(`Failed to get PR details: ${response.status}`);
    }

    return await response.json();
  }
}
