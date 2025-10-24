import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { parseEnv } from "@/lib/env-parser";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { pollAgentProgress } from "@/services/swarm/stakgraph-services";
import { devcontainerJsonContent, parsePM2Content } from "@/utils/devContainerUtils";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { getServerSession } from "next-auth/next";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get("request_id");
  const swarmId = searchParams.get("swarm_id");

  if (!requestId || !swarmId) {
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
        const swarm = await db.swarm.findFirst({
          where: { id: swarmId },
          include: { workspace: { select: { slug: true } } }
        });

        if (!swarm) {
          sendEvent({ error: "Swarm not found" }, "error");
          controller.close();
          return;
        }

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

          while (attempts < maxAttempts) {
            try {
              sendEvent({
                status: "POLLING",
                message: `Checking agent progress... (${attempts + 1}/${maxAttempts})`,
                attempt: attempts + 1,
                maxAttempts
              });

              const agentResult = await pollAgentProgress(swarmUrl, requestId, decryptedApiKey);

              if (agentResult.ok) {
                // Agent completed successfully
                sendEvent({ status: "PROCESSING", message: "Agent completed, processing results..." });

                // Process the results
                const agentFiles = agentResult.data as Record<string, string>;
                const primaryRepo = await getPrimaryRepository(swarm.workspaceId);
                const repo_url = primaryRepo?.repositoryUrl;

                if (!repo_url) {
                  sendEvent({ error: "No repository URL found" }, "error");
                  controller.close();
                  return;
                }

                // Parse results
                const pm2Content = agentFiles["pm2.config.js"];
                const services = parsePM2Content(pm2Content);

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
                  } catch (e) {
                    console.error("Failed to parse .env file from agent:", e);
                  }
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
              console.error("Error polling agent:", error);
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
          console.error("Polling error:", error);
          sendEvent({ error: error.message }, "error");
          controller.close();
        });

      } catch (error) {
        console.error("SSE error:", error);
        sendEvent({ error: error instanceof Error ? error.message : "Unknown error" }, "error");
        controller.close();
      }
    },

    cancel() {
      console.log("SSE connection cancelled");
    }
  });

  return new Response(stream, { headers });
}