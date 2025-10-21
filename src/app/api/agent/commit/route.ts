import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { type ApiError } from "@/types";
import { getPodFromPool, POD_PORTS } from "@/lib/pods";

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
    const { podId, workspaceId, taskId, commitMessage, branchName } = body;

    // Validate required fields
    if (!podId) {
      return NextResponse.json({ error: "Missing required field: podId" }, { status: 400 });
    }

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
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (process.env.MOCK_BROWSER_URL) {
      return NextResponse.json({ success: true, message: "Commit successful (mock)" }, { status: 200 });
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

    const repositories = workspace.repositories.map((repo) => ({
      url: repo.repositoryUrl,
      commit_name: commitMessage,
      branch_name: branchName,
    }));

    const commitPayload = {
      repos: repositories,
    };

    console.log(">>> Commit payload:", commitPayload);
    console.log(">>> Posting to control port:", controlPortUrl);

    // POST to /commit on the control port
    const commitUrl = `${controlPortUrl}/commit`;
    const commitResponse = await fetch(commitUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${podWorkspace.password}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commitPayload),
    });

    if (!commitResponse.ok) {
      const errorText = await commitResponse.text();
      console.error(`Failed to commit: ${commitResponse.status} - ${errorText}`);
      return NextResponse.json(
        { error: `Failed to commit: ${commitResponse.status}`, details: errorText },
        { status: commitResponse.status },
      );
    }

    const commitData = await commitResponse.json();
    console.log(">>> Commit successful:", commitData);

    // POST to /push on the control port with the same payload
    const pushUrl = `${controlPortUrl}/push`;
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

    // Extract commits array from response
    // The control port /push endpoint returns { commits: string[] }
    // where each string is a GitHub commit URL with embedded token
    const rawCommits = Array.isArray(pushData.commits) ? pushData.commits : [];

    // Transform commit URLs into PR comparison URLs
    // Input: https://ghu_token@github.com/owner/repo/commit/hash
    // Output: https://github.com/owner/repo/compare/main...branchName
    const prUrls = rawCommits
      .map((commitUrl: string) => {
        try {
          // Remove token from URL
          const cleanUrl = commitUrl.replace(/https:\/\/[^@]+@/, "https://");
          // Parse the URL to extract owner/repo
          // Format: https://github.com/owner/repo/commit/hash
          const match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/commit/);
          if (match) {
            const [, owner, repo] = match;
            // Get the base branch from the repository (default to 'main')
            const repository = workspace.repositories.find((r) => r.repositoryUrl.includes(`${owner}/${repo}`));
            const baseBranch = repository?.branch || "main";
            // Create PR comparison URL
            return `https://github.com/${owner}/${repo}/compare/${baseBranch}...${branchName}`;
          }
          return null;
        } catch (error) {
          console.error("Error parsing commit URL:", commitUrl, error);
          return null;
        }
      })
      .filter((url: string | null): url is string => url !== null);

    return NextResponse.json(
      {
        success: true,
        message: "Commit and push successful",
        data: {
          prUrls,
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
