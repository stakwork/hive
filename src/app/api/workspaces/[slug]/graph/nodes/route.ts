import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const { slug } = await params;

    if (!session?.user) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Invalid user session" },
        { status: 401 },
      );
    }

    // Get workspace and verify user has access
    const workspace = await getWorkspaceBySlug(slug, userId);
    if (!workspace) {
      return NextResponse.json(
        { success: false, message: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    const { searchParams } = new URL(request.url);
    const nodeType = searchParams.get("node_type");
    const output = searchParams.get("output") || "json";

    if (!nodeType) {
      return NextResponse.json(
        { success: false, message: "Missing required parameter: node_type" },
        { status: 400 },
      );
    }

    // Get swarm for this workspace
    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!swarm) {
      return NextResponse.json(
        { success: false, message: "Swarm not found for this workspace" },
        { status: 404 },
      );
    }

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json(
        { success: false, message: "Swarm configuration is incomplete" },
        { status: 400 },
      );
    }

    // Extract hostname from swarm URL and construct graph endpoint
    const swarmUrlObj = new URL(swarm.swarmUrl);
    const graphUrl = `https://${swarmUrlObj.hostname}:3355`;

    // Proxy to graph microservice
    const apiResult = await swarmApiRequestAuth({
      swarmUrl: graphUrl,
      endpoint: "/nodes",
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
      params: {
        node_type: nodeType,
        output: output,
      },
    });

    if (!apiResult.ok) {
      return NextResponse.json(
        { 
          success: false, 
          message: "Failed to fetch graph nodes",
          details: apiResult.data 
        },
        { status: apiResult.status },
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: apiResult.data,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching graph nodes:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch graph nodes" },
      { status: 500 },
    );
  }
}