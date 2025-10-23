import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { EncryptionService } from "@/lib/encryption";

export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get("request_id");
    const workspaceId = searchParams.get("workspace_id");

    if (!requestId) {
      return NextResponse.json({ error: "Missing required parameter: request_id" }, { status: 400 });
    }

    if (!workspaceId) {
      return NextResponse.json({ error: "Missing required parameter: workspace_id" }, { status: 400 });
    }

    // Get workspace and validate access
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        ownerId: true,
        members: {
          where: { userId: userOrResponse.id },
          select: { role: true },
        },
        swarm: {
          select: {
            swarmUrl: true,
            swarmApiKey: true,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const isOwner = workspace.ownerId === userOrResponse.id;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!workspace.swarm || !workspace.swarm.swarmUrl) {
      return NextResponse.json({ error: "Swarm not configured for this workspace" }, { status: 400 });
    }

    const encryptionService = EncryptionService.getInstance();
    const decryptedSwarmApiKey = encryptionService.decryptField(
      "swarmApiKey",
      workspace.swarm.swarmApiKey || ""
    );

    // Build swarm URL (port 3355)
    const swarmUrlObj = new URL(workspace.swarm.swarmUrl);
    let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
    if (workspace.swarm.swarmUrl.includes("localhost")) {
      baseSwarmUrl = `http://localhost:3355`;
    }

    // Poll swarm for status (generic - works for any request type)
    const statusResponse = await fetch(`${baseSwarmUrl}/progress?request_id=${requestId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
    });

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error("Swarm status API error:", errorText);
      return NextResponse.json({ error: `Swarm API error: ${statusResponse.status}` }, { status: 500 });
    }

    const statusData = await statusResponse.json();

    // Return raw swarm response (frontend handles the rest)
    return NextResponse.json(statusData);
  } catch (error) {
    console.error("Error checking swarm status:", error);
    return NextResponse.json({ error: "Failed to check swarm status" }, { status: 500 });
  }
}
