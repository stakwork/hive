import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
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

    const { searchParams, hostname } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const swarmId = searchParams.get("swarmId");
    const ignoreDirs = searchParams.get("ignoreDirs") || searchParams.get("ignore_dirs");

    // Build endpoint path with ignore_dirs if provided
    let endpoint = "/tests/coverage";
    if (ignoreDirs) {
      endpoint += `?ignore_dirs=${encodeURIComponent(ignoreDirs)}`;
    }

    // Development mode: connect directly to local stakgraph
    const isLocalHost =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
    if (process.env.NODE_ENV === "development" && isLocalHost) {
      const url = `http://0.0.0.0:7799${endpoint}`;
      const resp = await fetch(url);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return NextResponse.json(
          { success: false, message: "Failed to fetch test coverage (dev)", details: data },
          { status: resp.status },
        );
      }
      return NextResponse.json(
        {
          success: true,
          data,
        },
        { status: 200 },
      );
    }

    if (!workspaceId && !swarmId) {
      return NextResponse.json(
        { success: false, message: "Missing required parameter: workspaceId or swarmId" },
        { status: 400 },
      );
    }

    // Resolve Swarm
    const where: Record<string, string> = {};
    if (swarmId) where.swarmId = swarmId;
    if (!swarmId && workspaceId) where.workspaceId = workspaceId;
    const swarm = await db.swarm.findFirst({ where });

    if (!swarm) {
      return NextResponse.json(
        { success: false, message: "Swarm not found" },
        { status: 404 },
      );
    }

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json(
        { success: false, message: "Test coverage is not available." },
        { status: 400 },
      );
    }

    const swarmUrlObj = new URL(swarm.swarmUrl);
    const stakgraphUrl = `https://${swarmUrlObj.hostname}:7799`;

    // Proxy to stakgraph microservice
    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint,
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
    });

    if (!apiResult.ok) {
      return NextResponse.json(
        { 
          success: false, 
          message: "Failed to fetch test coverage data",
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
    console.error("Error fetching test coverage:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch test coverage" },
      { status: 500 },
    );
  }
}