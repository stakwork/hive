import { getServiceConfig } from "@/config/services";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getPrimaryRepository, getAllRepositories } from "@/lib/helpers/repository";
import { getGithubWebhookCallbackUrl, getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { WebhookService } from "@/services/github/WebhookService";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { triggerIngestAsync, SyncOptions } from "@/services/swarm/stakgraph-actions";
import { RepositoryStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();
export async function POST(request: NextRequest) {
  let workspaceId: string | undefined;

  try {
    console.log(`[STAKGRAPH_INGEST] Starting ingest request`);
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      console.log(`[STAKGRAPH_INGEST] Unauthorized - no session or user ID`);
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch (parseError) {
      console.log(`[STAKGRAPH_INGEST] Failed to parse request body:`, parseError);
      return NextResponse.json({ success: false, message: "Invalid request body" }, { status: 400 });
    }

    const { useLsp, repositoryId } = body;
    workspaceId = body.workspaceId;
    console.log(`[STAKGRAPH_INGEST] Request params - workspaceId: ${workspaceId}, repositoryId: ${repositoryId || 'all'}, useLsp: ${useLsp}, user: ${session.user.id}`);

    if (!workspaceId) {
      console.log(`[STAKGRAPH_INGEST] No workspaceId provided`);
      return NextResponse.json({ success: false, message: "Workspace ID is required" }, { status: 400 });
    }

    console.log(`[STAKGRAPH_INGEST] Looking up swarm for workspace: ${workspaceId}`);

    const swarm = await db.swarm.findUnique({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        swarmUrl: true,
        swarmApiKey: true,
        workspaceId: true,
        ingestRequestInProgress: true
      }
    });
    if (!swarm) {
      console.log(`[STAKGRAPH_INGEST] Swarm not found with criteria:`);
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }

    console.log(swarm)

    console.log(`[STAKGRAPH_INGEST] Found swarm - ID: ${swarm.id}, name: ${swarm.name}, ingestRequestInProgress: ${swarm.ingestRequestInProgress}`);

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      console.log(`[STAKGRAPH_INGEST] Swarm missing required fields - swarmUrl: ${!!swarm.swarmUrl}, swarmApiKey: ${!!swarm.swarmApiKey}`);
      return NextResponse.json({ success: false, message: "Swarm URL or API key not set" }, { status: 400 });
    }

    const repoWorkspaceId = workspaceId || swarm.workspaceId;
    console.log(`[STAKGRAPH_INGEST] Using workspace ID: ${repoWorkspaceId}`);

    // Determine repositories to ingest based on repositoryId parameter
    // Include sync config fields for filtering and building docs/mocks params
    type RepoWithSyncConfig = {
      id: string;
      repositoryUrl: string;
      name: string;
      codeIngestionEnabled: boolean;
      docsEnabled: boolean;
      mocksEnabled: boolean;
    };
    let allFetchedRepos: RepoWithSyncConfig[];

    if (repositoryId) {
      // Single repository ingestion
      console.log(`[STAKGRAPH_INGEST] Single repository mode - repositoryId: ${repositoryId}`);
      const repository = await db.repository.findUnique({
        where: { id: repositoryId },
        select: {
          id: true,
          repositoryUrl: true,
          workspaceId: true,
          name: true,
          codeIngestionEnabled: true,
          docsEnabled: true,
          mocksEnabled: true,
        },
      });

      if (!repository) {
        console.log(`[STAKGRAPH_INGEST] Repository not found with ID: ${repositoryId}`);
        return NextResponse.json({ success: false, message: "Repository not found" }, { status: 404 });
      }

      if (repository.workspaceId !== repoWorkspaceId) {
        console.log(`[STAKGRAPH_INGEST] Repository workspace mismatch - expected: ${repoWorkspaceId}, got: ${repository.workspaceId}`);
        return NextResponse.json({ success: false, message: "Repository does not belong to this workspace" }, { status: 400 });
      }

      allFetchedRepos = [repository];
    } else {
      // Multi-repository ingestion
      console.log(`[STAKGRAPH_INGEST] Multi-repository mode - fetching all repositories for workspace: ${repoWorkspaceId}`);
      const allRepositories = await getAllRepositories(repoWorkspaceId);

      if (allRepositories.length === 0) {
        console.log(`[STAKGRAPH_INGEST] No repositories found for workspace: ${repoWorkspaceId}`);
        return NextResponse.json({ success: false, message: "No repositories found for this workspace" }, { status: 400 });
      }

      allFetchedRepos = allRepositories;
      console.log(`[STAKGRAPH_INGEST] Found ${allRepositories.length} repositories total`);
    }

    // Filter to only repos with code ingestion enabled
    const repositoriesToIngest = allFetchedRepos.filter(repo => repo.codeIngestionEnabled);

    if (repositoriesToIngest.length === 0) {
      console.log(`[STAKGRAPH_INGEST] No repositories with code ingestion enabled`);
      return NextResponse.json({ success: false, message: "No repositories with code ingestion enabled" }, { status: 400 });
    }

    console.log(`[STAKGRAPH_INGEST] Repositories to ingest: ${repositoriesToIngest.length} of ${allFetchedRepos.length}`);

    // Build docs and mocks params based on repo settings
    const docsRepos = repositoriesToIngest.filter(r => r.docsEnabled);
    const mocksRepos = repositoriesToIngest.filter(r => r.mocksEnabled);

    let syncOptions: SyncOptions | undefined;
    if (docsRepos.length > 0 || mocksRepos.length > 0) {
      syncOptions = {};

      // If all repos have docs enabled, use true; otherwise use comma-separated repo names
      if (docsRepos.length > 0) {
        syncOptions.docs = docsRepos.length === repositoriesToIngest.length
          ? true
          : docsRepos.map(r => r.name).join(',');
      }

      // If all repos have mocks enabled, use true; otherwise use comma-separated repo names
      if (mocksRepos.length > 0) {
        syncOptions.mocks = mocksRepos.length === repositoriesToIngest.length
          ? true
          : mocksRepos.map(r => r.name).join(',');
      }

      console.log(`[STAKGRAPH_INGEST] Sync options - docs: ${syncOptions.docs}, mocks: ${syncOptions.mocks}`);
    }

    const finalRepoUrls = repositoriesToIngest.map(repo => repo.repositoryUrl).join(',');
    console.log(`[STAKGRAPH_INGEST] Repository URLs to ingest: ${finalRepoUrls}`);

    // Check if ingest request is already in progress
    if (swarm.ingestRequestInProgress) {
      console.log(`[STAKGRAPH_INGEST] Ingest request already in progress for swarm: ${swarm.name}`);
      return NextResponse.json({
        success: false,
        message: "Ingest request already in progress for this swarm"
      }, { status: 409 });
    }

    // Set ingest request in progress flag
    console.log(`[STAKGRAPH_INGEST] Setting ingestRequestInProgress to true`);
    await saveOrUpdateSwarm({
      workspaceId: swarm.workspaceId,
      ingestRequestInProgress: true,
    });
    console.log(`[STAKGRAPH_INGEST] Ingest request marked as in progress`);

    // Update all repositories being ingested to PENDING status
    console.log(`[STAKGRAPH_INGEST] Updating ${repositoriesToIngest.length} repository/repositories status to PENDING`);
    await Promise.all(
      repositoriesToIngest.map(repo =>
        db.repository.update({
          where: {
            repositoryUrl_workspaceId: {
              repositoryUrl: repo.repositoryUrl,
              workspaceId: repoWorkspaceId
            }
          },
          data: { status: RepositoryStatus.PENDING }
        })
      )
    );
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
    console.log(`[STAKGRAPH_INGEST] Starting ingest trigger - use_lsp: ${use_lsp}, swarm: ${swarm.name}, repos: ${finalRepoUrls}`);

    const swarmVanityAddress = getSwarmVanityAddress(swarm.name);
    const decryptedApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
    const stakgraphCallbackUrl = getStakgraphWebhookCallbackUrl(request);

    console.log(`[STAKGRAPH_INGEST] Ingest parameters - vanity address: ${swarmVanityAddress}, callback URL: ${stakgraphCallbackUrl}, API key present: ${!!decryptedApiKey}`);

    const startTime = Date.now();
    const apiResult = await triggerIngestAsync(
      swarmVanityAddress,
      decryptedApiKey,
      finalRepoUrls,
      { username, pat },
      stakgraphCallbackUrl,
      use_lsp,
      syncOptions,
    );

    const ingestDuration = Date.now() - startTime;
    console.log(`[STAKGRAPH_INGEST] Ingest trigger completed in ${ingestDuration}ms - success: ${apiResult.ok}, status: ${apiResult.status}`);

    // Check if external service is already processing another request
    if (apiResult?.data && typeof apiResult.data === "object" && "error" in apiResult.data) {
      const errorMsg = apiResult.data.error as string;
      if (errorMsg.includes("System is busy processing another request")) {
        console.log(`[STAKGRAPH_INGEST] External service busy, keeping flag set and returning 409`);
        // NOTE: We keep ingestRequestInProgress: true to prevent more requests
        // The flag will be reset when the external processing completes via webhook
        return NextResponse.json({
          success: false,
          message: "Ingest request already in progress for this swarm"
        }, { status: 409 });
      }
    }

    try {
      // Set up GitHub webhooks only for repositories with code ingestion enabled
      // (repositoriesToIngest is already filtered to only include codeIngestionEnabled repos)
      console.log(`[STAKGRAPH_INGEST] Setting up GitHub webhooks for ${repositoriesToIngest.length} repository/repositories`);
      const callbackUrl = getGithubWebhookCallbackUrl(repoWorkspaceId, request);
      const webhookService = new WebhookService(getServiceConfig("github"));
      console.log(`[STAKGRAPH_INGEST] GitHub webhook callback URL: ${callbackUrl}`);

      await Promise.all(
        repositoriesToIngest.map(repo =>
          webhookService.ensureRepoWebhook({
            userId: session.user.id,
            workspaceId: repoWorkspaceId,
            repositoryUrl: repo.repositoryUrl,
            callbackUrl,
          })
        )
      );
      console.log(`[STAKGRAPH_INGEST] GitHub webhook setup completed successfully for all repositories`);
    } catch (error) {
      console.error(`[STAKGRAPH_INGEST] Error ensuring repo webhooks: ${error}`);
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

    // Reset ingest request flag on successful completion
    console.log(`[STAKGRAPH_INGEST] Resetting ingestRequestInProgress flag on success`);
    await saveOrUpdateSwarm({
      workspaceId: swarm.workspaceId,
      ingestRequestInProgress: false,
    });

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

    // Try to reset ingest request flag on unexpected error
    try {
      if (!workspaceId) {
        console.log(`[STAKGRAPH_INGEST] No workspaceId available in error handler`);
        return NextResponse.json({ success: false, message: "Failed to ingest code" }, { status: 500 });
      }

      const swarm = await db.swarm.findUnique({ where: { workspaceId } });
      if (swarm) {
        console.log(`[STAKGRAPH_INGEST] Resetting ingestRequestInProgress flag after error`);
        await saveOrUpdateSwarm({
          workspaceId: swarm.workspaceId,
          ingestRequestInProgress: false,
        });
        console.log(`[STAKGRAPH_INGEST] Ingest request flag reset after error`);
      }
    } catch (resetError) {
      console.error(`[STAKGRAPH_INGEST] Failed to reset ingest request flag:`, resetError);
    }

    return NextResponse.json({ success: false, message: "Failed to ingest code" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const workspaceId = searchParams.get("workspaceId");

  console.log(`[STAKGRAPH_STATUS] Getting ingest status - id: ${id}, workspaceId: ${workspaceId}`);

  try {
    const session = await getServerSession(authOptions);
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
