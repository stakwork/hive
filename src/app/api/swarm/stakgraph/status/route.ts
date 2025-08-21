import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";
import { RepositoryStatus } from "@prisma/client";
import { mapStatusToStepStatus } from "@/utils/conversions";
import { StakgraphStatusResponse } from "@/types";

const encryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const swarmId = searchParams.get("swarmId");
    const workspaceId = searchParams.get("workspaceId");

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: id" },
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
    if (!swarm.name || !swarm.swarmApiKey) {
      return NextResponse.json(
        { success: false, message: "Swarm not configured (name/api key)" },
        { status: 400 },
      );
    }

    if (bearerToken) {
      const decryptedKey = EncryptionService.getInstance().decryptField(
        "swarmApiKey",
        swarm.swarmApiKey,
      );
      if (bearerToken !== decryptedKey) {
        return NextResponse.json(
          { success: false, message: "Unauthorized" },
          { status: 401 },
        );
      }
    } else {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json(
          { success: false, message: "Unauthorized" },
          { status: 401 },
        );
      }
    }

    const stakgraphUrl = `https://${swarm.name}:7799`;
    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: `/status/${id}`,
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
    });

    try {
      const data = apiResult?.data as StakgraphStatusResponse | undefined;
      if (data) {
        const nextStepStatus = mapStatusToStepStatus(data.status ?? "");
        const stakgraphSnapshot = {
          requestId: id,
          status: data.status,
          progress:
            typeof data.progress === "number" ? data.progress : undefined,
          nodes: data.result?.nodes,
          edges: data.result?.edges,
          lastUpdateAt: new Date().toISOString(),
        };

        await saveOrUpdateSwarm({
          workspaceId: swarm.workspaceId,
          stepStatus: nextStepStatus,
          wizardData: { stakgraph: stakgraphSnapshot },
        });

        if (nextStepStatus === "COMPLETED" || nextStepStatus === "FAILED") {
          if (swarm.repositoryUrl) {
            try {
              await db.repository.update({
                where: {
                  repositoryUrl_workspaceId: {
                    repositoryUrl: swarm.repositoryUrl,
                    workspaceId: swarm.workspaceId,
                  },
                },
                data: {
                  status:
                    nextStepStatus === "COMPLETED"
                      ? RepositoryStatus.SYNCED
                      : RepositoryStatus.FAILED,
                },
              });
            } catch (repoErr) {
              console.error("Failed to update repository status:", repoErr);
            }
          }
        }
      }
    } catch (persistErr) {
      console.error("Error persisting status snapshot:", persistErr);
    }

    return NextResponse.json({ apiResult }, { status: apiResult.status });
  } catch (error) {
    console.error("Error getting stakgraph status:", error);
    return NextResponse.json(
      { success: false, message: "Failed to get status" },
      { status: 500 },
    );
  }
}
