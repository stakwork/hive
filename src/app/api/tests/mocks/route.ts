import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";
import type { MockInventoryResponse } from "@/types/stakgraph";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get("workspaceId");
    const limit = searchParams.get("limit") || "20";
    const offset = searchParams.get("offset") || "0";
    const search = searchParams.get("search") || "";
    const mocked = searchParams.get("mocked") || "all";

    if (!workspaceId) {
      return NextResponse.json(
        { success: false, message: "Workspace ID is required" },
        { status: 400 }
      );
    }

    // Verify workspace access
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        members: {
          some: {
            userId: session.user.id,
          },
        },
      },
      include: {
        swarm: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, message: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    if (!workspace.swarm) {
      return NextResponse.json(
        { success: false, message: "No swarm configured for this workspace" },
        { status: 400 }
      );
    }

    if (!workspace.swarm.swarmApiKey) {
      return NextResponse.json(
        { success: false, message: "Mock data is not available." },
        { status: 400 }
      );
    }

    const stakgraphUrl = `https://${workspace.swarm.name}:7799`;

    // Build query parameters
    const params = new URLSearchParams({
      limit,
      offset,
    });

    if (search) {
      params.append("search", search);
    }

    if (mocked !== "all") {
      params.append("mocked", mocked === "mocked" ? "true" : "false");
    }

    // Fetch from stakgraph
    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: `/mocks/inventory?${params.toString()}`,
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", workspace.swarm.swarmApiKey),
    });

    if (!apiResult.ok) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to fetch mock inventory from stakgraph",
          status: apiResult.status,
        },
        { status: apiResult.status || 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: apiResult.data,
      message: "Mock inventory retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching mock inventory:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to fetch mock inventory",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
