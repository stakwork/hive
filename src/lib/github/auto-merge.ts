import { Octokit } from "@octokit/rest";
import { logger } from "@/lib/logger";

export type MergeMethod = "MERGE" | "SQUASH" | "REBASE";

export interface EnableAutoMergeResult {
  success: boolean;
  error?: string;
}

/**
 * Enable auto-merge on a GitHub pull request using GraphQL API
 * 
 * @param octokit - Authenticated Octokit instance
 * @param pullRequestNodeId - The global node ID of the pull request (not the PR number)
 * @param mergeMethod - The merge method to use when auto-merging (default: SQUASH)
 * @returns Result object with success boolean and optional error message
 */
export async function enablePRAutoMerge(
  octokit: Octokit,
  pullRequestNodeId: string,
  mergeMethod: MergeMethod = "SQUASH"
): Promise<EnableAutoMergeResult> {
  try {
    logger.info("Attempting to enable auto-merge", "AutoMerge", {
      pullRequestNodeId,
      mergeMethod,
    });

    const mutation = `
      mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
        enablePullRequestAutoMerge(input: {
          pullRequestId: $pullRequestId
          mergeMethod: $mergeMethod
        }) {
          pullRequest {
            id
            autoMergeRequest {
              enabledAt
              enabledBy {
                login
              }
            }
          }
        }
      }
    `;

    const variables = {
      pullRequestId: pullRequestNodeId,
      mergeMethod,
    };

    const response = await octokit.graphql<{
      enablePullRequestAutoMerge: {
        pullRequest: {
          id: string;
          autoMergeRequest: {
            enabledAt: string;
            enabledBy: {
              login: string;
            };
          } | null;
        };
      };
    }>(mutation, variables);

    if (response.enablePullRequestAutoMerge?.pullRequest?.autoMergeRequest) {
      logger.info("Successfully enabled auto-merge", "AutoMerge", {
        pullRequestNodeId,
        enabledAt: response.enablePullRequestAutoMerge.pullRequest.autoMergeRequest.enabledAt,
        enabledBy: response.enablePullRequestAutoMerge.pullRequest.autoMergeRequest.enabledBy.login,
      });
      return { success: true };
    }

    logger.warn("Auto-merge request completed but no autoMergeRequest in response", "AutoMerge", {
      pullRequestNodeId,
    });
    return { success: false, error: "unknown_error" };

  } catch (error: unknown) {
    // Handle GraphQL errors
    if (error && typeof error === "object" && "errors" in error) {
      const graphqlError = error as { errors: Array<{ message: string; type?: string }> };
      const errorMessage = graphqlError.errors[0]?.message || "Unknown GraphQL error";
      const errorType = graphqlError.errors[0]?.type;

      logger.warn("GraphQL error enabling auto-merge", "AutoMerge", {
        pullRequestNodeId,
        errorMessage,
        errorType,
      });

      // Map common error messages to error codes
      if (errorMessage.includes("branch protection") || errorMessage.includes("required status checks")) {
        return { success: false, error: "branch_protection_disabled" };
      }

      if (errorMessage.includes("permission") || errorMessage.includes("authorized")) {
        return { success: false, error: "insufficient_permissions" };
      }

      if (errorMessage.includes("merged") || errorMessage.includes("closed") || errorMessage.includes("state")) {
        return { success: false, error: "invalid_state" };
      }

      return { success: false, error: errorMessage };
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Unexpected error enabling auto-merge", "AutoMerge", {
      pullRequestNodeId,
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}
