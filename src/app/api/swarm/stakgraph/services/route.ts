import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { parseEnv } from "@/lib/env-parser";
import { swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm, ServiceConfig } from "@/services/swarm/db";
import { fetchStakgraphServices, pollAgentProgress } from "@/services/swarm/stakgraph-services";
import { devcontainerJsonContent, parsePM2Content } from "@/utils/devContainerUtils";
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
    const swarmId = searchParams.get("swarmId");
    const repo_url_param = searchParams.get("repo_url");

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
    if (swarmId) where.swarmId = swarmId;
    else if (workspaceId) where.workspaceId = workspaceId;

    const swarm = await db.swarm.findFirst({ where });

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
          status: 200,
          data: { services },
        },
        { status: 200 },
      );
    }

    // Only fetch GitHub profile if we need to make API calls
    const decryptedApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

    // Get the workspace associated with this swarm
    const workspace = await db.workspace.findUnique({
      where: { id: swarm.workspaceId },
      select: { slug: true }
    });

    if (!workspace) {
      return NextResponse.json({ success: false, message: "Workspace not found for swarm" }, { status: 404 });
    }

    const githubProfile = await getGithubUsernameAndPAT(session.user.id, workspace.slug);

    // Use repo_url from params or fall back to database
    const repo_url = repo_url_param || swarm.repositoryUrl;

    let responseData: { services: ServiceConfig[] };
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
        console.log('[stakgraph/services] Starting agent mode for repo:', repo_url);
        const { owner, repo } = parseGithubOwnerRepo(repo_url);
        console.log('[stakgraph/services] Parsed GitHub:', { owner, repo });

        // Start the agent request with proper GitHub authentication
        console.log('[stakgraph/services] Initiating agent request to:', swarmUrl);
        console.log('[stakgraph/services] Agent request params:', {
          owner,
          repo,
          hasUsername: !!githubProfile?.username,
          hasPAT: !!githubProfile?.token
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
          console.error('[stakgraph/services] Agent init failed:', agentInitResult);
          throw new Error("Failed to initiate agent");
        }

        const initData = agentInitResult.data as { request_id: string };
        console.log('[stakgraph/services] Agent init response:', initData);
        if (!initData.request_id) {
          console.error('[stakgraph/services] No request_id in response:', initData);
          throw new Error("No request_id received from agent");
        }

        // Poll for completion
        console.log('[stakgraph/services] Starting to poll agent with request_id:', initData.request_id);
        const agentResult = await pollAgentProgress(
          swarmUrl,
          initData.request_id,
          decryptedApiKey
        );
        console.log('[stakgraph/services] Agent polling completed, result ok:', agentResult.ok);

        if (!agentResult.ok) {
          console.error('[stakgraph/services] Agent failed, full result:', JSON.stringify(agentResult, null, 2));
          throw new Error("Agent failed to complete");
        }

        const agentFiles = agentResult.data as Record<string, string>;

        // Parse pm2.config.js to extract services
        const pm2Content = agentFiles["pm2.config.js"];
        const services = parsePM2Content(pm2Content);

        // Parse .env file if present from agent
        let agentEnvVars: Record<string, string> = {};
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

            agentEnvVars = parseEnv(envText);
          } catch (e) {
            console.error("Failed to parse .env file from agent:", e);
          }
        }

        // Now fetch from stakgraph to get any additional env vars
        const stakgraphResult = await fetchStakgraphServices(swarmUrl, decryptedApiKey, {
          clone: "true",  // Always clone to ensure we get the latest code
          ...(repo_url ? { repo_url } : {}),
          ...(githubProfile?.username ? { username: githubProfile.username } : {}),
          ...(githubProfile ? { pat: githubProfile.token } : {}),
        });

        // Hybrid approach: merge environment variables (agent takes precedence)
        const mergedEnvVars: Record<string, string> = {};

        // First add stakgraph env vars
        if (stakgraphResult.environmentVariables) {
          for (const env of stakgraphResult.environmentVariables) {
            mergedEnvVars[env.name] = env.value;
          }
        }

        // Then overwrite with agent env vars (agent takes precedence)
        for (const [name, value] of Object.entries(agentEnvVars)) {
          mergedEnvVars[name] = value;
        }

        // Convert merged env vars to array format
        environmentVariables = Object.entries(mergedEnvVars).map(([name, value]) => ({
          name,
          value
        }));

        // Prepare container files
        // Use swarm's repository name if available, otherwise use the repo name from URL
        const repoName = swarm.repositoryName || repo;
        containerFiles = {
          "Dockerfile": Buffer.from("FROM ghcr.io/stakwork/staklink-universal:latest").toString('base64'),
          "pm2.config.js": Buffer.from(agentFiles["pm2.config.js"] || "").toString('base64'),
          "docker-compose.yml": Buffer.from(agentFiles["docker-compose.yml"] || "").toString('base64'),
          "devcontainer.json": Buffer.from(devcontainerJsonContent(repoName)).toString('base64')
        };

        responseData = { services };

      } catch (error) {
        console.error('[stakgraph/services] Agent mode failed, detailed error:', error);
        console.error('[stakgraph/services] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        console.error("Agent mode failed, falling back to stakgraph services endpoint:", error);
        // Fall back to stakgraph services endpoint
        console.log('[stakgraph/services] Calling fallback stakgraph services with params:', {
          swarmUrl,
          hasApiKey: !!decryptedApiKey,
          repo_url,
          hasUsername: !!githubProfile?.username,
          hasPAT: !!githubProfile?.token
        });
        const result = await fetchStakgraphServices(swarmUrl, decryptedApiKey, {
          clone: "true",  // Always clone to ensure we get the latest code
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
        clone: "true",  // Always clone to ensure we get the latest code
        ...(githubProfile?.username ? { username: githubProfile.username } : {}),
        ...(githubProfile ? { pat: githubProfile.token } : {}),
      });

      responseData = { services: result.services };
      environmentVariables = result.environmentVariables;
    }

    // Save services, environment variables, and container files to database
    await saveOrUpdateSwarm({
      workspaceId: swarm.workspaceId,
      services: responseData.services,
      ...(environmentVariables ? { environmentVariables } : {}),
      ...(containerFiles ? { containerFiles } : {}),
    });

    return NextResponse.json(
      {
        success: true,
        status: 200,
        data: responseData,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[stakgraph/services] Unhandled error:', error);
    console.error('[stakgraph/services] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error("Unhandled error:", error);
    return NextResponse.json({ success: false, message: "Failed to ingest code" }, { status: 500 });
  }
}
