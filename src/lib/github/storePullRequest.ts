import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { Octokit } from "@octokit/rest";
import { fetchPullRequestContent } from "./pullRequestContent";

export interface PullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    id: number;
    node_id: string;
    html_url: string;
    title: string;
    user: {
      login: string;
      id: number;
    };
    body: string | null;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    merged_at: string | null;
    merge_commit_sha: string | null;
    merged: boolean;
    merged_by: {
      login: string;
      id: number;
    } | null;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
      sha: string;
    };
  };
  repository: {
    id: number;
    full_name: string;
    html_url: string;
  };
}

export async function storePullRequest(
  payload: PullRequestPayload,
  repositoryId: string,
  workspaceId: string,
  githubToken?: string,
): Promise<void> {
  const pr = payload.pull_request;

  console.log("[storePullRequest] Processing merged PR", {
    workspaceId,
    repositoryId,
    prNumber: payload.number,
    prTitle: pr.title,
    mergedAt: pr.merged_at,
    mergedBy: pr.merged_by?.login,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
  });

  const swarm = await db.swarm.findFirst({
    where: {
      workspaceId: workspaceId,
    },
  });

  if (!swarm) {
    console.error("[storePullRequest] Swarm not found", { workspaceId });
    throw new Error("Swarm not found");
  }

  const swarmUrlObj = new URL(swarm.swarmUrl || "");
  let pullRequestUrl = `https://${swarmUrlObj.hostname}:3355/pull_request`;
  if (swarm.swarmUrl?.includes("localhost")) {
    pullRequestUrl = `http://localhost:3355/pull_request`;
  }

  const encryptionService: EncryptionService = EncryptionService.getInstance();
  const decryptedSwarmApiKey = encryptionService.decryptField("swarmApiKey", swarm?.swarmApiKey || "");

  // Fetch detailed PR content if GitHub token is available
  let prDocs: string;
  if (githubToken) {
    try {
      const octokit = new Octokit({ auth: githubToken });

      // Parse owner/repo from repository full_name (e.g., "owner/repo")
      const [owner, repo] = payload.repository.full_name.split("/");

      console.log("[storePullRequest] Fetching PR content", {
        workspaceId,
        prNumber: payload.number,
        owner,
        repo,
      });

      prDocs = await fetchPullRequestContent(octokit, {
        owner,
        repo,
        pull_number: payload.number,
      });

      console.log("[storePullRequest] PR content fetched", {
        workspaceId,
        prNumber: payload.number,
        contentLength: prDocs.length,
      });
    } catch (error) {
      console.error("[storePullRequest] Failed to fetch PR content, using basic info", {
        workspaceId,
        prNumber: payload.number,
        error,
      });
      // Fallback to basic PR info
      prDocs = `# Pull Request #${payload.number}: ${pr.title}\n\nUnable to fetch detailed PR content.`;
    }
  } else {
    console.log("[storePullRequest] No GitHub token available, using basic PR info", {
      workspaceId,
      prNumber: payload.number,
    });
    // Fallback to basic PR info
    prDocs = `# Pull Request #${payload.number}: ${pr.title}\n\n${pr.body || "No description provided."}`;
  }

  // Prepare simplified payload for swarm
  const swarmPayload = {
    number: payload.number,
    name: pr.title,
    docs: prDocs,
  };

  console.log("[storePullRequest] Posting to swarm", {
    workspaceId,
    pullRequestUrl,
    prNumber: payload.number,
    prName: pr.title,
    docsLength: prDocs.length,
  });

  return; // FIXME make a quality AI learning

  const response = await fetch(pullRequestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": decryptedSwarmApiKey,
    },
    body: JSON.stringify(swarmPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[storePullRequest] Failed to post to swarm", {
      workspaceId,
      prNumber: payload.number,
      status: response.status,
      statusText: response.statusText,
      error: errorText,
    });
    throw new Error(`Failed to post PR to swarm: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  console.log("[storePullRequest] Successfully posted to swarm", {
    workspaceId,
    prNumber: payload.number,
    result,
  });
}
