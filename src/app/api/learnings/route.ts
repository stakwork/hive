import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");
    const question = searchParams.get("question");

    if (!workspaceSlug) {
      return NextResponse.json(
        { error: "Missing required parameter: workspace" },
        { status: 400 }
      );
    }

    // Validate workspace access
    const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, session.user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 403 }
      );
    }

    // Get swarm data for the workspace
    const swarm = await db.swarm.findFirst({
      where: {
        workspaceId: workspaceAccess.workspace?.id,
      },
    });

    if (!swarm) {
      return NextResponse.json(
        { error: "Swarm not found for this workspace" },
        { status: 404 }
      );
    }

    if (!swarm.swarmUrl) {
      return NextResponse.json(
        { error: "Swarm URL not configured" },
        { status: 404 }
      );
    }

    // Decrypt swarm API key
    const encryptionService: EncryptionService = EncryptionService.getInstance();
    const decryptedSwarmApiKey = encryptionService.decryptField(
      "swarmApiKey",
      swarm.swarmApiKey || ""
    );

    // Construct swarm URL (port 3355 as specified)
    const swarmUrlObj = new URL(swarm.swarmUrl);
    let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
    if (swarm.swarmUrl.includes("localhost")) {
      baseSwarmUrl = `http://localhost:3355`;
    }

    // Proxy request to swarm /learnings endpoint
    let swarmUrl = `${baseSwarmUrl}/learnings`;
    if (question) {
      swarmUrl += `?question=${encodeURIComponent(question)}`;
    }

    const response = await fetch(swarmUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Swarm server error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Learnings API proxy error:", error);
    return NextResponse.json(
      { error: "Failed to fetch learnings data" },
      { status: 500 }
    );
  }
}