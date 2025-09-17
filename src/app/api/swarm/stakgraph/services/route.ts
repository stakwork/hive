import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
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
    const repo_url = searchParams.get("repo_url");
    const agent = searchParams.get("agent");

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

    const githubProfile = await getGithubUsernameAndPAT(session?.user?.id);
    const swarmVanityAddress = getSwarmVanityAddress(swarm.name);
    const decryptedApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

    let responseData: { services: ServiceConfig[] };
    let containerFiles: Record<string, string> | undefined;

    if (agent === "true" && repo_url) {
      // Agent mode - call services_agent endpoint
      try {
        const { owner, repo } = parseGithubOwnerRepo(repo_url);

        // Start the agent request
        const agentInitResult = await swarmApiRequestAuth({
          swarmUrl: `https://${swarmVanityAddress}:3355`,
          endpoint: "/services_agent",
          method: "GET",
          params: { owner, repo },
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
        const services = agentFiles["pm2.config.js"]
          ? parsePM2ConfigToServices(agentFiles["pm2.config.js"])
          : [];

        responseData = { services };
        containerFiles = agentFiles;

      } catch (error) {
        console.error("Agent mode failed, falling back to standard mode:", error);
        // Fall back to standard services endpoint
        const apiResult = await swarmApiRequestAuth({
          swarmUrl: `https://${swarmVanityAddress}:3355`,
          endpoint: "/services",
          method: "GET",
          params: {
            ...(clone === "true" ? { clone } : {}),
            ...(repo_url ? { repo_url } : {}),
            ...(githubProfile?.username ? { username: githubProfile?.username } : {}),
            ...(githubProfile?.pat ? { pat: githubProfile?.pat } : {}),
          },
          apiKey: decryptedApiKey,
        });

        responseData = Array.isArray(apiResult.data)
          ? { services: apiResult.data as ServiceConfig[] }
          : (apiResult.data as { services: ServiceConfig[] });
      }
    } else {
      // Standard mode - call regular services endpoint
      const apiResult = await swarmApiRequestAuth({
        swarmUrl: `https://${swarmVanityAddress}:3355`,
        endpoint: "/services",
        method: "GET",
        params: {
          ...(clone === "true" ? { clone } : {}),
          ...(repo_url ? { repo_url } : {}),
          ...(githubProfile?.username ? { username: githubProfile?.username } : {}),
          ...(githubProfile?.pat ? { pat: githubProfile?.pat } : {}),
        },
        apiKey: decryptedApiKey,
      });

      responseData = Array.isArray(apiResult.data)
        ? { services: apiResult.data as ServiceConfig[] }
        : (apiResult.data as { services: ServiceConfig[] });
    }

    // Save services and optionally container files
    await saveOrUpdateSwarm({
      workspaceId: swarm.workspaceId,
      services: responseData.services,
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
  } catch {
    return NextResponse.json({ success: false, message: "Failed to ingest code" }, { status: 500 });
  }
}
