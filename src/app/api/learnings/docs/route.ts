import { NextRequest, NextResponse } from "next/server";
import { getSwarmConfig } from "../utils";
import {
  resolveWorkspaceAccess,
  requireReadAccess,
  requireMemberAccess,
} from "@/lib/auth/workspace-access";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get("workspace");

    if (!workspace) {
      return NextResponse.json({ error: "Missing workspace parameter" }, { status: 400 });
    }

    const access = await resolveWorkspaceAccess(request, { slug: workspace });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;

    const swarmConfig = await getSwarmConfig(ok.workspaceId);
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
    const body = await request.json();
    const { repo, documentation, workspace } = body;

    if (!workspace || !repo || documentation === undefined) {
      return NextResponse.json({ error: "Missing required parameters: workspace, repo, documentation" }, { status: 400 });
    }

    const access = await resolveWorkspaceAccess(request, { slug: workspace });
    const ok = requireMemberAccess(access);
    if (ok instanceof NextResponse) return ok;

    const swarmConfig = await getSwarmConfig(ok.workspaceId);
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
