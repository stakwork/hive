import { NextRequest, NextResponse } from "next/server";
import { getSwarmConfig } from "../../utils";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspace, repo_url } = body;

    if (!workspace || !repo_url) {
      return NextResponse.json(
        { error: "Missing required parameters: workspace, repo_url" },
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

    const response = await fetch(`${baseSwarmUrl}/learn_docs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
      body: JSON.stringify({ repo_url }),
    });

    if (!response.ok) {
      throw new Error(`Swarm server error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Learn docs API proxy error:", error);
    return NextResponse.json({ error: "Failed to trigger documentation learning" }, { status: 500 });
  }
}
