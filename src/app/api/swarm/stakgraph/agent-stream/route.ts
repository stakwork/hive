import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService, decryptEnvVars } from "@/lib/encryption";
import { parseEnv } from "@/lib/env-parser";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { pollAgentProgress } from "@/services/swarm/stakgraph-services";
import { devcontainerJsonContent, parsePM2Content } from "@/utils/devContainerUtils";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { getServerSession } from "next-auth/next";
import { NextRequest } from "next/server";
import { poolManagerService } from "@/lib/service-factory";
import { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
import { config } from "@/config/env";
import type { EnvironmentVariable, ServiceConfig } from "@/types";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    console.log("[agent-stream] Unauthorized access attempt", {
      timestamp: new Date().toISOString(),
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent'),
    });
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get("request_id");
  const swarmId = searchParams.get("swarm_id");

  const logContext = {
    userId: session.user.id,
    requestId,
    swarmId,
    timestamp: new Date().toISOString(),
    sessionId: Math.random().toString(36).substring(7), // Unique session identifier
  };

  console.log("[agent-stream] SSE connection initiated", logContext);

  if (!requestId || !swarmId) {
    console.warn("[agent-stream] Missing required parameters", {
      ...logContext,
      missingParams: { requestId: !requestId, swarmId: !swarmId },
    });
    return new Response("Missing required parameters", { status: 400 });
  }

  // Set up SSE headers
  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Cache-Control",
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: any, event = "message") => {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      try {
        // Get the swarm
        console.log("[agent-stream] Fetching swarm from database", logContext);
        const swarm = await db.swarm.findFirst({
          where: { id: swarmId },
          include: { workspace: { select: { slug: true } } }
        });

        if (!swarm) {
          console.error("[agent-stream] Swarm not found", {
            ...logContext,
            error: "Swarm not found in database",
          });
          sendEvent({ error: "Swarm not found" }, "error");
          controller.close();
          return;
        }

        console.log("[agent-stream] Swarm found, starting monitoring", {
          ...logContext,
          workspaceSlug: swarm.workspace.slug,
          swarmStatus: swarm.agentStatus,
          swarmUrl: swarm.swarmUrl?.replace(/\/api$/, ''), // Log without sensitive parts
        });

        // Send initial status
        sendEvent({ status: "STARTING", message: "Starting agent monitoring..." });

        const decryptedApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey!);
        const cleanSwarmUrl = swarm.swarmUrl!.replace("/api", "");
        let swarmUrl = `${cleanSwarmUrl}:3355`;
        if (swarm.swarmUrl!.includes("localhost")) {
          swarmUrl = `http://localhost:3355`;
        }

        // Background polling loop
        const pollAgent = async () => {
          let attempts = 0;
          const maxAttempts = 120; // 10 minutes with 5-second intervals
          const pollStartTime = Date.now();

          console.log("[agent-stream] Starting polling loop", {
            ...logContext,
            maxAttempts,
            timeoutMinutes: (maxAttempts * 5) / 60,
            swarmUrl: swarmUrl.replace(/\/\/.*@/, '//***@'), // Mask credentials in URL
          });

          while (attempts < maxAttempts) {
            const attemptStartTime = Date.now();
            try {
              sendEvent({
                status: "POLLING",
                message: `Checking agent progress... (${attempts + 1}/${maxAttempts})`,
                attempt: attempts + 1,
                maxAttempts
              });

              console.log("[agent-stream] Polling agent progress", {
                ...logContext,
                attempt: attempts + 1,
                maxAttempts,
                elapsedTime: Date.now() - pollStartTime,
              });

              const agentResult = await pollAgentProgress(swarmUrl, requestId, decryptedApiKey);

              console.log("[agent-stream] Agent poll result", {
                ...logContext,
                attempt: attempts + 1,
                success: agentResult.ok,
                pollDuration: Date.now() - attemptStartTime,
              });

              if (agentResult.ok) {
                // Agent completed successfully
                console.log("[agent-stream] Agent completed successfully", {
                  ...logContext,
                  totalAttempts: attempts + 1,
                  totalDuration: Date.now() - pollStartTime,
                });
                sendEvent({ status: "PROCESSING", message: "Agent completed, processing results..." });

                // Process the results
                const agentFiles = agentResult.data as Record<string, string>;
                console.log("[agent-stream] Processing agent files", {
                  ...logContext,
                  fileKeys: Object.keys(agentFiles),
                  fileCount: Object.keys(agentFiles).length,
                });

                const primaryRepo = await getPrimaryRepository(swarm.workspaceId);
                const repo_url = primaryRepo?.repositoryUrl;

                if (!repo_url) {
                  console.error("[agent-stream] No repository URL found", {
                    ...logContext,
                    workspaceId: swarm.workspaceId,
                  });
                  sendEvent({ error: "No repository URL found" }, "error");
                  controller.close();
                  return;
                }

                // Parse results
                const pm2Content = agentFiles["pm2.config.js"];
                const services = parsePM2Content(pm2Content);
                console.log("[agent-stream] Parsed PM2 services", {
                  ...logContext,
                  serviceCount: services?.length || 0,
                  serviceNames: services?.map(s => s.name) || [],
                });

                // Parse .env file
                let agentEnvVars: Record<string, string> = {};
                const envContent = agentFiles[".env"];
                if (envContent) {
                  try {
                    let envText = envContent;
                    try {
                      const decoded = Buffer.from(envContent, "base64").toString("utf-8");
                      if (decoded.includes("=")) {
                        envText = decoded;
                      }
                    } catch {
                      // Use as plain text
                    }
                    agentEnvVars = parseEnv(envText);
                    console.log("[agent-stream] Parsed environment variables", {
                      ...logContext,
                      envVarCount: Object.keys(agentEnvVars).length,
                      envVarKeys: Object.keys(agentEnvVars), // Log keys but not values for security
                    });
                  } catch (e) {
                    console.error("[agent-stream] Failed to parse .env file from agent", {
                      ...logContext,
                      error: e instanceof Error ? e.message : String(e),
                      envContentLength: envContent?.length || 0,
                    });
                  }
                } else {
                  console.warn("[agent-stream] No .env file found in agent results", logContext);
                }

                // Prepare container files
                const { repo } = parseGithubOwnerRepo(repo_url);
                const containerFiles = {
                  Dockerfile: Buffer.from("FROM ghcr.io/stakwork/staklink-universal:latest").toString("base64"),
                  "pm2.config.js": Buffer.from(agentFiles["pm2.config.js"] || "").toString("base64"),
                  "docker-compose.yml": Buffer.from(agentFiles["docker-compose.yml"] || "").toString("base64"),
                  "devcontainer.json": Buffer.from(devcontainerJsonContent(repo)).toString("base64"),
                };

                const environmentVariables = Object.entries(agentEnvVars).map(([name, value]) => ({
                  name,
                  value,
                }));

                // Save to database
                console.log("[agent-stream] Saving swarm data to database", {
                  ...logContext,
                  serviceCount: services?.length || 0,
                  envVarCount: environmentVariables.length,
                  containerFileCount: Object.keys(containerFiles).length,
                });

                await saveOrUpdateSwarm({
                  workspaceId: swarm.workspaceId,
                  services,
                  environmentVariables,
                  containerFiles,
                });

                // Update agent status to completed and mark container files as set up
                await db.swarm.update({
                  where: { id: swarm.id },
                  data: {
                    agentStatus: 'COMPLETED',
                    agentRequestId: null, // Clear the request ID
                    containerFilesSetUp: true, // Mark setup complete since we have services and env vars
                  },
                });

                console.log("[agent-stream] Agent processing completed successfully", {
                  ...logContext,
                  totalDuration: Date.now() - startTime,
                  pollDuration: Date.now() - pollStartTime,
                  finalServiceCount: services?.length || 0,
                });

                // Automatically create pool after successful services setup
                try {
                  console.log("[agent-stream] Starting automatic pool creation", {
                    ...logContext,
                    swarmId: swarm.id,
                  });

                  sendEvent({
                    status: "CREATING_POOL",
                    message: "Creating development environment..."
                  });

                  // Set poolState to STARTED before attempting creation
                  await saveOrUpdateSwarm({
                    workspaceId: swarm.workspaceId,
                    poolState: 'STARTED',
                  });

                  // Retrieve or generate pool API key
                  let poolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
                  if (!poolApiKey) {
                    console.log("[agent-stream] No pool API key found, generating new one", logContext);
                    await updateSwarmPoolApiKeyFor(swarm.id);
                    poolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
                  }

                  if (!poolApiKey) {
                    throw new Error("Failed to retrieve or generate pool API key");
                  }

                  // Get GitHub credentials
                  const github_pat = await getGithubUsernameAndPAT(session.user.id, swarm.workspace.slug);
                  console.log("[agent-stream] Retrieved GitHub credentials", {
                    ...logContext,
                    hasUsername: !!github_pat?.username,
                    hasPAT: !!github_pat?.token,
                  });

                  // Get repository
                  const repository = await db.repository.findFirst({
                    where: { workspaceId: swarm.workspaceId },
                  });

                  if (!repository) {
                    throw new Error("No repository found for workspace");
                  }

                  console.log("[agent-stream] Found repository", {
                    ...logContext,
                    repositoryUrl: repository.repositoryUrl,
                    branch: repository.branch,
                  });

                  // Decrypt environment variables from swarm
                  let decryptedEnvVars: EnvironmentVariable[] = [];
                  if (swarm.environmentVariables) {
                    try {
                      // Parse swarm.environmentVariables (handle both string and array)
                      let envVarsArray: Array<{ name: string; value: unknown }>;
                      
                      if (typeof swarm.environmentVariables === 'string') {
                        const parsed = JSON.parse(swarm.environmentVariables);
                        envVarsArray = Array.isArray(parsed) ? parsed : [];
                      } else if (Array.isArray(swarm.environmentVariables)) {
                        envVarsArray = swarm.environmentVariables as Array<{ name: string; value: unknown }>;
                      } else {
                        envVarsArray = [];
                      }

                      // Use decryptEnvVars to decrypt values
                      const decrypted = decryptEnvVars(envVarsArray);
                      
                      // Map to EnvironmentVariable[] format
                      decryptedEnvVars = decrypted.map(({ name, value }) => ({
                        name,
                        value: String(value),
                      }));

                      console.log("[agent-stream] Decrypted environment variables", {
                        ...logContext,
                        envVarCount: decryptedEnvVars.length,
                      });
                    } catch (error) {
                      console.error("[agent-stream] Failed to decrypt environment variables", {
                        ...logContext,
                        error: error instanceof Error ? error.message : String(error),
                      });
                      // Continue with empty env vars rather than failing
                      decryptedEnvVars = [];
                    }
                  }

                  // Initialize poolManagerService and update API key
                  const poolManager = poolManagerService();
                  const decryptedPoolApiKey = encryptionService.decryptField('poolApiKey', poolApiKey);
                  poolManager.updateApiKey(decryptedPoolApiKey);

                  console.log("[agent-stream] Calling poolManager.createPool", {
                    ...logContext,
                    poolName: swarm.id,
                    minimumVms: 2,
                    repositoryUrl: repository.repositoryUrl,
                    branch: repository.branch,
                    envVarCount: decryptedEnvVars.length,
                    containerFileCount: Object.keys(containerFiles).length,
                  });

                  // Call createPool with parameters
                  await poolManager.createPool({
                    pool_name: swarm.id,
                    minimum_vms: 2,
                    repo_name: repository.repositoryUrl || '',
                    branch_name: repository.branch || '',
                    github_pat: github_pat?.token || '',
                    github_username: github_pat?.username || '',
                    env_vars: decryptedEnvVars,
                    container_files: containerFiles,
                  });

                  // On success: update poolState to COMPLETE
                  await saveOrUpdateSwarm({
                    workspaceId: swarm.workspaceId,
                    poolName: swarm.id,
                    poolState: 'COMPLETE',
                  });

                  console.log("[agent-stream] Pool created successfully", {
                    ...logContext,
                    poolName: swarm.id,
                  });

                  sendEvent({
                    status: "POOL_CREATED",
                    message: "Development environment created successfully!"
                  });

                } catch (poolError) {
                  // On failure: set poolState to FAILED and log error
                  console.error("[agent-stream] Failed to create pool automatically", {
                    ...logContext,
                    error: poolError instanceof Error ? poolError.message : String(poolError),
                    errorStack: poolError instanceof Error ? poolError.stack : undefined,
                  });

                  try {
                    await saveOrUpdateSwarm({
                      workspaceId: swarm.workspaceId,
                      poolState: 'FAILED',
                    });
                  } catch (updateError) {
                    console.error("[agent-stream] Failed to update poolState to FAILED", {
                      ...logContext,
                      error: updateError instanceof Error ? updateError.message : String(updateError),
                    });
                  }

                  // Send error event but don't break the stream
                  sendEvent({
                    status: "POOL_CREATION_FAILED",
                    message: `Pool creation failed: ${poolError instanceof Error ? poolError.message : 'Unknown error'}. You can manually create the pool from the Services modal.`
                  });
                }

                // Send success event
                sendEvent({
                  status: "COMPLETED",
                  message: "Agent processing completed successfully!",
                  data: { services }
                }, "completed");

                controller.close();
                return;
              }

              // Agent still processing, continue polling
              attempts++;
              if (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
              }

            } catch (error) {
              console.error("[agent-stream] Error polling agent", {
                ...logContext,
                attempt: attempts + 1,
                error: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : undefined,
                elapsedTime: Date.now() - pollStartTime,
              });

              sendEvent({
                status: "ERROR",
                message: `Error polling agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
                attempt: attempts + 1
              });

              attempts++;
              if (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000));
              }
            }
          }

          // Timeout reached - clear agent status
          console.error("[agent-stream] Agent polling timed out", {
            ...logContext,
            totalAttempts: attempts,
            maxAttempts,
            totalDuration: Date.now() - pollStartTime,
            timeoutMinutes: (maxAttempts * 5) / 60,
          });

          await db.swarm.update({
            where: { id: swarm.id },
            data: {
              agentStatus: 'FAILED',
              agentRequestId: null,
            },
          });

          sendEvent({
            status: "TIMEOUT",
            message: "Agent processing timed out after 10 minutes"
          }, "error");
          controller.close();
        };

        // Start polling in background
        pollAgent().catch((error) => {
          console.error("[agent-stream] Critical polling error", {
            ...logContext,
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
            totalDuration: Date.now() - startTime,
          });
          sendEvent({ error: error.message }, "error");
          controller.close();
        });

      } catch (error) {
        console.error("[agent-stream] SSE setup error", {
          ...logContext,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          totalDuration: Date.now() - startTime,
        });
        sendEvent({ error: error instanceof Error ? error.message : "Unknown error" }, "error");
        controller.close();
      }
    },

    cancel() {
      console.log("[agent-stream] SSE connection cancelled", {
        ...logContext,
        totalDuration: Date.now() - startTime,
      });
    }
  });

  console.log("[agent-stream] SSE stream created successfully", {
    ...logContext,
    setupDuration: Date.now() - startTime,
  });

  return new Response(stream, { headers });
}
