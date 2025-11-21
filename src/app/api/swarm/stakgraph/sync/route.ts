import { auth } from "@/lib/auth/auth";
import { db } from "@/lib/db";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { AsyncSyncResult, triggerAsyncSync } from "@/services/swarm/stakgraph-actions";
import { RepositoryStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getPrimaryRepository } from "@/lib/helpers/repository";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId, swarmId } = body as {
      workspaceId?: string;
      swarmId?: string;
    };

    console.log("[Sync] Request initiated", {
      userId: session.user.id,
      workspaceId,
      swarmId,
    });

    const where: Record<string, string> = {};
    if (swarmId) where.swarmId = swarmId;
    if (!swarmId && workspaceId) where.workspaceId = workspaceId;
    const swarm = await db.swarm.findFirst({ where });
    if (!swarm || !swarm.name || !swarm.swarmApiKey) {
      console.error("[Sync] Swarm not found or misconfigured", { workspaceId, swarmId });
      return NextResponse.json({ success: false, message: "Swarm not found or misconfigured" }, { status: 400 });
    }
    const primaryRepo = await getPrimaryRepository(swarm.workspaceId);
    const repositoryUrl = primaryRepo?.repositoryUrl;

    if (!repositoryUrl) {
      console.error("[Sync] Repository URL not set", {
        workspaceId: swarm.workspaceId,
        swarmId: swarm.id,
      });
      return NextResponse.json({ success: false, message: "Repository URL not set" }, { status: 400 });
    }

    console.log("[Sync] Repository found", {
      workspaceId: swarm.workspaceId,
      swarmId: swarm.id,
      repositoryUrl,
      swarmName: swarm.name,
    });

    let username: string | undefined;
    let pat: string | undefined;
    const userId = session.user.id as string;

    // Get the workspace associated with this swarm for GitHub access
    const workspace = await db.workspace.findUnique({
      where: { id: swarm.workspaceId },
      select: { slug: true },
    });

    if (!workspace) {
      return NextResponse.json({ success: false, message: "Workspace not found for swarm" }, { status: 404 });
    }

    const creds = await getGithubUsernameAndPAT(userId, workspace.slug);
    if (creds) {
      username = creds.username;
      pat = creds.token;
    }

    console.log("[Sync] GitHub credentials", {
      workspaceId: swarm.workspaceId,
      hasCredentials: !!(username && pat),
    });

    try {
      await db.repository.update({
        where: {
          repositoryUrl_workspaceId: {
            repositoryUrl: repositoryUrl,
            workspaceId: swarm.workspaceId,
          },
        },
        data: { status: RepositoryStatus.PENDING },
      });
    } catch (e) {
      console.error("Repository not found or failed to set PENDING before sync", e);
    }

    const callbackUrl = getStakgraphWebhookCallbackUrl(request);
    console.log("[Sync] Triggering async sync", {
      workspaceId: swarm.workspaceId,
      swarmId: swarm.id,
      swarmName: swarm.name,
      repositoryUrl,
      callbackUrl,
      hasGithubAuth: !!(username && pat),
    });

    const apiResult: AsyncSyncResult = await triggerAsyncSync(
      swarm.name,
      swarm.swarmApiKey,
      repositoryUrl,
      username && pat ? { username, pat } : undefined,
      callbackUrl,
    );

    console.log("[Sync] Async sync response", {
      workspaceId: swarm.workspaceId,
      swarmId: swarm.id,
      ok: apiResult.ok,
      status: apiResult.status,
      hasRequestId: !!apiResult.data?.request_id,
    });

    const requestId = apiResult.data?.request_id;
    if (requestId) {
      console.log("[Sync] Request ID received", {
        requestId,
        workspaceId: swarm.workspaceId,
        swarmId: swarm.id,
        repositoryUrl,
      });
      try {
        const updatedSwarm = await saveOrUpdateSwarm({
          workspaceId: swarm.workspaceId,
          ingestRefId: requestId,
        });

        console.log("[Sync] Saved ingest reference", {
          requestId,
          workspaceId: swarm.workspaceId,
          swarmId: swarm.id,
          savedIngestRefId: updatedSwarm?.ingestRefId,
        });
      } catch (err) {
        console.error("[Sync] Failed to store ingestRefId", {
          requestId,
          workspaceId: swarm.workspaceId,
          swarmId: swarm.id,
          error: err,
        });
        return NextResponse.json(
          { success: false, message: "Failed to store sync reference", requestId },
          { status: 500 },
        );
      }
    }
    if (!apiResult.ok || !requestId) {
      console.error("[Sync] Failed to start sync", {
        workspaceId: swarm.workspaceId,
        swarmId: swarm.id,
        ok: apiResult.ok,
        hasRequestId: !!requestId,
        repositoryUrl,
      });
      try {
        await db.repository.update({
          where: {
            repositoryUrl_workspaceId: {
              repositoryUrl: repositoryUrl,
              workspaceId: swarm.workspaceId,
            },
          },
          data: { status: RepositoryStatus.FAILED },
        });
        console.log("[Sync] Repository status → FAILED", {
          workspaceId: swarm.workspaceId,
          repositoryUrl,
        });
      } catch (e) {
        console.error("[Sync] Failed to update repository status", {
          workspaceId: swarm.workspaceId,
          repositoryUrl,
          error: e,
        });
      }
    }

    return NextResponse.json(
      { success: apiResult.ok, status: apiResult.status, requestId },
      { status: apiResult.status },
    );
  } catch (error) {
    console.error("[Sync] Unhandled error", { error });
    return NextResponse.json({ success: false, message: "Failed to sync" }, { status: 500 });
  }
}
