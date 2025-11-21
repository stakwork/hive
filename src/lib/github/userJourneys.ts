import { Octokit } from "@octokit/rest";

interface TaskWithPR {
  id: string;
  testFilePath: string | null;
  chatMessages?: {
    artifacts?: {
      content?: {
        url?: string;
        status?: string;
      };
    }[];
  }[];
}

interface E2eTestNode {
  ref_id: string;
  properties: {
    name: string;
    file: string;
    body?: string;
  };
}

/**
 * Get PR status from GitHub API
 * @param prUrl - Full PR URL (e.g., https://github.com/owner/repo/pull/123)
 * @param githubToken - User's GitHub access token
 * @returns PR status: open | merged | closed
 */
export async function getPRStatus(prUrl: string, githubToken: string): Promise<"open" | "merged" | "closed"> {
  try {
    const octokit = new Octokit({ auth: githubToken });

    // Parse PR URL: https://github.com/owner/repo/pull/123
    const urlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!urlMatch) {
      throw new Error(`Invalid PR URL format: ${prUrl}`);
    }

    const [, owner, repo, prNumberStr] = urlMatch;
    const pull_number = parseInt(prNumberStr, 10);

    console.log("[getPRStatus] Fetching PR status", { owner, repo, pull_number });

    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number,
    });

    // Determine status
    if (pr.merged_at) {
      return "merged";
    } else if (pr.state === "open") {
      return "open";
    } else {
      return "closed";
    }
  } catch (error) {
    console.error("[getPRStatus] Error fetching PR status", { prUrl, error });
    throw error;
  }
}

/**
 * Get list of files changed in a PR
 * @param prUrl - Full PR URL
 * @param githubToken - User's GitHub access token
 * @returns Array of file paths changed in PR
 */
export async function getPRChangedFiles(prUrl: string, githubToken: string): Promise<string[]> {
  try {
    const octokit = new Octokit({ auth: githubToken });

    // Parse PR URL
    const urlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!urlMatch) {
      throw new Error(`Invalid PR URL format: ${prUrl}`);
    }

    const [, owner, repo, prNumberStr] = urlMatch;
    const pull_number = parseInt(prNumberStr, 10);

    console.log("[getPRChangedFiles] Fetching changed files", {
      owner,
      repo,
      pull_number,
    });

    // Fetch all files changed in the PR
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number,
      per_page: 100, // Max per page
    });

    const filePaths = files.map((file) => file.filename);

    console.log("[getPRChangedFiles] Found changed files", {
      owner,
      repo,
      pull_number,
      count: filePaths.length,
      files: filePaths,
    });

    return filePaths;
  } catch (error) {
    console.error("[getPRChangedFiles] Error fetching changed files", {
      prUrl,
      error,
    });
    throw error;
  }
}

/**
 * Match task to graph node via PR correlation
 * Used when testFilePath doesn't match (handles path changes during workflow)
 * @param task - Task with merged PR artifact
 * @param graphNodes - All graph nodes for workspace
 * @param githubToken - User's GitHub access token
 * @returns Matching graph node or null
 */
export async function matchTaskToGraphViaPR(
  task: TaskWithPR,
  graphNodes: E2eTestNode[],
  githubToken: string,
): Promise<E2eTestNode | null> {
  try {
    // Extract PR URL from task artifact
    const prArtifact = task.chatMessages?.[0]?.artifacts?.[0];
    if (!prArtifact?.content?.url) {
      console.log("[matchTaskToGraphViaPR] No PR URL in task", { taskId: task.id });
      return null;
    }

    const prUrl = prArtifact.content.url;
    const prStatus = prArtifact.content.status;

    // Only match merged PRs
    if (prStatus !== "DONE") {
      console.log("[matchTaskToGraphViaPR] PR not merged", {
        taskId: task.id,
        prUrl,
        prStatus,
      });
      return null;
    }

    console.log("[matchTaskToGraphViaPR] Matching task to graph via PR", {
      taskId: task.id,
      prUrl,
      originalPath: task.testFilePath,
    });

    // Get files changed in PR
    const changedFiles = await getPRChangedFiles(prUrl, githubToken);

    // Filter to test files (common E2E patterns)
    const testFiles = changedFiles.filter(
      (file) => file.includes("e2e") || file.includes("test") || file.includes(".spec.") || file.includes(".test."),
    );

    console.log("[matchTaskToGraphViaPR] Found test files in PR", {
      taskId: task.id,
      prUrl,
      testFilesCount: testFiles.length,
      testFiles,
    });

    // Try to match with graph nodes
    for (const testFile of testFiles) {
      const matchingNode = graphNodes.find((node) => node.properties.file === testFile);
      if (matchingNode) {
        console.log("[matchTaskToGraphViaPR] Matched task to graph node", {
          taskId: task.id,
          prUrl,
          originalPath: task.testFilePath,
          graphFile: matchingNode.properties.file,
          nodeId: matchingNode.ref_id,
        });
        return matchingNode;
      }
    }

    console.log("[matchTaskToGraphViaPR] No matching graph node found", {
      taskId: task.id,
      prUrl,
      testFiles,
      graphNodeCount: graphNodes.length,
    });

    return null;
  } catch (error) {
    console.error("[matchTaskToGraphViaPR] Error matching task to graph", {
      taskId: task.id,
      error,
    });
    return null;
  }
}
