import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { EncryptionService } from "@/lib/encryption";

export async function GET(request: NextRequest, { params }: { params: Promise<{ featureId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        architectureRequestId: true,
        workspace: {
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
        },
      },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    const isOwner = feature.workspace.ownerId === userOrResponse.id;
    const isMember = feature.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!feature.architectureRequestId) {
      return NextResponse.json({ error: "No architecture generation in progress" }, { status: 400 });
    }

    if (!feature.workspace.swarm || !feature.workspace.swarm.swarmUrl) {
      return NextResponse.json({ error: "Swarm not configured for this workspace" }, { status: 400 });
    }

    const encryptionService = EncryptionService.getInstance();
    const decryptedSwarmApiKey = encryptionService.decryptField(
      "swarmApiKey",
      feature.workspace.swarm.swarmApiKey || "",
    );

    // Build swarm URL (port 3355)
    const swarmUrlObj = new URL(feature.workspace.swarm.swarmUrl);
    let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
    if (feature.workspace.swarm.swarmUrl.includes("localhost")) {
      baseSwarmUrl = `http://localhost:3355`;
    }

    // Poll swarm for status
    const statusResponse = await fetch(`${baseSwarmUrl}/progress?request_id=${feature.architectureRequestId}`, {
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

    // If completed, clear the request_id and update architecture
    if (statusData.status === "completed" && statusData.result?.final_answer) {
      await db.feature.update({
        where: { id: featureId },
        data: {
          architecture: statusData.result.final_answer,
          architectureRequestId: null,
        },
      });

      return NextResponse.json({
        status: "completed",
        architecture: statusData.result.final_answer,
      });
    }

    // If failed, clear the request_id
    if (statusData.status === "failed") {
      await db.feature.update({
        where: { id: featureId },
        data: {
          architectureRequestId: null,
        },
      });

      return NextResponse.json({
        status: "failed",
        error: statusData.error || "Architecture generation failed",
      });
    }

    // Still pending
    return NextResponse.json({
      status: "pending",
    });
  } catch (error) {
    console.error("Error checking architecture status:", error);
    return NextResponse.json({ error: "Failed to check architecture status" }, { status: 500 });
  }
}
