import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth, checkIsSuperAdmin } from "@/lib/middleware/utils";
import { getSwarmConfig } from "@/app/api/learnings/utils";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const isSuperAdmin = await checkIsSuperAdmin(userOrResponse.id);

    const { id } = await params;
    const body = await request.json();
    const { documentation, workspace } = body;

    if (!workspace || documentation === undefined) {
      return NextResponse.json(
        { error: "Missing required parameters: workspace, documentation" },
        { status: 400 }
      );
    }

    const swarmConfig = await getSwarmConfig(workspace, userOrResponse.id, { isSuperAdmin });
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    const swarmUrl = `${baseSwarmUrl}/gitree/features/${id}/documentation`;

    const response = await fetch(swarmUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
      body: JSON.stringify({ documentation }),
    });

    if (!response.ok) {
      throw new Error(`Swarm server error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Feature documentation API proxy error:", error);
    return NextResponse.json(
      { error: "Failed to update feature documentation" },
      { status: 500 }
    );
  }
}
