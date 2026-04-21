import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get("id");

    if (!workspaceId) {
      return NextResponse.json({ success: false, message: "workspaceId required" }, { status: 400 });
    }

    // Graph schema is a read operation — allow authenticated members and
    // public viewers on isPublicViewable workspaces.
    const access = await resolveWorkspaceAccess(request, { workspaceId });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;

    const swarm = await db.swarm.findFirst({ where: { workspaceId } });
    if (!swarm) {
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }
    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false, message: "Swarm URL or API key not set" }, { status: 400 });
    }

    // const stakgraphUrl = `https://${getSwarmVanityAddress(swarm.name)}:3355`;

    let jarvisUrl = `https://${getSwarmVanityAddress(swarm.name)}:8444`;
    let apiKey = swarm.swarmApiKey;
    if (process.env.CUSTOM_SWARM_URL) jarvisUrl = `${process.env.CUSTOM_SWARM_URL}:8444`;
    if (process.env.CUSTOM_SWARM_API_KEY) apiKey = process.env.CUSTOM_SWARM_API_KEY;

    const apiResult = await swarmApiRequest({
      swarmUrl: jarvisUrl,
      // endpoint: "/search?query=authentication&node_types=Function&output=json",
      endpoint: "/schema/all",
      method: "GET",
      apiKey,
    });

    // console.log('apiResult', apiResult)

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
    return NextResponse.json({ success: false, message: "Failed to get schemas" }, { status: 500 });
  }
}
