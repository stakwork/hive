import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm, ServiceConfig } from "@/services/swarm/db";
import { EncryptionService } from "@/lib/encryption";

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
    const swarmId = searchParams.get("swarmId");
    if (!workspaceId || !swarmId) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing required fields: workspaceId or swarmId",
        },
        { status: 400 },
      );
    }

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
        { success: false, message: "Swarm URL or API key not set" },
        { status: 400 },
      );
    }

    // Proxy to stakgraph microservice
    const apiResult = await swarmApiRequestAuth({
      swarmUrl: `https://${swarm.name}:3355`,
      endpoint: "/services",
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
    });

    // Transform response format: wrap array in {services: [...]} for new format
    const responseData = Array.isArray(apiResult.data)
      ? { services: apiResult.data as ServiceConfig[] }
      : (apiResult.data as { services: ServiceConfig[] });

    await saveOrUpdateSwarm({
      workspaceId: swarm.workspaceId,
      services: responseData.services,
    });

    return NextResponse.json(
      {
        success: apiResult.ok,
        status: apiResult.status,
        data: responseData,
      },
      { status: apiResult.status },
    );
  } catch {
    return NextResponse.json(
      { success: false, message: "Failed to ingest code" },
      { status: 500 },
    );
  }
}
