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
    const query = searchParams.get("query");
    const method = searchParams.get("method") || "fulltext";
    const nodeTypes = searchParams.get("node_types");
    const limit = searchParams.get("limit") || "50";

    if (!workspaceId) {
      return NextResponse.json(
        { success: false, message: "Missing required parameter: workspaceId" },
        { status: 400 },
      );
    }

    if (!query) {
      return NextResponse.json(
        { success: false, message: "Missing required parameter: query" },
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

    // Build search parameters for the code graph API
    const codeGraphParams = new URLSearchParams({
      query,
      method,
      output: "json",
      limit,
    });

    if (nodeTypes) {
      codeGraphParams.set("node_types", nodeTypes);
    }

    // Make the request to the code graph service
    const codeGraphResponse = await fetch(`${codeGraphUrl}/search?${codeGraphParams.toString()}`);
    
    if (!codeGraphResponse.ok) {
      return NextResponse.json(
        { 
          success: false, 
          message: "Failed to fetch search results",
          details: `HTTP ${codeGraphResponse.status}: ${codeGraphResponse.statusText}`
        },
        { status: codeGraphResponse.status },
      );
    }

    const searchResults = await codeGraphResponse.json();

    return NextResponse.json(
      {
        success: true,
        data: searchResults,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error searching code graph:", error);
    return NextResponse.json(
      { success: false, message: "Failed to search code graph" },
      { status: 500 },
    );
  }
}