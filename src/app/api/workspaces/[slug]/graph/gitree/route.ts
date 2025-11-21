import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getWorkspaceBySlug } from "@/services/workspace";
import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

interface GitreeEdge {
  source: string;
  target: string;
  [key: string]: any;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await auth();
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
    const limit = searchParams.get("limit") || "100";
    const limitMode = searchParams.get("limit_mode") || "per_type";
    const concise = searchParams.get("concise") === "true";
    const typeLimits = searchParams.get("per_type_limits") || "Feature:10,File:100,Function:50,Endpoint:25";


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

    // Extract hostname from swarm URL and construct gitree endpoint
    const swarmUrlObj = new URL(swarm.swarmUrl);
    const protocol = swarmUrlObj.hostname.includes("localhost") ? "http" : "https";

    // Allow environment overrides for development/testing
    let graphUrl = `${protocol}://${swarmUrlObj.hostname}:3355`;
    let apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

    if (process.env.CUSTOM_SWARM_URL) {
      graphUrl = `${process.env.CUSTOM_SWARM_URL}:3355`;
    }
    if (process.env.CUSTOM_SWARM_API_KEY) {
      apiKey = process.env.CUSTOM_SWARM_API_KEY;
    }

    // Build API params
    const apiParams: Record<string, string> = {};

    if (nodeType) {
      apiParams.node_type = nodeType;
    }

    if (limit) {
      apiParams.limit = limit;
    }

    if (limitMode) {
      apiParams.limit_mode = limitMode;
    }

    if (concise) {
      apiParams.concise = "true";
    }

    // if (typeLimits) {
    //   apiParams.per_type_limits = typeLimits;
    // }

    const queryString = Object.keys(apiParams).length > 0 ? `?${new URLSearchParams(apiParams).toString()}` : '';

    console.log(queryString);
    console.log(`${graphUrl}/gitree/all-features-graph${queryString}`);

    const apiResult = await fetch(`${graphUrl}/gitree/all-features-graph?per_type_limits=Function:100,Class:5,Library:1,Import:1,Datamodel:100,File:10,IntegrationTest:5,UnitTest:5,Var:5`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiKey,
      },
    });

    if (!apiResult.ok) {
      const data = await apiResult.json();
      return NextResponse.json(
        {
          success: false,
          message: "Failed to fetch gitree all-features-graph",
          details: data,
        },
        { status: apiResult.status },
      );
    }

    const data = await apiResult.json();

    console.log(data)

    const finalData = {
      nodes: data.nodes,
      edges: data.edges.map((edge: GitreeEdge) => ({ ...edge, ref_id: `${edge.source}-${edge.target}` })),
    }

    return NextResponse.json(
      {
        success: true,
        data: finalData,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ success: false, message: "Failed to fetch gitree all-features-graph" }, { status: 500 });
  }
}