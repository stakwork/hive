import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { parseEnv } from "@/lib/env-parser";
import { swarmApiRequestAuth } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm, ServiceConfig } from "@/services/swarm/db";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

// Parse pm2.config.js content to extract ServiceConfig[]
function parsePM2ConfigToServices(pm2Content: string): ServiceConfig[] {
  const services: ServiceConfig[] = [];

  try {
    // Match the apps array in the module.exports
    const appsMatch = pm2Content.match(/apps:\s*\[([\s\S]*?)\]/);
    if (!appsMatch) return services;

    const appsContent = appsMatch[1];

    // Split by service objects (look for name: pattern)
    const serviceBlocks = appsContent.split(/(?=name:)/);

    for (const block of serviceBlocks) {
      if (!block.trim()) continue;

      // Extract fields using regex
      const nameMatch = block.match(/name:\s*["']([^"']+)["']/);
      const scriptMatch = block.match(/script:\s*["']([^"']+)["']/);
      const cwdMatch = block.match(/cwd:\s*["']([^"']+)["']/);
      const interpreterMatch = block.match(/interpreter:\s*["']([^"']+)["']/);

      // Extract env variables
      const envMatch = block.match(/env:\s*\{([\s\S]*?)\}/);
      let port = 3000;
      let installCmd: string | undefined;
      let buildCmd: string | undefined;
      let testCmd: string | undefined;
      let preStartCmd: string | undefined;
      let postStartCmd: string | undefined;
      let rebuildCmd: string | undefined;

      if (envMatch) {
        const envContent = envMatch[1];
        const portMatch = envContent.match(/PORT:\s*["'](\d+)["']/);
        const installMatch = envContent.match(/INSTALL_COMMAND:\s*["']([^"']+)["']/);
        const buildMatch = envContent.match(/BUILD_COMMAND:\s*["']([^"']+)["']/);
        const testMatch = envContent.match(/TEST_COMMAND:\s*["']([^"']+)["']/);
        const preStartMatch = envContent.match(/PRE_START_COMMAND:\s*["']([^"']+)["']/);
        const postStartMatch = envContent.match(/POST_START_COMMAND:\s*["']([^"']+)["']/);
        const rebuildMatch = envContent.match(/REBUILD_COMMAND:\s*["']([^"']+)["']/);

        if (portMatch) port = parseInt(portMatch[1]);
        if (installMatch) installCmd = installMatch[1];
        if (buildMatch) buildCmd = buildMatch[1];
        if (testMatch) testCmd = testMatch[1];
        if (preStartMatch) preStartCmd = preStartMatch[1];
        if (postStartMatch) postStartCmd = postStartMatch[1];
        if (rebuildMatch) rebuildCmd = rebuildMatch[1];
      }

      if (nameMatch && scriptMatch) {
        // Extract cwd to determine if it's a subdirectory
        let serviceDir: string | undefined;
        if (cwdMatch) {
          const cwdPath = cwdMatch[1];
          // Extract subdirectory from path like /workspaces/reponame/subdirectory
          const pathParts = cwdPath.split('/').filter(p => p);
          if (pathParts.length > 2) {
            // Has subdirectory beyond /workspaces/reponame
            serviceDir = pathParts.slice(2).join('/');
          }
        }

        const service: ServiceConfig = {
          name: nameMatch[1],
          port,
          cwd: serviceDir,
          interpreter: interpreterMatch ? interpreterMatch[1] : undefined,
          scripts: {
            start: scriptMatch[1],
            install: installCmd,
            build: buildCmd,
            test: testCmd,
            preStart: preStartCmd,
            postStart: postStartCmd,
            rebuild: rebuildCmd,
          }
        };

        services.push(service);
      }
    }
  } catch (error) {
    console.error("Failed to parse pm2.config.js:", error);
  }

  // Return at least one default service if parsing failed
  if (services.length === 0) {
    services.push({
      name: "app",
      port: 3000,
      scripts: {
        start: "npm run dev",
        install: "npm install",
        build: "npm run build"
      }
    });
  }

  return services;
}

// Poll agent progress endpoint
async function pollAgentProgress(
  swarmUrl: string,
  requestId: string,
  apiKey: string,
  maxAttempts = 30,
  delayMs = 2000
): Promise<{ ok: boolean; data?: unknown; status: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const progressResult = await swarmApiRequestAuth({
      swarmUrl: `https://${swarmUrl}:3355`,
      endpoint: "/progress",
      method: "GET",
      params: { request_id: requestId },
      apiKey,
    });

    if (!progressResult.ok) {
      console.error(`Progress check failed:`, progressResult);
      return progressResult;
    }

    const progressData = progressResult.data as { status: string; result?: Record<string, string> };

    if (progressData.status === "completed" && progressData.result) {
      return {
        ok: true,
        data: progressData.result,
        status: 200
      };
    } else if (progressData.status === "failed") {
      return {
        ok: false,
        data: progressData,
        status: 500
      };
    }

    // Still in progress, wait before next attempt
    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return {
    ok: false,
    data: { error: "Agent timeout - took too long to complete" },
    status: 408
  };
}

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
        const pm2Content = agentFiles["pm2.config.js"];
        let services: ServiceConfig[] = [];

        if (pm2Content) {
          // Try to parse - could be plain text or base64
          try {
            // Try plain text first
            services = parsePM2ConfigToServices(pm2Content);
          } catch {
            // If that fails, try decoding from base64
            try {
              const decoded = Buffer.from(pm2Content, 'base64').toString('utf-8');
              services = parsePM2ConfigToServices(decoded);
            } catch (e) {
              console.error("Failed to parse pm2.config.js:", e);
              services = [];
            }
          }
        }

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
        const apiResult = await swarmApiRequestAuth({
          swarmUrl: `https://${swarmVanityAddress}:3355`,
          endpoint: "/services",
          method: "GET",
          params: {
            ...(clone === "true" ? { clone } : {}),
            ...(repo_url ? { repo_url } : {}),
            ...(githubProfile?.username ? { username: githubProfile.username } : {}),
            ...(githubProfile ? { pat: githubProfile.appAccessToken || githubProfile.pat } : {}),
          },
          apiKey: decryptedApiKey,
        });

        responseData = Array.isArray(apiResult.data)
          ? { services: apiResult.data as ServiceConfig[] }
          : (apiResult.data as { services: ServiceConfig[] });
      }
    } else {
      // No repo_url provided - call stakgraph services endpoint
      const apiResult = await swarmApiRequestAuth({
        swarmUrl: `https://${swarmVanityAddress}:3355`,
        endpoint: "/services",
        method: "GET",
        params: {
          ...(clone === "true" ? { clone } : {}),
          ...(githubProfile?.username ? { username: githubProfile.username } : {}),
          ...(githubProfile ? { pat: githubProfile.appAccessToken || githubProfile.pat } : {}),
        },
        apiKey: decryptedApiKey,
      });

      responseData = Array.isArray(apiResult.data)
        ? { services: apiResult.data as ServiceConfig[] }
        : (apiResult.data as { services: ServiceConfig[] });

      // Extract environment variables from stakgraph services[].env if present
      if (responseData.services?.[0]?.env) {
        const envObj = responseData.services[0].env as Record<string, string>;
        environmentVariables = Object.entries(envObj).map(([name, value]) => ({
          name,
          value
        }));
      }
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
