import { NextRequest, NextResponse } from "next/server";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const swarmId = searchParams.get("swarmId");
    const workspaceId = searchParams.get("workspaceId");

    if (!id) {
      return NextResponse.json({ success: false, message: "Missing required fields: id" }, { status: 400 });
    }

    const where: Record<string, string> = {};
    if (swarmId) where.swarmId = swarmId;
    if (!swarmId && workspaceId) where.workspaceId = workspaceId;

    const swarm = await db.swarm.findFirst({ where });
    if (!swarm) {
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }
    if (!swarm.name || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false, message: "Swarm not configured (name/api key)" }, { status: 400 });
    }

    if (bearerToken) {
      const decryptedKey = EncryptionService.getInstance().decryptField("swarmApiKey", swarm.swarmApiKey);
      if (bearerToken !== decryptedKey) {
        return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
      }
    } else {
      const context = getMiddlewareContext(request);
      const userOrResponse = requireAuth(context);
      if (userOrResponse instanceof NextResponse) return userOrResponse;
    }

    const stakgraphUrl = `https://${getSwarmVanityAddress(swarm.name)}:7799`;
    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: `/status/${id}`,
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
    });

    return NextResponse.json({ apiResult }, { status: apiResult.status });
  } catch (error) {
    console.error("Error getting stakgraph status:", error);
    return NextResponse.json({ success: false, message: "Failed to get status" }, { status: 500 });
  }
}
