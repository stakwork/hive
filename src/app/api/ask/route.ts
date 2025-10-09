import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const question = searchParams.get("question");
    const workspaceSlug = searchParams.get("workspace");

    if (!question) {
      return NextResponse.json({ error: "Missing required parameter: question" }, { status: 400 });
    }

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    // Get workspaceId and userId from headers (injected by middleware)
    const workspaceIdRaw = request.headers.get("x-middleware-workspace-id");
    const workspaceId = workspaceIdRaw || undefined;

    // Get swarm data for the workspace
    const swarm = await db.swarm.findFirst({
      where: {
        workspaceId: workspaceId,
      },
    });

    if (!swarm) {
      return NextResponse.json({ error: "Swarm not found for this workspace" }, { status: 404 });
    }

    if (!swarm.swarmUrl) {
      return NextResponse.json({ error: "Swarm URL not configured" }, { status: 404 });
    }

    const encryptionService: EncryptionService = EncryptionService.getInstance();
    const decryptedSwarmApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey || "");

    const swarmUrlObj = new URL(swarm.swarmUrl);
    let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
    if (swarm.swarmUrl.includes("localhost")) {
      baseSwarmUrl = `http://localhost:3355`;
    }

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
    return NextResponse.json({ error: "Failed to process question : " + error }, { status: 500 });
  }
}
