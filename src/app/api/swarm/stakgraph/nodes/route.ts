import { authOptions } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get("id");
    const nodeType = searchParams.get("node_type");

    console.log('workspaceId', workspaceId)

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

    const stakgraphUrl = `https://${getSwarmVanityAddress(swarm.name)}:3355`;

    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: `/graph?limit=200&node_types=${nodeType}`,
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
