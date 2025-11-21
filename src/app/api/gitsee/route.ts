import { NextRequest, NextResponse } from "next/server";
import { getGithubUsernameAndPAT } from "@/lib/auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccessById } from "@/services/workspace";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Get the request body from frontend
    const body = await request.json();

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing required parameter: workspaceId" },
        { status: 400 }
      );
    }

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

    // Add authentication to the request if needed
    if (githubAuth) {
      body.cloneOptions = {
        username: githubAuth.username,
        token: githubAuth.token,
        ...body.cloneOptions, // Allow frontend to override/add branch etc.
      };
    }

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

    const encryptionService: EncryptionService = EncryptionService.getInstance();
    const decryptedSwarmApiKey = encryptionService.decryptField("swarmApiKey", swarm?.swarmApiKey || "");
    // Proxy to your EC2 GitSee server
    console.log("=> gitseeUrl", gitseeUrl);

    const response = await fetch(`${gitseeUrl}/gitsee`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`EC2 server error: ${response.status}`);
    }

    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    console.error("Proxy error:", error);
    return Response.json({ error: "Failed to fetch repository data" }, { status: 500 });
  }
}
