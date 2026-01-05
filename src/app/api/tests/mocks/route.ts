import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { config } from "@/config/env";
import type { _MockInventoryResponse } from "@/types/stakgraph";

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

    // Handle local development with mocks
    const { hostname } = new URL(request.url);
    const isLocalHost =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";

    if (process.env.NODE_ENV === "development" && isLocalHost) {
      const baseUrl = config.USE_MOCKS
        ? `${config.MOCK_BASE}/api/mock/stakgraph`
        : "http://0.0.0.0:3355";

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

      const url = `${baseUrl}/mocks/inventory?${params.toString()}`;
      const resp = await fetch(url);
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        return NextResponse.json(
          { success: false, message: "Failed to fetch mock inventory (dev)", details: data },
          { status: resp.status },
        );
      }

      return NextResponse.json({
        success: true,
        data,
        message: "Mock inventory retrieved successfully",
      });
    }

    // Verify workspace access
    const workspaceAccess = await validateWorkspaceAccessById(workspaceId, session.user.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json(
        { success: false, message: "Workspace not found or access denied" },
        { status: 403 }
      );
    }

    // Look up swarm
    const swarm = await db.swarm.findFirst({ where: { workspaceId } });

    if (!swarm) {
      return NextResponse.json(
        { success: false, message: "Swarm not found" },
        { status: 404 }
      );
    }

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json(
        { success: false, message: "Mock data is not available." },
        { status: 400 }
      );
    }

    const swarmUrlObj = new URL(swarm.swarmUrl);
    const stakgraphUrl = `https://${swarmUrlObj.hostname}:3355`;

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
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
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
