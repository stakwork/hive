import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { matchPathToEndpoint } from "@/lib/vercel/path-matcher";
import type { VercelLogEntry } from "@/types/vercel";
import type { NodeFull } from "@/types/stakgraph";
import { NextRequest, NextResponse } from "next/server";

export const fetchCache = "force-no-store";

const encryptionService = EncryptionService.getInstance();

/**
 * Vercel Log Drain Webhook Handler
 * 
 * Receives NDJSON log payloads from Vercel, matches request paths to endpoint nodes,
 * and broadcasts highlights to the workspace via Pusher for real-time graph visualization.
 * 
 * Endpoint: POST /api/vercel/log-drain?projectId=<vercel-project-id>
 * 
 * Authentication: Per-workspace webhook secret via x-vercel-signature header
 * Verification: Returns workspace-specific x-vercel-verify header for webhook setup
 */
export async function POST(request: NextRequest) {
  try {
    // Get project ID from query params to identify workspace
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      console.error("[Vercel Logs] Missing projectId query parameter");
      return NextResponse.json(
        { error: "projectId query parameter required" },
        { status: 400 }
      );
    }

    // Find workspace by Vercel project ID
    const workspace = await db.workspace.findFirst({
      where: {
        vercelProjectId: projectId,
        deleted: false,
      },
      include: {
        swarm: true,
      },
    });

    if (!workspace) {
      console.error(`[Vercel Logs] No workspace found for projectId: ${projectId}`);
      return NextResponse.json(
        { error: "Workspace not found for this project" },
        { status: 404 }
      );
    }

    // Handle verification requests (no body)
    const contentLength = request.headers.get("content-length");
    if (!contentLength || contentLength === "0") {
      // Verification request - return workspace-specific secret in header
      if (!workspace.vercelWebhookSecret) {
        console.error(
          `[Vercel Logs] No webhook secret configured for workspace ${workspace.slug}`
        );
        return NextResponse.json(
          { error: "Webhook secret not configured for this workspace" },
          { status: 500 }
        );
      }

      // Decrypt the webhook secret
      const decryptedSecret = encryptionService.decryptField(
        "vercelWebhookSecret",
        workspace.vercelWebhookSecret
      );

      return new NextResponse(null, {
        status: 200,
        headers: {
          "x-vercel-verify": decryptedSecret,
        },
      });
    }

    // Verify webhook signature (optional but recommended)
    // For now, we just check that the workspace has a webhook secret configured
    // In production, you should verify the x-vercel-signature header
    if (!workspace.vercelWebhookSecret) {
      console.error(
        `[Vercel Logs] No webhook secret configured for workspace ${workspace.slug}`
      );
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 401 }
      );
    }

    // Parse NDJSON payload (newline-delimited JSON)
    const body = await request.text();
    const logEntries: VercelLogEntry[] = [];

    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as VercelLogEntry;
        logEntries.push(entry);
      } catch (err) {
        console.error("[Vercel Logs] Failed to parse log entry:", err);
        // Continue processing other entries
      }
    }

    if (logEntries.length === 0) {
      return NextResponse.json(
        { error: "No valid log entries found" },
        { status: 400 }
      );
    }

    // Process each log entry
    const results = await Promise.all(
      logEntries.map((entry) => processLogEntry(entry))
    );

    const successCount = results.filter((r) => r.success).length;
    const highlightedCount = results.filter((r) => r.highlighted).length;

    return NextResponse.json({
      success: true,
      processed: logEntries.length,
      matched: successCount,
      highlighted: highlightedCount,
    });
  } catch (error) {
    console.error("[Vercel Logs] Error processing webhook:", error);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}

/**
 * Process a single log entry: match path to endpoint and broadcast highlight
 */
