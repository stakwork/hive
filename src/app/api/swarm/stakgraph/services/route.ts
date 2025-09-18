import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { parseEnv } from "@/lib/env-parser";
import { swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm, ServiceConfig } from "@/services/swarm/db";
import { fetchStakgraphServices, pollAgentProgress } from "@/services/swarm/stakgraph-services";
import { parsePM2Content } from "@/utils/devContainerUtils";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();


export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const clone = searchParams.get("clone");
    const swarmId = searchParams.get("swarmId");
    const repo_url_param = searchParams.get("repo_url");

    if (!workspaceId || !swarmId) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing required fields: workspaceId or swarmId",
        },
        { status: 400 },
      );
    }

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

    // Check if services already exist in database
    if (swarm.services && Array.isArray(swarm.services) && swarm.services.length > 0) {
      const services = swarm.services as unknown as ServiceConfig[];

      return NextResponse.json(
        {
          success: true,
          status: 200,
          data: { services },
        },
        { status: 200 },
      );
    }

    // Only fetch GitHub profile if we need to make API calls
    const swarmVanityAddress = getSwarmVanityAddress(swarm.name);
    const decryptedApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
    const githubProfile = await getGithubUsernameAndPAT(session?.user?.id);

    // Use repo_url from params or fall back to database
    const repo_url = repo_url_param || swarm.repositoryUrl;

    let responseData: { services: ServiceConfig[] };
    let environmentVariables: Array<{ name: string; value: string }> | undefined;

    // Always try agent first if repo_url is provided
    if (repo_url) {
      // Agent mode - call services_agent endpoint
      try {
        const { owner, repo } = parseGithubOwnerRepo(repo_url);

        // Start the agent request with proper GitHub authentication
        const agentInitResult = await swarmApiRequestAuth({
          swarmUrl: `https://${swarmVanityAddress}:3355`,
          endpoint: "/services_agent",
          method: "GET",
          params: {
            owner,
            repo,
            ...(githubProfile?.username ? { username: githubProfile.username } : {}),
            ...(githubProfile ? { pat: githubProfile.appAccessToken || githubProfile.pat } : {}),
          },
          apiKey: decryptedApiKey,
        });

        if (!agentInitResult.ok) {
          console.error("Agent init failed:", agentInitResult);
          throw new Error("Failed to initiate agent");
        }

        const initData = agentInitResult.data as { request_id: string };
        if (!initData.request_id) {
          throw new Error("No request_id received from agent");
        }

        // Poll for completion
        const agentResult = await pollAgentProgress(
          swarmVanityAddress,
          initData.request_id,
          decryptedApiKey
        );

        if (!agentResult.ok) {
          throw new Error("Agent failed to complete");
        }

        const agentFiles = agentResult.data as Record<string, string>;

        // Parse pm2.config.js to extract services
        const services = parsePM2Content(agentFiles["pm2.config.js"]);

        // Parse .env file if present from agent
        const envContent = agentFiles[".env"];
        if (envContent) {
          try {
            // Try to parse - could be plain text or base64
            let envText = envContent;
            try {
              // Check if it's base64
              const decoded = Buffer.from(envContent, 'base64').toString('utf-8');
              if (decoded.includes('=')) { // Simple check if it looks like env format
                envText = decoded;
              }
            } catch {
              // Use as plain text
            }

            const envVars = parseEnv(envText);
            environmentVariables = Object.entries(envVars).map(([name, value]) => ({
              name,
              value
            }));
          } catch (e) {
            console.error("Failed to parse .env file from agent:", e);
          }
        }

        responseData = { services };

      } catch (error) {
        console.error("Agent mode failed, falling back to stakgraph services endpoint:", error);
        // Fall back to stakgraph services endpoint
        const result = await fetchStakgraphServices(swarmVanityAddress, decryptedApiKey, {
          ...(clone === "true" ? { clone } : {}),
          ...(repo_url ? { repo_url } : {}),
          ...(githubProfile?.username ? { username: githubProfile.username } : {}),
          ...(githubProfile ? { pat: githubProfile.appAccessToken || githubProfile.pat } : {}),
        });

        responseData = { services: result.services };
        environmentVariables = result.environmentVariables;
      }
    } else {
      // No repo_url provided - call stakgraph services endpoint
      const result = await fetchStakgraphServices(swarmVanityAddress, decryptedApiKey, {
        ...(clone === "true" ? { clone } : {}),
        ...(githubProfile?.username ? { username: githubProfile.username } : {}),
        ...(githubProfile ? { pat: githubProfile.appAccessToken || githubProfile.pat } : {}),
      });

      responseData = { services: result.services };
      environmentVariables = result.environmentVariables;
    }

    // Save services and environment variables (only from agent) to database
    await saveOrUpdateSwarm({
      workspaceId: swarm.workspaceId,
      services: responseData.services,
      ...(environmentVariables ? { environmentVariables } : {}),
    });

    return NextResponse.json(
      {
        success: true,
        status: 200,
        data: responseData,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ success: false, message: "Failed to ingest code" }, { status: 500 });
  }
}
