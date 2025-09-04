import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { WebhookService } from "@/services/github/WebhookService";
import { getServiceConfig } from "@/config/services";
import {
  getGithubWebhookCallbackUrl,
  getStakgraphWebhookCallbackUrl,
} from "@/lib/url";
import { RepositoryStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { workspaceId, swarmId } = body;

    if (!swarmId) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: swarmId" },
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
    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json(
        { success: false, message: "Swarm URL or API key not set" },
        { status: 400 },
      );
    }

    const repoWorkspaceId = workspaceId || swarm.workspaceId;

    let final_repo_url;
    let branch = "";

    if (swarm.repositoryUrl && swarm.defaultBranch) {
      final_repo_url = swarm.repositoryUrl;
      branch = swarm.defaultBranch || "";
    }

    if (!final_repo_url) {
      return NextResponse.json(
        { success: false, message: "No repository URL found" },
        { status: 400 },
      );
    }

    if (!repoWorkspaceId) {
      return NextResponse.json(
        { success: false, message: "No repository workspace ID found" },
        { status: 400 },
      );
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

    const creds = await getGithubUsernameAndPAT(session.user.id);
    const dataApi = {
      repo_url: final_repo_url,
      username: creds?.username,
      pat: creds?.pat,
      callback_url: getStakgraphWebhookCallbackUrl(request),
    };

    const stakgraphUrl = `https://${getSwarmVanityAddress(swarm.name)}:7799`;

    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: "/ingest_async",
      method: "POST",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
      data: dataApi,
    });

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
    let finalStatus = repository.status;
    if (
      apiResult.ok &&
      apiResult.data &&
      typeof apiResult.data === "object" &&
      "status" in apiResult.data &&
      apiResult.data.status === "success"
    ) {
      await db.repository.update({
        where: { id: repository.id },
        data: { status: RepositoryStatus.SYNCED },
      });
      finalStatus = RepositoryStatus.SYNCED;
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
        repositoryStatus: finalStatus,
      },
      { status: apiResult.status },
    );
  } catch (error) {
    console.error("Error ingesting code:", error);
    return NextResponse.json(
      { success: false, message: "Failed to ingest code" },
      { status: 500 },
    );
  }
}
