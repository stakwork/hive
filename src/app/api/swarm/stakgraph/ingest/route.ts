import { auth, getGithubUsernameAndPAT } from "@/lib/auth/auth";
import { getServiceConfig } from "@/config/services";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { getGithubWebhookCallbackUrl, getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { WebhookService } from "@/services/github/WebhookService";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { triggerIngestAsync } from "@/services/swarm/stakgraph-actions";
import { RepositoryStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();
export async function POST(request: NextRequest) {
  try {
    console.log(`[STAKGRAPH_INGEST] Starting ingest request`);
    const session = await auth();

    if (!session?.user?.id) {
      console.log(`[STAKGRAPH_INGEST] Unauthorized - no session or user ID`);
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId, swarmId, useLsp } = body;
    console.log(`[STAKGRAPH_INGEST] Request params - workspaceId: ${workspaceId}, swarmId: ${swarmId}, useLsp: ${useLsp}, user: ${session.user.id}`);

    console.log(`[STAKGRAPH_INGEST] Looking up swarm - swarmId: ${swarmId}, workspaceId: ${workspaceId}`);
    const where: Record<string, string> = {};
    if (swarmId) where.swarmId = swarmId;
    if (!swarmId && workspaceId) where.workspaceId = workspaceId;

    const swarm = await db.swarm.findFirst({ where });
    if (!swarm) {
      console.log(`[STAKGRAPH_INGEST] Swarm not found with criteria:`, where);
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }

    console.log(`[STAKGRAPH_INGEST] Found swarm - ID: ${swarm.id}, name: ${swarm.name}, status: ${swarm.status}`);

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      console.log(`[STAKGRAPH_INGEST] Swarm missing required fields - swarmUrl: ${!!swarm.swarmUrl}, swarmApiKey: ${!!swarm.swarmApiKey}`);
      return NextResponse.json({ success: false, message: "Swarm URL or API key not set" }, { status: 400 });
    }

    const repoWorkspaceId = workspaceId || swarm.workspaceId;
    console.log(`[STAKGRAPH_INGEST] Using workspace ID: ${repoWorkspaceId}`);

    console.log(`[STAKGRAPH_INGEST] Looking up primary repository for workspace: ${repoWorkspaceId}`);
    const primaryRepo = await getPrimaryRepository(repoWorkspaceId);
    const finalRepo = primaryRepo?.repositoryUrl;

    if (!finalRepo) {
      console.log(`[STAKGRAPH_INGEST] No repository URL found for workspace: ${repoWorkspaceId}`);
      return NextResponse.json({ success: false, message: "No repository URL found" }, { status: 400 });
    }

    if (!repoWorkspaceId) {
      console.log(`[STAKGRAPH_INGEST] No repository workspace ID found`);
      return NextResponse.json({ success: false, message: "No repository workspace ID found" }, { status: 400 });
    }

    console.log(`[STAKGRAPH_INGEST] Repository details - URL: ${finalRepo}, workspace: ${repoWorkspaceId}`);

    // Update the existing repository status to PENDING (repository was created when swarm was created)
    console.log(`[STAKGRAPH_INGEST] Updating repository status to PENDING - URL: ${finalRepo}, workspace: ${repoWorkspaceId}`);
    await db.repository.update({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl: finalRepo,
          workspaceId: repoWorkspaceId,
        },
      },
      data: { status: RepositoryStatus.PENDING },
    });
    console.log(`[STAKGRAPH_INGEST] Repository status updated to PENDING`);

    // Get workspace info to get the slug
    console.log(`[STAKGRAPH_INGEST] Looking up workspace details for ID: ${repoWorkspaceId}`);
    const workspace = await db.workspace.findUnique({
      where: { id: repoWorkspaceId },
      select: { slug: true },
    });

    if (!workspace) {
      console.log(`[STAKGRAPH_INGEST] Workspace not found with ID: ${repoWorkspaceId}`);
      return NextResponse.json({ success: false, message: "Workspace not found" }, { status: 404 });
    }

    console.log(`[STAKGRAPH_INGEST] Found workspace slug: ${workspace.slug}`);

    // Get GitHub credentials using the standard function
    console.log(`[STAKGRAPH_INGEST] Getting GitHub credentials for user ${session.user.id} in workspace ${workspace.slug}`);
    const githubProfile = await getGithubUsernameAndPAT(session.user.id, workspace.slug);
    if (!githubProfile?.username || !githubProfile?.token) {
      console.log(`[STAKGRAPH_INGEST] No GitHub credentials found - username: ${!!githubProfile?.username}, token: ${!!githubProfile?.token}`);
      return NextResponse.json({ success: false, message: "No GitHub credentials found for this workspace" }, { status: 400 });
    }

    const username = githubProfile.username;
    const pat = githubProfile.token;
    console.log(`[STAKGRAPH_INGEST] GitHub credentials found - username: ${username}, token length: ${pat.length}`);

    const use_lsp = useLsp === "true" || useLsp === true;
    console.log(`[STAKGRAPH_INGEST] Starting ingest trigger - use_lsp: ${use_lsp}, swarm: ${swarm.name}, repo: ${finalRepo}`);

    const swarmVanityAddress = getSwarmVanityAddress(swarm.name);
    const decryptedApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
    const stakgraphCallbackUrl = getStakgraphWebhookCallbackUrl(request);

    console.log(`[STAKGRAPH_INGEST] Ingest parameters - vanity address: ${swarmVanityAddress}, callback URL: ${stakgraphCallbackUrl}, API key present: ${!!decryptedApiKey}`);

    const startTime = Date.now();
    const apiResult = await triggerIngestAsync(
      swarmVanityAddress,
      decryptedApiKey,
      finalRepo,
      { username, pat },
      stakgraphCallbackUrl,
      use_lsp,
    );

    const ingestDuration = Date.now() - startTime;
    console.log(`[STAKGRAPH_INGEST] Ingest trigger completed in ${ingestDuration}ms - success: ${apiResult.ok}, status: ${apiResult.status}`);

    try {
      console.log(`[STAKGRAPH_INGEST] Setting up GitHub webhook for repository: ${finalRepo}`);
      const callbackUrl = getGithubWebhookCallbackUrl(request);
      const webhookService = new WebhookService(getServiceConfig("github"));
      console.log(`[STAKGRAPH_INGEST] GitHub webhook callback URL: ${callbackUrl}`);

      await webhookService.ensureRepoWebhook({
        userId: session.user.id,
        workspaceId: repoWorkspaceId,
        repositoryUrl: finalRepo,
        callbackUrl,
      });
      console.log(`[STAKGRAPH_INGEST] GitHub webhook setup completed successfully`);
    } catch (error) {
      console.error(`[STAKGRAPH_INGEST] Error ensuring repo webhook: ${error}`);
    }

    if (apiResult?.data && typeof apiResult.data === "object" && "request_id" in apiResult.data) {
      const requestId = (apiResult.data as { request_id: string }).request_id;
      console.log(`[STAKGRAPH_INGEST] Updating swarm with ingest request ID: ${requestId}`);
      await saveOrUpdateSwarm({
        workspaceId: swarm.workspaceId,
        ingestRefId: requestId,
      });
      console.log(`[STAKGRAPH_INGEST] Swarm updated with ingest reference ID`);
    } else {
      console.log(`[STAKGRAPH_INGEST] No request_id found in API result data:`, apiResult?.data);
    }

    console.log(`[STAKGRAPH_INGEST] Returning response - success: ${apiResult.ok}, status: ${apiResult.status}`);
    return NextResponse.json(
      {
        success: apiResult.ok,
        status: apiResult.status,
        data: apiResult.data,
      },
      { status: apiResult.status },
    );
  } catch (error) {
    console.error(`[STAKGRAPH_INGEST] Top-level error during ingest:`, error);
    return NextResponse.json({ success: false, message: "Failed to ingest code" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const workspaceId = searchParams.get("workspaceId");

  console.log(`[STAKGRAPH_STATUS] Getting ingest status - id: ${id}, workspaceId: ${workspaceId}`);

  try {
    const session = await auth();
    if (!session?.user?.id) {
      console.log(`[STAKGRAPH_STATUS] Unauthorized - no session or user ID`);
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    if (!id || !workspaceId) {
      console.log(`[STAKGRAPH_STATUS] Missing required fields - id: ${!!id}, workspaceId: ${!!workspaceId}`);
      return NextResponse.json(
        { success: false, message: "Missing required fields: id, workspaceId" },
        { status: 400 },
      );
    }

    // Get the swarm for the workspace
    console.log(`[STAKGRAPH_STATUS] Looking up swarm for workspace: ${workspaceId}`);
    const swarm = await db.swarm.findUnique({
      where: { workspaceId },
    });

    if (!swarm) {
      console.log(`[STAKGRAPH_STATUS] Swarm not found for workspace: ${workspaceId}`);
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }

    console.log(`[STAKGRAPH_STATUS] Found swarm - ID: ${swarm.id}, name: ${swarm.name}`);

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      console.log(`[STAKGRAPH_STATUS] Swarm missing required fields - swarmUrl: ${!!swarm.swarmUrl}, swarmApiKey: ${!!swarm.swarmApiKey}`);
      return NextResponse.json({ success: false, message: "Swarm URL or API key not set" }, { status: 400 });
    }

    const stakgraphUrl = `https://${getSwarmVanityAddress(swarm.name)}:7799`;
    console.log(`[STAKGRAPH_STATUS] Calling stakgraph status API - URL: ${stakgraphUrl}/status/${id}`);

    const startTime = Date.now();
    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: `/status/${id}`,
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
    });

    const apiDuration = Date.now() - startTime;
    console.log(`[STAKGRAPH_STATUS] Status API call completed in ${apiDuration}ms - status: ${apiResult.status}, ok: ${apiResult.ok}`);

    return NextResponse.json(
      {
        apiResult,
      },
      { status: apiResult.status },
    );
  } catch (error) {
    console.error(`[STAKGRAPH_STATUS] Error getting ingest status:`, error);
    return NextResponse.json({ success: false, message: "Failed to get ingest status" }, { status: 500 });
  }
}
