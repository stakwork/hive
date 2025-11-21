import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const question = searchParams.get("question");
    const workspaceSlug = searchParams.get("workspace");

    if (!question) {
      return NextResponse.json({ error: "Missing required parameter: question" }, { status: 400 });
    }

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    // Validate workspace access
    const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, session.user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
    }

    // Get swarm data for the workspace
    const swarm = await db.swarm.findFirst({
      where: {
        workspaceId: workspaceAccess.workspace?.id,
      },
    });

    if (!swarm) {
      return NextResponse.json({ error: "Swarm not found for this workspace" }, { status: 404 });
    }

    if (!swarm.swarmUrl) {
      return NextResponse.json({ error: "Swarm URL not configured" }, { status: 404 });
    }

    // Decrypt swarm API key
    const encryptionService: EncryptionService = EncryptionService.getInstance();
    const decryptedSwarmApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey || "");

    // Construct swarm URL
    const swarmUrlObj = new URL(swarm.swarmUrl);
    let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
    if (swarm.swarmUrl.includes("localhost")) {
      baseSwarmUrl = `http://localhost:3355`;
    }

    console.log("baseSwarmUrl", baseSwarmUrl);
    console.log("decryptedSwarmApiKey", decryptedSwarmApiKey);
    console.log("question", question);

    // Proxy request to swarm /ask endpoint
    const response = await fetch(`${baseSwarmUrl}/ask?question=${encodeURIComponent(question)}`, {
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
    console.error("Ask API proxy error:", error);
    return NextResponse.json({ error: "Failed to process question" }, { status: 500 });
  }
}
