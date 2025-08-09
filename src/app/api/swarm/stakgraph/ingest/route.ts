import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { RepositoryStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { EncryptionService } from "@/lib/encryption";

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

    // Get user's GitHub username and PAT using the reusable utility
    const githubCreds = await getGithubUsernameAndPAT(session.user.id);
    if (!githubCreds) {
      return NextResponse.json(
        {
          success: false,
          message: "No GitHub credentials found for user",
        },
        { status: 400 },
      );
    }
    const { username, pat } = githubCreds;

    // Resolve Swarm
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

    const dataApi = {
      repo_url: final_repo_url,
      username,
      pat,
    };

    const stakgraphUrl = `https://${swarm.name}:7799`;

    // Proxy to stakgraph microservice
    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: "/ingest_async",
      method: "POST",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
      data: dataApi,
    });

    // If success, update repository status to SYNCED
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

    // ts-expect-error
    if (apiResult?.data?.request_id) {
      await saveOrUpdateSwarm({
        workspaceId: swarm.workspaceId,
        ingestRefId: apiResult.data?.request_id,
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const swarmId = searchParams.get("swarmId");
  const workspaceId = searchParams.get("workspaceId");

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: id" },
        { status: 400 },
      );
    }

    // Get user's GitHub username and PAT using the reusable utility
    const githubCreds = await getGithubUsernameAndPAT(session.user.id);
    if (!githubCreds) {
      return NextResponse.json(
        {
          success: false,
          message: "No GitHub credentials found for user",
        },
        { status: 400 },
      );
    }
    // const { username, pat } = githubCreds;

    // Resolve Swarm
    const where: Record<string, string> = {};
    if (swarmId) {
      where.swarmId = swarmId;
    }
    if (!swarmId && workspaceId) {
      where.workspaceId = workspaceId;
    }
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

    const stakgraphUrl = `https://${swarm.name}:7799`;

    // Proxy to stakgraph microservice
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
  } catch {
    return NextResponse.json(
      { success: false, message: "Failed to ingest code" },
      { status: 500 },
    );
  }
}
