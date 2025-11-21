import { NextRequest, NextResponse } from "next/server";
import { getGithubUsernameAndPAT } from "@/lib/auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { repositoryUrl, workspaceId } = body;

    if (!repositoryUrl) {
      return NextResponse.json(
        { error: "repositoryUrl is required" },
        { status: 400 }
      );
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    // Parse owner and repo from repository URL
    const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);

    // Validate workspace access
    const workspaceAccess = await validateWorkspaceAccessById(workspaceId, session.user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 403 }
      );
    }

    // Get workspace slug for GitHub credentials
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true }
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const githubAuth = await getGithubUsernameAndPAT(session.user.id, workspace.slug);

    // Get swarm information
    const swarm = await db.swarm.findFirst({
      where: {
        workspaceId: workspaceId,
      },
    });

    if (!swarm) {
      return NextResponse.json({ error: "Swarm not found" }, { status: 404 });
    }

    const swarmUrlObj = new URL(swarm.swarmUrl || "");
    let gitseeUrl = `https://${swarmUrlObj.hostname}:3355`;
    if (swarm.swarmUrl?.includes("localhost")) {
      gitseeUrl = `http://localhost:3355`;
    }


    // Prepare the gitsee request body matching frontend behavior
    const gitseeRequestBody = {
      owner,
      repo,
      data: ["repo_info", "contributors", "icon", "files", "stats"],
      cloneOptions: githubAuth ? {
        username: githubAuth.username,
        token: githubAuth.token,
      } : undefined,
    };

    const encryptionService: EncryptionService = EncryptionService.getInstance();
    const decryptedSwarmApiKey = encryptionService.decryptField("swarmApiKey", swarm?.swarmApiKey || "");

    console.log(`🚀 Triggering gitsee visualization for ${owner}/${repo}...`);

    // Make request to gitsee server
    const response = await fetch(`${gitseeUrl}/gitsee`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
      body: JSON.stringify(gitseeRequestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`GitSee server error: ${response.status} - ${errorText}`);
      throw new Error(`GitSee server error: ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      message: `Visualization triggered for ${owner}/${repo}`,
      data: {
        owner,
        repo,
        gitseeResponse: data
      }
    });
  } catch (error) {
    console.error("Error triggering gitsee visualization:", error);
    return NextResponse.json(
      {
        error: "Failed to trigger visualization",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}