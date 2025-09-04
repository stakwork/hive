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
      // endpoint: "/search?query=authentication&node_types=Function&output=json",
      endpoint: "/schema",
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
    console.error("Schema fetch error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to get schemas" },
      { status: 500 },
    );
  }
}
