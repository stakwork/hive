import { getServiceConfig } from "@/config/services";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getGithubWebhookCallbackUrl, getStakgraphWebhookCallbackUrl } from "@/lib/url";
import { WebhookService } from "@/services/github/WebhookService";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { triggerIngestAsync } from "@/services/swarm/stakgraph-actions";
import { RepositoryStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { getPrimaryRepository } from "@/lib/helpers/repository";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId, swarmId, useLsp } = body;

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

    const repoWorkspaceId = workspaceId || swarm.workspaceId;

    const primaryRepo = await getPrimaryRepository(swarm.workspaceId);
    const final_repo_url = primaryRepo?.repositoryUrl;
    const branch = primaryRepo?.branch || "";

    if (!final_repo_url) {
      return NextResponse.json({ success: false, message: "No repository URL found" }, { status: 400 });
    }

    if (!repoWorkspaceId) {
      return NextResponse.json({ success: false, message: "No repository workspace ID found" }, { status: 400 });
    }

    const repository = await db.repository.upsert({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl: final_repo_url,
          workspaceId: repoWorkspaceId,
        },
      },
      update: { status: RepositoryStatus.PENDING },
      create: {
        name: final_repo_url.split("/").pop() || final_repo_url,
        repositoryUrl: final_repo_url,
        workspaceId: repoWorkspaceId,
        status: RepositoryStatus.PENDING,
        branch,
      },
    });

    // Get the workspace for GitHub access
    const workspace = await db.workspace.findUnique({
      where: { id: repoWorkspaceId },
      select: { slug: true },
    });

    if (!workspace) {
      return NextResponse.json({ success: false, message: "Workspace not found" }, { status: 404 });
    }

    const creds = await getGithubUsernameAndPAT(session.user.id, workspace.slug);
    const username = creds?.username ?? "";
    const pat = creds?.token ?? "";

    const use_lsp = useLsp === "true" || useLsp === true;
    const apiResult = await triggerIngestAsync(
      getSwarmVanityAddress(swarm.name),
      encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
      final_repo_url,
      { username, pat },
      getStakgraphWebhookCallbackUrl(request),
      use_lsp,
    );

    try {
      const callbackUrl = getGithubWebhookCallbackUrl(request);
      const webhookService = new WebhookService(getServiceConfig("github"));
      await webhookService.ensureRepoWebhook({
        userId: session.user.id,
        workspaceId: repoWorkspaceId,
        repositoryUrl: final_repo_url,
        callbackUrl,
      });
    } catch (error) {
      console.error(`Error ensuring repo webhook: ${error}`);
    }

    if (apiResult?.data && typeof apiResult.data === "object" && "request_id" in apiResult.data) {
      await saveOrUpdateSwarm({
        workspaceId: swarm.workspaceId,
        ingestRefId: (apiResult.data as { request_id: string }).request_id,
      });
    }

    return NextResponse.json(
      {
        success: apiResult.ok,
        status: apiResult.status,
        data: apiResult.data,
        repositoryStatus: repository.status,
      },
      { status: apiResult.status },
    );
  } catch (error) {
    console.error("Error ingesting code:", error);
    return NextResponse.json({ success: false, message: "Failed to ingest code" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const workspaceId = searchParams.get("workspaceId");

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    if (!id || !workspaceId) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: id, workspaceId" },
        { status: 400 },
      );
    }

    // Get the workspace for GitHub access
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true },
    });

    if (!workspace) {
      return NextResponse.json({ success: false, message: "Workspace not found" }, { status: 404 });
    }

    const githubCreds = await getGithubUsernameAndPAT(session.user.id, workspace.slug);
    if (!githubCreds) {
      return NextResponse.json(
        {
          success: false,
          message: "No GitHub credentials found for user",
        },
        { status: 400 },
      );
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId },
    });

    if (!swarm) {
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }
    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false, message: "Swarm URL or API key not set" }, { status: 400 });
    }

    const stakgraphUrl = `https://${getSwarmVanityAddress(swarm.name)}:7799`;

    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: `/status/${id}`,
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
    });

    return NextResponse.json(
      {
        apiResult,
      },
      { status: apiResult.status },
    );
  } catch (error) {
    console.error(`Error getting ingest status: ${error}`);
    return NextResponse.json({ success: false, message: "Failed to ingest code" }, { status: 500 });
  }
}
