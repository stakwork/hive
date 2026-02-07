import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { type ApiError } from "@/types";
import { getPodDetails, POD_PORTS, buildPodUrl } from "@/lib/pods";
import { getUserAppTokens } from "@/lib/githubApp";
import { enablePRAutoMerge, getOctokitForWorkspace, parsePRUrl } from "@/lib/github";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId, taskId, commitMessage, branchName } = body;

    // Validate required fields
    if (!workspaceId) {
      return NextResponse.json({ error: "Missing required field: workspaceId" }, { status: 400 });
    }

    if (!taskId) {
      return NextResponse.json({ error: "Missing required field: taskId" }, { status: 400 });
    }

    if (!commitMessage) {
      return NextResponse.json({ error: "Missing required field: commitMessage" }, { status: 400 });
    }

    if (!branchName) {
      return NextResponse.json({ error: "Missing required field: branchName" }, { status: 400 });
    }

    // Fetch podId from task record
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { podId: true },
    });

    if (!task?.podId) {
      return NextResponse.json({ error: "No pod assigned to this task" }, { status: 400 });
    }

    const podId = task.podId;

    // Verify user has access to the workspace
    const workspace = await db.workspace.findFirst({
      where: { id: workspaceId },
      include: {
        owner: true,
        members: {
          where: { userId },
          select: { role: true },
        },
        swarm: true,
        repositories: true,
        sourceControlOrg: true,
      },
    });

    // Get user's GitHub auth info for username
    const userGithubAuth = await db.gitHubAuth.findUnique({
      where: { userId },
      select: { githubUsername: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (process.env.MOCK_BROWSER_URL) {
      return NextResponse.json({ success: true, message: "Commit successful (mock)" }, { status: 200 });
    }

    // Mock PR response for testing when CUSTOM_GOOSE_URL is set
    if (process.env.CUSTOM_GOOSE_URL) {
      return NextResponse.json(
        {
          success: true,
          message: "Commit and push successful",
          data: {
            prs: {
              "stakwork/hive": "https://github.com/stakwork/hive/pull/1634",
            },
          },
        },
        { status: 200 },
      );
    }

    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check if workspace has a swarm
    if (!workspace.swarm) {
      return NextResponse.json({ error: "No swarm found for this workspace" }, { status: 404 });
    }

    console.log(">>> Getting pod details for commit operation");

    // Fetch pod details to get port mappings and password
    const podDetails = await getPodDetails(podId);

    if (!podDetails) {
      return NextResponse.json({ error: "Pod not found" }, { status: 404 });
    }

    const { podId: podIdentifier, password, portMappings } = podDetails;

    if (!password) {
      return NextResponse.json({ error: "Pod password not found" }, { status: 500 });
    }

    if (!portMappings) {
      return NextResponse.json({ error: "Pod port mappings not found" }, { status: 500 });
    }

    const controlPort = parseInt(POD_PORTS.CONTROL, 10);
    if (!portMappings.includes(controlPort)) {
      return NextResponse.json(
        { error: `Control port (${POD_PORTS.CONTROL}) not found in port mappings` },
        { status: 500 },
      );
    }

    const controlPortUrl = buildPodUrl(podIdentifier, POD_PORTS.CONTROL);

    console.log(">>> Using commit message:", commitMessage);
    console.log(">>> Using branch name:", branchName);

    // Get GitHub access token for authentication
    let githubToken: string | undefined;
    if (workspace.sourceControlOrg) {
      console.log(
        ">>> Getting user app token for workspace source control org:",
        userGithubAuth?.githubUsername,
        ",",
        workspace.sourceControlOrg.githubLogin,
      );
      const tokens = await getUserAppTokens(userId, workspace.sourceControlOrg.githubLogin);
      githubToken = tokens?.accessToken;

      if (!githubToken) {
        console.warn("No GitHub access token found for workspace source control org");
        return NextResponse.json(
          { error: "GitHub authentication required. Please reconnect your GitHub account." },
          { status: 401 },
        );
      }
    } else {
      console.warn("Workspace has no source control org linked");
      return NextResponse.json({ error: "No GitHub organization linked to this workspace" }, { status: 400 });
    }

    // Get GitHub username
    if (!userGithubAuth?.githubUsername) {
      console.warn("No GitHub username found for user");
      return NextResponse.json(
        { error: "GitHub username not found. Please reconnect your GitHub account." },
        { status: 401 },
      );
    }

    const repositories = workspace.repositories.map((repo) => ({
      url: repo.repositoryUrl,
      commit_name: commitMessage,
      branch_name: branchName,
      base_branch: repo.branch,
    }));

    const commitPayload = {
      repos: repositories,
      git_credentials: {
        provider: "github",
        auth_type: "app",
        auth_data: {
          token: githubToken,
          username: userGithubAuth.githubUsername,
        },
      },
    };

    console.log(">>> Commit payload:", commitPayload);
    console.log(">>> Posting to control port:", controlPortUrl);

    // Check if task already has a PullRequest artifact in chat history
    const existingPullRequest = await db.artifact.findFirst({
      where: {
        message: {
          taskId: taskId,
        },
        type: "PULL_REQUEST",
      },
    });

    // POST to /push on the control port with the same payload
    // If a PR already exists, stay on current branch instead of creating a new one
    const stayOnBranch = existingPullRequest ? "&stayOnCurrentBranch=true" : "";
    const pushUrl = `${controlPortUrl}/push?pr=true&commit=true${stayOnBranch}&label=agent`;
    console.log(
      ">>> Push URL:",
      pushUrl,
      existingPullRequest ? "(staying on current branch)" : "(creating new branch)",
    );
    const pushResponse = await fetch(pushUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${podDetails.password}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commitPayload),
    });

    if (!pushResponse.ok) {
      const errorText = await pushResponse.text();
      console.error(`Failed to push: ${pushResponse.status} - ${errorText}`);
      return NextResponse.json(
        { error: `Failed to push: ${pushResponse.status}`, details: errorText },
        { status: pushResponse.status },
      );
    }

    const pushData = await pushResponse.json();
    console.log(">>> Push successful:", pushData);

    // Handle auto-merge if task has autoMerge enabled and PR was created
    if (pushData.prs && Object.keys(pushData.prs).length > 0 && !existingPullRequest) {
      try {
        // Query task for autoMerge field
        const taskWithAutoMerge = await db.task.findUnique({
          where: { id: taskId },
          select: { autoMerge: true, workspaceId: true },
        });

        if (taskWithAutoMerge?.autoMerge === true) {
          // Get the first PR URL from the response
          const prUrl = Object.values(pushData.prs)[0] as string;
          logger.info("Task has auto-merge enabled, processing PR", "AutoMerge", { taskId, prUrl });

          // Parse PR URL to extract owner, repo, and PR number
          const prInfo = parsePRUrl(prUrl);
          if (!prInfo) {
            logger.warn("Failed to parse PR URL", "AutoMerge", { taskId, prUrl });
          } else {
            const { owner, repo, prNumber } = prInfo;
            
            // Get Octokit instance for the workspace
            const octokit = await getOctokitForWorkspace(userId, owner);
            if (!octokit) {
              logger.warn("Failed to get Octokit instance", "AutoMerge", { taskId, owner });
            } else {
              // Fetch PR details to get node_id
              try {
                const { data: pr } = await octokit.rest.pulls.get({
                  owner,
                  repo,
                  pull_number: prNumber,
                });

                // Enable auto-merge
                const result = await enablePRAutoMerge(octokit, pr.node_id, "SQUASH");
                
                if (result.success) {
                  logger.info("Successfully enabled auto-merge for PR", "AutoMerge", {
                    taskId,
                    prUrl,
                    prNumber,
                  });
                } else {
                  logger.warn("Failed to enable auto-merge for PR", "AutoMerge", {
                    taskId,
                    prUrl,
                    prNumber,
                    error: result.error,
                  });
                }
              } catch (prError) {
                logger.error("Error fetching PR details or enabling auto-merge", "AutoMerge", {
                  taskId,
                  prUrl,
                  error: prError instanceof Error ? prError.message : String(prError),
                });
              }
            }
          }
        }
      } catch (autoMergeError) {
        // Log but don't fail the request - graceful degradation
        logger.error("Error processing auto-merge", "AutoMerge", {
          taskId,
          error: autoMergeError instanceof Error ? autoMergeError.message : String(autoMergeError),
        });
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: "Commit and push successful",
        data: {
          prs: pushData.prs || {},
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error committing:", error);

    // Handle ApiError specifically
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          error: apiError.message,
          service: apiError.service,
          details: apiError.details,
        },
        { status: apiError.status },
      );
    }

    return NextResponse.json({ error: "Failed to commit" }, { status: 500 });
  }
}
