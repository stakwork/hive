import { db } from "@/lib/db";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { AsyncSyncResult, triggerAsyncSync } from "@/services/swarm/stakgraph-actions";
import { RepositoryStatus } from "@prisma/client";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { NextRequest } from "next/server";

export interface SyncStakgraphParams {
  workspaceId?: string;
  swarmId?: string;
}

export interface SyncStakgraphResult {
  success: boolean;
  status: number;
  message?: string;
  requestId?: string;
}

/**
 * Triggers a stakgraph sync for a workspace's swarm
 *
 * @param userId - The authenticated user's ID
 * @param params - Either workspaceId or swarmId to identify the swarm
 * @param request - The NextRequest object for generating callback URL
 * @returns Result indicating success/failure and any request ID
 */
export async function syncStakgraph(
  userId: string,
  params: SyncStakgraphParams,
  request: NextRequest
): Promise<SyncStakgraphResult> {
  const { workspaceId, swarmId } = params;

  // Build query to find swarm
  const where: Record<string, string> = {};
  if (swarmId) where.swarmId = swarmId;
  if (!swarmId && workspaceId) where.workspaceId = workspaceId;

  // Find swarm
  const swarm = await db.swarm.findFirst({ where });
  if (!swarm || !swarm.name || !swarm.swarmApiKey) {
    return {
      success: false,
      status: 400,
      message: "Swarm not found or misconfigured",
    };
  }

  // Get primary repository
  const primaryRepo = await getPrimaryRepository(swarm.workspaceId);
  const repositoryUrl = primaryRepo?.repositoryUrl;

  if (!repositoryUrl) {
    return {
      success: false,
      status: 400,
      message: "Repository URL not set",
    };
  }

  // Get workspace for GitHub access validation
  const workspace = await db.workspace.findUnique({
    where: { id: swarm.workspaceId },
    select: {
      slug: true,
      ownerId: true,
      members: {
        where: { userId },
        select: { role: true },
      },
    },
  });

  if (!workspace) {
    return {
      success: false,
      status: 404,
      message: "Workspace not found for swarm",
    };
  }

  // Validate user has access to this workspace
  const isOwner = workspace.ownerId === userId;
  const isMember = workspace.members.length > 0;

  if (!isOwner && !isMember) {
    return {
      success: false,
      status: 403,
      message: "Access denied",
    };
  }

  // Get GitHub credentials
  let username: string | undefined;
  let pat: string | undefined;

  const creds = await getGithubUsernameAndPAT(userId, workspace.slug);
  if (creds) {
    username = creds.username;
    pat = creds.token;
  }

  // Update repository status to PENDING
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

  // Trigger async sync
  const callbackUrl = getStakgraphWebhookCallbackUrl(request);
  console.log("SYNC CALLBACK URL", callbackUrl);

  const apiResult: AsyncSyncResult = await triggerAsyncSync(
    swarm.name,
    swarm.swarmApiKey,
    repositoryUrl,
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

  // Save request ID if sync was initiated
  if (requestId) {
    console.log("STAKGRAPH SYNC START", {
      requestId,
      workspaceId: swarm.workspaceId,
      swarmId: swarm.id,
      repositoryUrl: repositoryUrl,
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

      return {
        success: false,
        status: 500,
        message: "Failed to store sync reference",
        requestId,
      };
    }
  }

  // Update repository status to FAILED if sync didn't initiate
  if (!apiResult.ok || !requestId) {
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
    } catch (e) {
      console.error("Failed to mark repository FAILED after sync start error", e);
    }
  }

  return {
    success: apiResult.ok,
    status: apiResult.status,
    requestId,
  };
}