async function processLogEntry(
  entry: VercelLogEntry
): Promise<{ success: boolean; highlighted: boolean }> {
  try {
    // Extract path from log entry
    const path = entry.path || entry.proxy?.path;
    if (!path) {
      // No path to match (e.g., build logs)
      return { success: true, highlighted: false };
    }

    // Find workspace by Vercel project ID
    const projectId = entry.projectId;
    if (!projectId) {
      console.warn("[Vercel Logs] No projectId in log entry");
      return { success: true, highlighted: false };
    }

    const workspace = await db.workspace.findFirst({
      where: {
        vercelProjectId: projectId,
        deleted: false,
      },
      include: {
        swarm: true,
      },
    });

    if (!workspace) {
      // No workspace mapped to this Vercel project
      return { success: true, highlighted: false };
    }

    if (!workspace.swarm) {
      console.warn(
        `[Vercel Logs] No swarm found for workspace ${workspace.slug}`
      );
      return { success: true, highlighted: false };
    }

    // Fetch endpoint nodes from swarm
    const endpointNodes = await fetchEndpointNodes(workspace.swarm);
    if (endpointNodes.length === 0) {
      console.warn(
        `[Vercel Logs] No endpoint nodes found for workspace ${workspace.slug}`
      );
      return { success: true, highlighted: false };
    }

    // Match path to endpoint
    const matchedNode = matchPathToEndpoint(path, endpointNodes);
    if (!matchedNode) {
      // No matching endpoint found
      return { success: true, highlighted: false };
    }

    // Broadcast highlight event via Pusher
    await broadcastHighlight(workspace.slug, matchedNode.ref_id);

    return { success: true, highlighted: true };
  } catch (error) {
    console.error("[Vercel Logs] Error processing log entry:", error);
    return { success: false, highlighted: false };
  }
}

/**
 * Fetch endpoint nodes from workspace swarm
 */
async function fetchEndpointNodes(swarm: {
  swarmUrl: string | null;
  swarmApiKey: string | null;
}): Promise<NodeFull[]> {
  if (!swarm.swarmUrl || !swarm.swarmApiKey) {
    return [];
  }

  try {
    // Extract hostname from swarm URL and construct gitree endpoint
    const swarmUrlObj = new URL(swarm.swarmUrl);
    const protocol = swarmUrlObj.hostname.includes("localhost") ? "http" : "https";

    // Allow environment overrides for development/testing
    let graphUrl = `${protocol}://${swarmUrlObj.hostname}:3355`;
    let apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

    if (process.env.CUSTOM_SWARM_URL) {
      graphUrl = `${process.env.CUSTOM_SWARM_URL}:3355`;
    }
    if (process.env.CUSTOM_SWARM_API_KEY) {
      apiKey = process.env.CUSTOM_SWARM_API_KEY;
    }

    // Fetch endpoint nodes from gitree
    const url = new URL(`${graphUrl}/gitree`);
    url.searchParams.set("node_type", "endpoint");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("output", "json");

    const response = await fetch(url.toString(), {
      headers: {
        "x-api-token": apiKey,
      },
    });

    if (!response.ok) {
      console.error(
        `[Vercel Logs] Failed to fetch endpoint nodes: ${response.status}`
      );
      return [];
    }

    const data = await response.json();

    // Parse response format from gitree endpoint
    // Response can be { endpoints: NodeFull[] } or { nodes: NodeFull[] }
    const nodes: NodeFull[] = data.endpoints || data.nodes || [];

    return nodes.filter((node) => node.node_type === "Endpoint");
  } catch (error) {
    console.error("[Vercel Logs] Error fetching endpoint nodes:", error);
    return [];
  }
}

/**
 * Broadcast highlight event to workspace via Pusher
 */
async function broadcastHighlight(
  workspaceSlug: string,
  nodeRefId: string
): Promise<void> {
  try {
    const channelName = getWorkspaceChannelName(workspaceSlug);
    const eventPayload = {
      nodeIds: [nodeRefId],
      workspaceId: workspaceSlug,
      depth: 0,
      title: "Vercel Request",
      timestamp: Date.now(),
      sourceNodeRefId: nodeRefId,
    };

    await pusherServer.trigger(
      channelName,
      PUSHER_EVENTS.HIGHLIGHT_NODES,
      eventPayload
    );

    console.log(
      `[Vercel Logs] Broadcasted highlight for node ${nodeRefId} to workspace ${workspaceSlug}`
    );
  } catch (error) {
    console.error("[Vercel Logs] Error broadcasting highlight:", error);
    // Don't throw - highlight failures shouldn't fail the webhook
  }
}
