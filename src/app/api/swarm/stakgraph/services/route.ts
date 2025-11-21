import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm, ServiceConfig } from "@/services/swarm/db";
import { fetchStakgraphServices } from "@/services/swarm/stakgraph-services";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest) {
  console.log("Getting services");
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const swarmId = searchParams.get("swarmId");
    const repo_url_param = searchParams.get("repo_url");

    console.log("workspaceId", workspaceId);
    console.log("swarmId", swarmId);
    console.log("repo_url_param", repo_url_param);

    if (!workspaceId && !swarmId) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing required fields: must provide either workspaceId or swarmId",
        },
        { status: 400 },
      );
    }

    const where: Record<string, string> = {};
    if (swarmId) where.id = swarmId;
    else if (workspaceId) where.workspaceId = workspaceId;

    console.log("where", where);

    const swarm = await db.swarm.findFirst({ where });

    console.log("swarm", swarm);

    if (!swarm) {
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false, message: "Swarm URL or API key not set" }, { status: 400 });
    }

    // Check if services already exist in database (services defaults to [] in DB)
    if (Array.isArray(swarm.services) && swarm.services.length > 0) {
      const services = swarm.services as unknown as ServiceConfig[];
      return NextResponse.json(
        {
          success: true,
          status: "COMPLETED",
          data: { services },
        },
        { status: 200 },
      );
    }

    // Check if there's already an ongoing agent process
    if (swarm.agentRequestId && swarm.agentStatus === "PROCESSING") {
      console.log("[stakgraph/services] Reusing existing agent request:", swarm.agentRequestId);
      return NextResponse.json(
        {
          success: true,
          status: "PROCESSING",
          data: {
            request_id: swarm.agentRequestId,
          },
        },
        { status: 202 },
      );
    }

    // Only fetch GitHub profile if we need to make API calls
    const decryptedApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

    // Get the workspace associated with this swarm
    const workspace = await db.workspace.findUnique({
      where: { id: swarm.workspaceId },
      select: { slug: true },
    });

    if (!workspace) {
      return NextResponse.json({ success: false, message: "Workspace not found for swarm" }, { status: 404 });
    }

    const githubProfile = await getGithubUsernameAndPAT(session.user.id, workspace.slug);

    const primaryRepo = await getPrimaryRepository(swarm.workspaceId);
    const repo_url = repo_url_param || primaryRepo?.repositoryUrl;

    let responseData: { services: ServiceConfig[] } | undefined;
    let environmentVariables: Array<{ name: string; value: string }> | undefined;
    let containerFiles: Record<string, string> | undefined;
    const cleanSwarmUrl = swarm?.swarmUrl ? swarm.swarmUrl.replace("/api", "") : "";

    let swarmUrl = `${cleanSwarmUrl}:3355`;
    if (swarm.swarmUrl.includes("localhost")) {
      swarmUrl = `http://localhost:3355`;
    }

    // Always try agent first if repo_url is provided
    if (repo_url) {
      // Agent mode - call services_agent endpoint
      try {
        console.log("[stakgraph/services] Starting agent mode for repo:", repo_url);
        const { owner, repo } = parseGithubOwnerRepo(repo_url);
        console.log("[stakgraph/services] Parsed GitHub:", { owner, repo });

        // Start the agent request with proper GitHub authentication
        console.log("[stakgraph/services] Initiating agent request to:", swarmUrl);
        console.log("[stakgraph/services] Agent request params:", {
          owner,
          repo,
          hasUsername: !!githubProfile?.username,
          hasPAT: !!githubProfile?.token,
        });
        const agentInitResult = await swarmApiRequestAuth({
          swarmUrl: swarmUrl,
          endpoint: "/services_agent",
          method: "GET",
          params: {
            owner,
            repo,
            ...(githubProfile?.username ? { username: githubProfile.username } : {}),
            ...(githubProfile ? { pat: githubProfile.token } : {}),
          },
          apiKey: decryptedApiKey,
        });

        if (!agentInitResult.ok) {
          console.error("[stakgraph/services] Agent init failed:", agentInitResult);
          throw new Error("Failed to initiate agent");
        }

        const initData = agentInitResult.data as { request_id: string };
        console.log("[stakgraph/services] Agent init response:", initData);
        if (!initData.request_id) {
          console.error("[stakgraph/services] No request_id in response:", initData);
          throw new Error("No request_id received from agent");
        }

        // Store the agent request ID and status in database
        await db.swarm.update({
          where: { id: swarm.id },
          data: {
            agentRequestId: initData.request_id,
            agentStatus: "PROCESSING",
          },
        });

        // Return immediately with request_id for SSE streaming
        console.log(
          "[stakgraph/services] Agent initiated, returning request_id for SSE streaming:",
          initData.request_id,
        );

        return NextResponse.json(
          {
            success: true,
            status: "PROCESSING",
            data: {
              request_id: initData.request_id,
            },
          },
          { status: 202 },
        );
      } catch (error) {
        console.error("[stakgraph/services] Agent mode failed, detailed error:", error);
        console.error("[stakgraph/services] Error stack:", error instanceof Error ? error.stack : "No stack trace");
        console.error("Agent mode failed, falling back to stakgraph services endpoint:", error);
        // Fall back to stakgraph services endpoint
        console.log("[stakgraph/services] Calling fallback stakgraph services with params:", {
          swarmUrl,
          hasApiKey: !!decryptedApiKey,
          repo_url,
          hasUsername: !!githubProfile?.username,
          hasPAT: !!githubProfile?.token,
        });
        const result = await fetchStakgraphServices(swarmUrl, decryptedApiKey, {
          clone: "true", // Always clone to ensure we get the latest code
          ...(repo_url ? { repo_url } : {}),
          ...(githubProfile?.username ? { username: githubProfile.username } : {}),
          ...(githubProfile ? { pat: githubProfile.token } : {}),
        });

        responseData = { services: result.services };
        environmentVariables = result.environmentVariables;
      }
    } else {
      // No repo_url provided - call stakgraph services endpoint
      const result = await fetchStakgraphServices(swarmUrl, decryptedApiKey, {
        clone: "true", // Always clone to ensure we get the latest code
        ...(githubProfile?.username ? { username: githubProfile.username } : {}),
        ...(githubProfile ? { pat: githubProfile.token } : {}),
      });

      responseData = { services: result.services };
      environmentVariables = result.environmentVariables;
    }

    // Only save and return data if we have it (fallback mode)
    if (responseData) {
      // Save services, environment variables, and container files to database
      await saveOrUpdateSwarm({
        workspaceId: swarm.workspaceId,
        services: responseData.services,
        ...(environmentVariables ? { environmentVariables } : {}),
        ...(containerFiles ? { containerFiles } : {}),
      });

      // Mark container files as set up since we have services and env vars
      await db.swarm.update({
        where: { id: swarm.id },
        data: { containerFilesSetUp: true },
      });

      return NextResponse.json(
        {
          success: true,
          status: "COMPLETED",
          data: responseData,
        },
        { status: 200 },
      );
    }

    // This should not happen if agent mode returns early
    return NextResponse.json({ success: false, message: "No data to return" }, { status: 500 });
  } catch (error) {
    console.error("[stakgraph/services] Unhandled error:", error);
    console.error("[stakgraph/services] Error stack:", error instanceof Error ? error.stack : "No stack trace");
    console.error("Unhandled error:", error);
    return NextResponse.json({ success: false, message: "Failed to ingest code" }, { status: 500 });
  }
}
