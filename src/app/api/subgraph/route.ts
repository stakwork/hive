import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { checkIsSuperAdmin } from "@/lib/middleware/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");
    const refId = searchParams.get("ref_id");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    const userId = (session.user as { id: string }).id;
    const isSuperAdmin = await checkIsSuperAdmin(userId);

    // Validate workspace access
    const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, userId, true, { isSuperAdmin });
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

    // Build the nodes endpoint URL with optional ref_id filter
    let nodesUrl = `${baseSwarmUrl}/subgraph`;
    if (refId) {
      nodesUrl += `?ref_id=${encodeURIComponent(refId)}`;
    }

    // console.log("Fetching nodes from:", nodesUrl);

    // Fetch nodes from swarm
    const response = await fetch(nodesUrl, {
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
    console.error("Nodes API proxy error:", error);
    return NextResponse.json({ error: "Failed to fetch nodes" }, { status: 500 });
  }
}
