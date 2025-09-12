import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm, ServiceConfig } from "@/services/swarm/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const clone = searchParams.get("clone");

    const swarmId = searchParams.get("swarmId");
    const repo_url = searchParams.get("repo_url");

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
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }
    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false, message: "Swarm URL or API key not set" }, { status: 400 });
    }

    const githubProfile = await getGithubUsernameAndPAT(session?.user?.id);

    // Proxy to stakgraph microservice
    const apiResult = await swarmApiRequestAuth({
      swarmUrl: `https://${getSwarmVanityAddress(swarm.name)}:3355`,
      endpoint: "/services",
      method: "GET",
      params: {
        ...(clone === "true" ? { clone } : {}),
        ...(repo_url ? { repo_url } : {}),
        ...(githubProfile?.username ? { username: githubProfile?.username } : {}),
        ...(githubProfile?.pat ? { pat: githubProfile?.pat } : {}),
      },
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
    return NextResponse.json({ success: false, message: "Failed to ingest code" }, { status: 500 });
  }
}
