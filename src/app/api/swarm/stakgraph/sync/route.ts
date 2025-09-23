import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { AsyncSyncResult, triggerAsyncSync } from "@/services/swarm/stakgraph-actions";
import { RepositoryStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

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

    // Get the workspace associated with this swarm for GitHub access
    const workspace = await db.workspace.findUnique({
      where: { id: swarm.workspaceId },
      select: { slug: true }
    });

    if (!workspace) {
      return NextResponse.json({ success: false, message: "Workspace not found for swarm" }, { status: 404 });
    }

    const creds = await getGithubUsernameAndPAT(userId, workspace.slug);
    if (creds) {
      username = creds.username;
      pat = creds.token;
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

    console.log("STAKGRAPH SYNC API RESPONSE", {
      ok: apiResult.ok,
      status: apiResult.status,
      data: apiResult.data,
      hasRequestId: !!apiResult.data?.request_id,
    });

    const requestId = apiResult.data?.request_id;
    if (requestId) {
      console.log("STAKGRAPH SYNC START", {
        requestId,
        workspaceId: swarm.workspaceId,
        swarmId: swarm.id,
        repositoryUrl: swarm.repositoryUrl,
      });
      try {
        console.log("ABOUT TO SAVE INGEST REF ID", {
          requestId,
          workspaceId: swarm.workspaceId,
          swarmId: swarm.id,
        });

        const updatedSwarm = await saveOrUpdateSwarm({
          workspaceId: swarm.workspaceId,
          ingestRefId: requestId,
        });

        console.log("STAKGRAPH SYNC START SAVED INGEST REF ID", {
          requestId,
          workspaceId: swarm.workspaceId,
          swarmId: swarm.id,
          savedIngestRefId: updatedSwarm?.ingestRefId,
          swarmUpdatedAt: updatedSwarm?.updatedAt,
        });
      } catch (err) {
        console.error("Failed to store ingestRefId for sync", err, {
          requestId,
          workspaceId: swarm.workspaceId,
          swarmId: swarm.id,
        });
        // Return error instead of success
        return NextResponse.json(
          { success: false, message: "Failed to store sync reference", requestId },
          { status: 500 },
        );
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
