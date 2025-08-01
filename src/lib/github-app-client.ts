/**
 * Utility functions for GitHub App integration in client-side components
 */

export interface GitHubAppTokenResponse {
  success: boolean;
  accessToken?: string;
  installationId?: number;
  repository?: string;
  expiresIn?: number;
  message?: string;
  error?: string;
  installed?: boolean;
}

export interface GitHubAppInstallationStatus {
  installed: boolean;
  installationId?: number;
  installationUrl: string;
  repository: string;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string;
  html_url: string;
  state: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
}

export interface GitHubCommitResult {
  commit: {
    sha: string;
    message: string;
  };
  branch: string;
  files: number;
}

/**
 * Check if a repository has the GitHub App installed
 */
export async function checkRepositoryInstallation(
  repositoryFullName: string,
): Promise<GitHubAppInstallationStatus> {
  const response = await fetch(
    `/api/github/app/installation-status?repository=${encodeURIComponent(repositoryFullName)}`,
  );

  if (!response.ok) {
    throw new Error(
      `Failed to check installation status: ${response.statusText}`,
    );
  }

  return response.json();
}

/**
 * Generate a GitHub App installation access token for a repository
 * This token can be used to make authenticated requests to the GitHub API
 * on behalf of the installed app with repository permissions.
 */
export async function generateGitHubAppToken(
  repositoryFullName: string,
): Promise<GitHubAppTokenResponse> {
  const response = await fetch("/api/github/app/generate-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      repositoryFullName,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || `Failed to generate token: ${response.statusText}`,
    );
  }

  return data;
}

/**
 * Create a pull request using GitHub App token
 */
export async function createPullRequest(
  repositoryFullName: string,
  options: {
    title: string;
    body: string;
    head: string;
    base: string;
  },
): Promise<GitHubPullRequest> {
  // First, get the GitHub App token
  const tokenResponse = await generateGitHubAppToken(repositoryFullName);

  if (!tokenResponse.success || !tokenResponse.accessToken) {
    throw new Error(tokenResponse.error || "Failed to get GitHub App token");
  }

  const [owner, repo] = repositoryFullName.split("/");

  // Create the pull request using GitHub API
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResponse.accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.message || `Failed to create pull request: ${response.statusText}`,
    );
  }

  return response.json();
}

/**
 * Push files to a repository using GitHub App token
 */
export async function pushFilesToRepository(
  repositoryFullName: string,
  files: { path: string; content: string }[],
  options: {
    message: string;
    branch: string;
    baseBranch?: string;
  },
): Promise<GitHubCommitResult> {
  // First, get the GitHub App token
  const tokenResponse = await generateGitHubAppToken(repositoryFullName);

  if (!tokenResponse.success || !tokenResponse.accessToken) {
    throw new Error(tokenResponse.error || "Failed to get GitHub App token");
  }

  const [owner, repo] = repositoryFullName.split("/");
  const headers = {
    Authorization: `Bearer ${tokenResponse.accessToken}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };

  // Get the base branch SHA
  const baseBranch = options.baseBranch || "main";
  const branchResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`,
    { headers },
  );

  if (!branchResponse.ok) {
    throw new Error(`Failed to get base branch: ${branchResponse.statusText}`);
  }

  const branchData = await branchResponse.json();
  const baseSha = branchData.object.sha;

  // Create new branch if it doesn't exist
  if (options.branch !== baseBranch) {
    try {
      await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ref: `refs/heads/${options.branch}`,
          sha: baseSha,
        }),
      });
    } catch (error) {
      // Branch might already exist, that's okay
      console.log("Branch might already exist:", error);
    }
  }

  // Get the tree for the current commit
  const commitResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${baseSha}`,
    { headers },
  );

  if (!commitResponse.ok) {
    throw new Error(`Failed to get commit: ${commitResponse.statusText}`);
  }

  const commitData = await commitResponse.json();
  const treeSha = commitData.tree.sha;

  // Create blobs for each file
  const blobs = await Promise.all(
    files.map(async (file) => {
      const blobResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            content: Buffer.from(file.content).toString("base64"),
            encoding: "base64",
          }),
        },
      );

      if (!blobResponse.ok) {
        throw new Error(
          `Failed to create blob for ${file.path}: ${blobResponse.statusText}`,
        );
      }

      const blobData = await blobResponse.json();
      return {
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blobData.sha,
      };
    }),
  );

  // Create new tree
  const treeResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        base_tree: treeSha,
        tree: blobs,
      }),
    },
  );

  if (!treeResponse.ok) {
    throw new Error(`Failed to create tree: ${treeResponse.statusText}`);
  }

  const newTreeData = await treeResponse.json();

  // Create new commit
  const newCommitResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: options.message,
        tree: newTreeData.sha,
        parents: [baseSha],
      }),
    },
  );

  if (!newCommitResponse.ok) {
    throw new Error(`Failed to create commit: ${newCommitResponse.statusText}`);
  }

  const newCommitData = await newCommitResponse.json();

  // Update the branch reference
  const refResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${options.branch}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        sha: newCommitData.sha,
      }),
    },
  );

  if (!refResponse.ok) {
    throw new Error(`Failed to update branch: ${refResponse.statusText}`);
  }

  return {
    commit: newCommitData,
    branch: options.branch,
    files: files.length,
  };
}
