import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get("id");
    const nodeType = searchParams.get("node_type");

    console.log('workspaceId', workspaceId, nodeType)

    const where: Record<string, string> = {};
    if (workspaceId) where.workspaceId = workspaceId;

    const swarm = await db.swarm.findFirst({ where });
    if (!swarm) {
      return NextResponse.json(
        { success: false, message: "Swarm not found" },
        { status: 404 },
      );
    }
    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json(
        { success: false, message: "Swarm URL or API key not set" },
        { status: 400 },
      );
    }



    const stakgraphUrl = `https://${getSwarmVanityAddress(swarm.name)}:8444`;


    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: `graph/search/latest`,
      method: "GET",
      apiKey: swarm.swarmApiKey,
    });

    console.log('apiResult', apiResult)

    return NextResponse.json(
      {
        success: apiResult.ok,
        status: apiResult.status,
        data: apiResult.data,
      },
      { status: apiResult.status },
    );
  } catch (error) {
    console.error("Nodes fetch error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to get nodes" },
      { status: 500 },
    );
  }
}
