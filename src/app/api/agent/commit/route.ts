import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { type ApiError } from "@/types";
import { getPodFromPool, POD_PORTS } from "@/lib/pods";
import { getUserAppTokens } from "@/lib/githubApp";

const encryptionService: EncryptionService = EncryptionService.getInstance();

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

    const poolApiKey = workspace.swarm.poolApiKey;

    // Check if swarm has pool configuration
    if (!poolApiKey) {
      return NextResponse.json({ error: "Swarm not properly configured with pool information" }, { status: 400 });
    }

    const poolApiKeyPlain = encryptionService.decryptField("poolApiKey", poolApiKey);

    console.log(">>> Getting pod from pool for commit operation");

    // Fetch pod details to get port mappings and password
    const podWorkspace = await getPodFromPool(podId, poolApiKeyPlain);
    const controlPortUrl = podWorkspace.portMappings[POD_PORTS.CONTROL];

    if (!controlPortUrl) {
      return NextResponse.json(
        { error: `Control port (${POD_PORTS.CONTROL}) not found in port mappings` },
        { status: 500 },
      );
    }

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
    const pushUrl = `${controlPortUrl}/push?pr=true&commit=true${stayOnBranch}`;
    console.log(">>> Push URL:", pushUrl, existingPullRequest ? "(staying on current branch)" : "(creating new branch)");
    const pushResponse = await fetch(pushUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${podWorkspace.password}`,
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
