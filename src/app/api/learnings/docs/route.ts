import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth, checkIsSuperAdmin } from "@/lib/middleware/utils";
import { getSwarmConfig } from "../utils";

export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const isSuperAdmin = await checkIsSuperAdmin(userOrResponse.id);

    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get("workspace");

    if (!workspace) {
      return NextResponse.json({ error: "Missing workspace parameter" }, { status: 400 });
    }

    const swarmConfig = await getSwarmConfig(workspace, userOrResponse.id, { isSuperAdmin });
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    const swarmUrl = `${baseSwarmUrl}/docs`;

    const response = await fetch(swarmUrl, {
      method: "GET",
      headers: {
        "x-api-token": decryptedSwarmApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Swarm server error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Docs API proxy error:", error);
    return NextResponse.json({ error: "Failed to fetch docs" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const isSuperAdmin = await checkIsSuperAdmin(userOrResponse.id);

    const body = await request.json();
    const { repo, documentation, workspace } = body;

    if (!workspace || !repo || documentation === undefined) {
      return NextResponse.json({ error: "Missing required parameters: workspace, repo, documentation" }, { status: 400 });
    }

    const swarmConfig = await getSwarmConfig(workspace, userOrResponse.id, { isSuperAdmin });
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    const swarmUrl = `${baseSwarmUrl}/docs`;

    const response = await fetch(swarmUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
      body: JSON.stringify({ repo, documentation }),
    });

    if (!response.ok) {
      throw new Error(`Swarm server error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Docs API proxy error:", error);
    return NextResponse.json({ error: "Failed to update docs" }, { status: 500 });
  }
}
