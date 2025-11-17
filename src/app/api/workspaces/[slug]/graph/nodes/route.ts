import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const { slug } = await params;

    if (!session?.user) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ success: false, message: "Invalid user session" }, { status: 401 });
    }

    // Get workspace and verify user has access
    const workspace = await getWorkspaceBySlug(slug, userId);
    if (!workspace) {
      return NextResponse.json({ success: false, message: "Workspace not found or access denied" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const nodeType = searchParams.get("node_type");
    const refIds = searchParams.get("ref_ids");
    const output = searchParams.get("output") || "json";
    const limit = searchParams.get("limit") || "100";
    const limitMode = searchParams.get("limit_mode") || "per_type";


    // Get swarm for this workspace
    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!swarm) {
      return NextResponse.json({ success: false, message: "Swarm not found for this workspace" }, { status: 404 });
    }

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false, message: "Swarm configuration is incomplete" }, { status: 400 });
    }

    // Extract hostname from swarm URL and construct graph endpoint
    const swarmUrlObj = new URL(swarm.swarmUrl);
    const protocol = swarmUrlObj.hostname.includes("localhost") ? "http" : "https";
    const graphUrl = `${protocol}://${swarmUrlObj.hostname}:3355`;

    // Build API params based on what's provided
    const apiParams: Record<string, string> = {
      output: output,
    };

    if (nodeType) {
      // If nodeType is a JSON array string, parse it and join as comma-separated
      try {
        const parsed = JSON.parse(nodeType);
        if (Array.isArray(parsed)) {
          apiParams.node_types = parsed.join(',');
        } else {
          apiParams.node_types = nodeType;
        }
      } catch {
        // If it's not JSON, use as-is
        apiParams.node_types = nodeType;
      }
    }

    if (refIds) {
      apiParams.ref_ids = refIds;
    }

    if (limit) {
      apiParams.limit = limit;
    }

    if (limitMode) {
      apiParams.limit_mode = limitMode;
    }


    // Proxy to graph microservice
    // const apiResult = await swarmApiRequestAuth({
    //   swarmUrl: graphUrl,
    //   endpoint: "/nodes",
    //   method: "GET",
    //   apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
    //   params: apiParams,
    // });

    console.log('url-url', `${graphUrl}/graph?${new URLSearchParams(apiParams).toString()}`);

    const apiResult = await fetch(`${graphUrl}/graph?${new URLSearchParams(apiParams).toString()}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
      },
    });


    if (!apiResult.ok) {
      const data = await apiResult.json();
      return NextResponse.json(
        {
          success: false,
          message: "Failed to fetch graph nodes",
          details: data,
        },
        { status: apiResult.status },
      );
    }

    const data = await apiResult.json();

    return NextResponse.json(
      {
        success: true,
        data: { nodes: data.nodes, edges: data.edges },
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ success: false, message: "Failed to fetch graph nodes" }, { status: 500 });
  }
}
