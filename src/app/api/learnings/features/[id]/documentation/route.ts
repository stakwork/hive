import { NextRequest, NextResponse } from "next/server";
import { getSwarmConfig } from "@/app/api/learnings/utils";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { documentation, workspace } = body;

    if (!workspace || documentation === undefined) {
      return NextResponse.json(
        { error: "Missing required parameters: workspace, documentation" },
        { status: 400 }
      );
    }

    const access = await resolveWorkspaceAccess(request, { slug: workspace });
    const ok = requireMemberAccess(access);
    if (ok instanceof NextResponse) return ok;

    const swarmConfig = await getSwarmConfig(ok.workspaceId);
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    const swarmUrl = `${baseSwarmUrl}/gitree/features/${encodeURIComponent(id)}/documentation`;

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
