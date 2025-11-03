import { getServiceConfig } from "@/config/services";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { logger } from "@/lib/logger";
import { getGithubWebhookCallbackUrl, getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { WebhookService } from "@/services/github/WebhookService";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { triggerIngestAsync } from "@/services/swarm/stakgraph-actions";
import { RepositoryStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();
export async function POST(request: NextRequest) {
  try {
    logger.info("Starting stakgraph ingest request", "STAKGRAPH_INGEST");
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      logger.warn("Unauthorized ingest request - no session or user ID", "STAKGRAPH_INGEST");
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId, swarmId, useLsp } = body;
    logger.info("Ingest request parameters", "STAKGRAPH_INGEST", { workspaceId, swarmId, useLsp, userId: session.user.id });

    logger.debug("Looking up swarm", "STAKGRAPH_INGEST", { swarmId, workspaceId });
    const where: Record<string, string> = {};
    if (swarmId) where.swarmId = swarmId;
    if (!swarmId && workspaceId) where.workspaceId = workspaceId;

    const swarm = await db.swarm.findFirst({ where });
    if (!swarm) {
      logger.warn("Swarm not found", "STAKGRAPH_INGEST", { where });
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }

    logger.debug("Found swarm", "STAKGRAPH_INGEST", { swarmId: swarm.id, name: swarm.name, status: swarm.status });

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      logger.warn("Swarm missing required fields", "STAKGRAPH_INGEST", { hasSwarmUrl: !!swarm.swarmUrl, hasSwarmApiKey: !!swarm.swarmApiKey });
      return NextResponse.json({ success: false, message: "Swarm URL or API key not set" }, { status: 400 });
    }

    const repoWorkspaceId = workspaceId || swarm.workspaceId;
    logger.debug("Using workspace ID", "STAKGRAPH_INGEST", { repoWorkspaceId });

    logger.debug("Looking up primary repository", "STAKGRAPH_INGEST", { workspaceId: repoWorkspaceId });
    const primaryRepo = await getPrimaryRepository(repoWorkspaceId);
    const finalRepo = primaryRepo?.repositoryUrl;

    if (!finalRepo) {
      logger.warn("No repository URL found", "STAKGRAPH_INGEST", { workspaceId: repoWorkspaceId });
      return NextResponse.json({ success: false, message: "No repository URL found" }, { status: 400 });
    }

    if (!repoWorkspaceId) {
      logger.warn("No repository workspace ID found", "STAKGRAPH_INGEST");
      return NextResponse.json({ success: false, message: "No repository workspace ID found" }, { status: 400 });
    }

    logger.debug("Repository details", "STAKGRAPH_INGEST", { repositoryUrl: finalRepo, workspaceId: repoWorkspaceId });

    // Update the existing repository status to PENDING (repository was created when swarm was created)
    logger.info("Updating repository status to PENDING", "STAKGRAPH_INGEST", { repositoryUrl: finalRepo, workspaceId: repoWorkspaceId });
    await db.repository.update({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl: finalRepo,
          workspaceId: repoWorkspaceId,
        },
      },
      data: { status: RepositoryStatus.PENDING },
    });
    logger.debug("Repository status updated to PENDING", "STAKGRAPH_INGEST");

    // Get workspace info to get the slug
    logger.debug("Looking up workspace details", "STAKGRAPH_INGEST", { workspaceId: repoWorkspaceId });
    const workspace = await db.workspace.findUnique({
      where: { id: repoWorkspaceId },
      select: { slug: true },
    });

    if (!workspace) {
      logger.warn("Workspace not found", "STAKGRAPH_INGEST", { workspaceId: repoWorkspaceId });
      return NextResponse.json({ success: false, message: "Workspace not found" }, { status: 404 });
    }

    logger.debug("Found workspace", "STAKGRAPH_INGEST", { slug: workspace.slug });

    // Get GitHub credentials using the standard function
    logger.debug("Getting GitHub credentials", "STAKGRAPH_INGEST", { userId: session.user.id, workspaceSlug: workspace.slug });
    const githubProfile = await getGithubUsernameAndPAT(session.user.id, workspace.slug);
    if (!githubProfile?.username || !githubProfile?.token) {
      logger.warn("No GitHub credentials found", "STAKGRAPH_INGEST", { hasUsername: !!githubProfile?.username, hasToken: !!githubProfile?.token });
      return NextResponse.json({ success: false, message: "No GitHub credentials found for this workspace" }, { status: 400 });
    }

    const username = githubProfile.username;
    const pat = githubProfile.token;
    logger.debug("GitHub credentials found", "STAKGRAPH_INGEST", { username });

    const use_lsp = useLsp === "true" || useLsp === true;
    logger.info("Starting ingest trigger", "STAKGRAPH_INGEST", { useLsp: use_lsp, swarmName: swarm.name, repositoryUrl: finalRepo });

    const swarmVanityAddress = getSwarmVanityAddress(swarm.name);
    const decryptedApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
    const stakgraphCallbackUrl = getStakgraphWebhookCallbackUrl(request);

    logger.debug("Ingest parameters prepared", "STAKGRAPH_INGEST", { vanityAddress: swarmVanityAddress, callbackUrl: stakgraphCallbackUrl, hasApiKey: !!decryptedApiKey });

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
    logger.info("Ingest trigger completed", "STAKGRAPH_INGEST", { durationMs: ingestDuration, success: apiResult.ok, status: apiResult.status });

    try {
      logger.debug("Setting up GitHub webhook", "STAKGRAPH_INGEST", { repositoryUrl: finalRepo });
      const callbackUrl = getGithubWebhookCallbackUrl(request);
      const webhookService = new WebhookService(getServiceConfig("github"));
      logger.debug("GitHub webhook callback URL prepared", "STAKGRAPH_INGEST", { callbackUrl });

      await webhookService.ensureRepoWebhook({
        userId: session.user.id,
        workspaceId: repoWorkspaceId,
        repositoryUrl: finalRepo,
        callbackUrl,
      });
      logger.info("GitHub webhook setup completed", "STAKGRAPH_INGEST");
    } catch (error) {
      logger.error("Error ensuring repo webhook", "STAKGRAPH_INGEST", error);
    }

    if (apiResult?.data && typeof apiResult.data === "object" && "request_id" in apiResult.data) {
      const requestId = (apiResult.data as { request_id: string }).request_id;
      logger.debug("Updating swarm with ingest request ID", "STAKGRAPH_INGEST", { requestId });
      await saveOrUpdateSwarm({
        workspaceId: swarm.workspaceId,
        ingestRefId: requestId,
      });
      logger.debug("Swarm updated with ingest reference ID", "STAKGRAPH_INGEST");
    } else {
      logger.debug("No request_id found in API result", "STAKGRAPH_INGEST", { apiResultData: apiResult?.data });
    }

    logger.debug("Returning ingest response", "STAKGRAPH_INGEST", { success: apiResult.ok, status: apiResult.status });
    return NextResponse.json(
      {
        success: apiResult.ok,
        status: apiResult.status,
        data: apiResult.data,
      },
      { status: apiResult.status },
    );
  } catch (error) {
    logger.error("Top-level error during ingest", "STAKGRAPH_INGEST", error);
    return NextResponse.json({ success: false, message: "Failed to ingest code" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const workspaceId = searchParams.get("workspaceId");

  logger.info("Getting ingest status", "STAKGRAPH_STATUS", { id, workspaceId });

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      logger.warn("Unauthorized status request", "STAKGRAPH_STATUS");
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    if (!id || !workspaceId) {
      logger.warn("Missing required fields", "STAKGRAPH_STATUS", { hasId: !!id, hasWorkspaceId: !!workspaceId });
      return NextResponse.json(
        { success: false, message: "Missing required fields: id, workspaceId" },
        { status: 400 },
      );
    }

    // Get the swarm for the workspace
    logger.debug("Looking up swarm", "STAKGRAPH_STATUS", { workspaceId });
    const swarm = await db.swarm.findUnique({
      where: { workspaceId },
    });

    if (!swarm) {
      logger.warn("Swarm not found", "STAKGRAPH_STATUS", { workspaceId });
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }

    logger.debug("Found swarm", "STAKGRAPH_STATUS", { swarmId: swarm.id, name: swarm.name });

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      logger.warn("Swarm missing required fields", "STAKGRAPH_STATUS", { hasSwarmUrl: !!swarm.swarmUrl, hasSwarmApiKey: !!swarm.swarmApiKey });
      return NextResponse.json({ success: false, message: "Swarm URL or API key not set" }, { status: 400 });
    }

    const stakgraphUrl = `https://${getSwarmVanityAddress(swarm.name)}:7799`;
    logger.debug("Calling stakgraph status API", "STAKGRAPH_STATUS", { url: `${stakgraphUrl}/status/${id}` });

    const startTime = Date.now();
    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: `/status/${id}`,
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
    });

    const apiDuration = Date.now() - startTime;
    logger.info("Status API call completed", "STAKGRAPH_STATUS", { durationMs: apiDuration, status: apiResult.status, ok: apiResult.ok });

    return NextResponse.json(
      {
        apiResult,
      },
      { status: apiResult.status },
    );
  } catch (error) {
    logger.error("Error getting ingest status", "STAKGRAPH_STATUS", error);
    return NextResponse.json({ success: false, message: "Failed to get ingest status" }, { status: 500 });
  }
}
