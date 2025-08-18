import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const nodeType = searchParams.get("node_type");
    const refIds = searchParams.get("ref_ids");
    const language = searchParams.get("language");
    const concise = searchParams.get("concise") || "false";

    if (!workspaceId) {
      return NextResponse.json(
        { success: false, message: "Missing required parameter: workspaceId" },
        { status: 400 },
      );
    }

    // Find the swarm for this workspace
    const swarm = await db.swarm.findFirst({ 
      where: { workspaceId } 
    });

    if (!swarm || !swarm.swarmUrl) {
      return NextResponse.json(
        { success: false, message: "Code graph service not available for this workspace" },
        { status: 404 },
      );
    }

    // Build the code graph URL using the swarm hostname
    const swarmUrlObj = new URL(swarm.swarmUrl);
    const codeGraphUrl = `https://${swarmUrlObj.hostname}:3355`;

    // Build parameters for the code graph API
    const codeGraphParams = new URLSearchParams({
      output: "json",
      concise,
    });

    if (nodeType) {
      codeGraphParams.set("node_type", nodeType);
    }

    if (refIds) {
      codeGraphParams.set("ref_ids", refIds);
    }

    if (language) {
      codeGraphParams.set("language", language);
    }

    // Make the request to the code graph service
    const codeGraphResponse = await fetch(`${codeGraphUrl}/nodes?${codeGraphParams.toString()}`);
    
    if (!codeGraphResponse.ok) {
      return NextResponse.json(
        { 
          success: false, 
          message: "Failed to fetch nodes",
          details: `HTTP ${codeGraphResponse.status}: ${codeGraphResponse.statusText}`
        },
        { status: codeGraphResponse.status },
      );
    }

    const nodes = await codeGraphResponse.json();

    return NextResponse.json(
      {
        success: true,
        data: nodes,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching code graph nodes:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch nodes" },
      { status: 500 },
    );
  }
}