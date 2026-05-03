import { NextRequest, NextResponse } from "next/server";
import { getSwarmConfig } from "../utils";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    const access = await resolveWorkspaceAccess(request, { slug: workspaceSlug });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;

    const swarmConfig = await getSwarmConfig(ok.workspaceId);
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    const swarmUrl = `${baseSwarmUrl}/gitree/features`;

    const response = await fetch(swarmUrl, {
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
    const features = Array.isArray(data)
      ? data
      : Array.isArray(data?.features)
        ? data.features
        : [];
    return NextResponse.json({
      features,
      lastProcessedTimestamp: data.lastProcessedTimestamp ?? null,
      cumulativeUsage: data.cumulativeUsage ?? null,
      processing: data.processing ?? false,
    });
  } catch (error) {
    console.error("Features API proxy error:", error);
    return NextResponse.json({ error: "Failed to fetch features data" }, { status: 500 });
  }
}
