import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { triggerAsyncSync, AsyncSyncResult } from "@/services/swarm/stakgraph-actions";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { RepositoryStatus } from "@prisma/client";
import { saveOrUpdateSwarm } from "@/services/swarm/db";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    console.log("SESSION", session);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId, swarmId } = body as {
      workspaceId?: string;
      swarmId?: string;
    };

    const where: Record<string, string> = {};
    if (swarmId) where.swarmId = swarmId;
    if (!swarmId && workspaceId) where.workspaceId = workspaceId;
    const swarm = await db.swarm.findFirst({ where });
    if (!swarm || !swarm.name || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false, message: "Swarm not found or misconfigured" }, { status: 400 });
    }
    if (!swarm.repositoryUrl) {
      return NextResponse.json({ success: false, message: "Repository URL not set" }, { status: 400 });
    }

    let username: string | undefined;
    let pat: string | undefined;
    const userId = session.user.id as string;
    const creds = await getGithubUsernameAndPAT(userId);
    if (creds) {
      username = creds.username;
      pat = creds.appAccessToken || creds.pat;
    }
    try {
      await db.repository.update({
        where: {
          repositoryUrl_workspaceId: {
            repositoryUrl: swarm.repositoryUrl,
            workspaceId: swarm.workspaceId,
          },
        },
        data: { status: RepositoryStatus.PENDING },
      });
    } catch (e) {
      console.error("Repository not found or failed to set PENDING before sync", e);
    }

    const callbackUrl = getStakgraphWebhookCallbackUrl(request);
    console.log("SYNC CALLBACK URL", callbackUrl);
    const apiResult: AsyncSyncResult = await triggerAsyncSync(
      swarm.name,
      swarm.swarmApiKey,
      swarm.repositoryUrl,
      username && pat ? { username, pat } : undefined,
      callbackUrl,
    );
    const requestId = apiResult.data?.request_id;
    if (requestId) {
      console.log("STAKGRAPH SYNC START", {
        requestId,
        workspaceId: swarm.workspaceId,
        swarmId: swarm.id,
        repositoryUrl: swarm.repositoryUrl,
      });
      try {
        await saveOrUpdateSwarm({
          workspaceId: swarm.workspaceId,
          ingestRefId: requestId,
        });
        console.log("STAKGRAPH SYNC START SAVED INGEST REF ID", {
          requestId,
          workspaceId: swarm.workspaceId,
          swarmId: swarm.id,
        });
      } catch (err) {
        console.error("Failed to store ingestRefId for sync", err);
      }
    }
    if (!apiResult.ok || !requestId) {
      try {
        await db.repository.update({
          where: {
            repositoryUrl_workspaceId: {
              repositoryUrl: swarm.repositoryUrl,
              workspaceId: swarm.workspaceId,
            },
          },
          data: { status: RepositoryStatus.FAILED },
        });
      } catch (e) {
        console.error("Failed to mark repository FAILED after sync start error", e);
      }
    }

    return NextResponse.json(
      { success: apiResult.ok, status: apiResult.status, requestId },
      { status: apiResult.status },
    );
  } catch {
    return NextResponse.json({ success: false, message: "Failed to sync" }, { status: 500 });
  }
}
