import crypto from "crypto";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { fetchEndpointNodes, formatEndpointLabel } from "@/lib/format-endpoint";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { matchPathToEndpoint, type EndpointNode } from "@/lib/vercel/path-matcher";
import type { VercelLogEntry } from "@/types/vercel";
import { NextRequest, NextResponse } from "next/server";

/**
 * Compute HMAC-SHA1 signature for Vercel webhook verification
 */
function computeSignature(body: string, secret: string): string {
  return crypto.createHmac("sha1", secret).update(Buffer.from(body, "utf-8")).digest("hex");
}

export const fetchCache = "force-no-store";

const encryptionService = EncryptionService.getInstance();

/**
 * Vercel Log Drain Webhook Handler
 *
 * Receives NDJSON log payloads from Vercel, matches request paths to endpoint nodes,
 * and broadcasts highlights to the workspace via Pusher for real-time graph visualization.
 *
 * Endpoint: POST /api/vercel/log-drain?workspace=<workspace-slug>
 *
 * Authentication: Per-workspace webhook secret via x-vercel-signature header
 * Verification: Returns workspace-specific x-vercel-verify header for webhook setup
 */
export async function POST(request: NextRequest) {
  try {
    // Get workspace slug from query params
    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");

    if (!workspaceSlug) {
      console.error("[Vercel Logs] Missing workspace query parameter");
      return NextResponse.json({ error: "workspace query parameter required" }, { status: 400 });
    }

    // Find workspace by slug
    const workspace = await db.workspace.findFirst({
      where: {
        slug: workspaceSlug,
        deleted: false,
      },
      include: {
        swarm: true,
      },
    });

    if (!workspace) {
      console.error(`[Vercel Logs] No workspace found for slug: ${workspaceSlug}`);
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Handle verification requests (no body)
    const contentLength = request.headers.get("content-length");
    if (!contentLength || contentLength === "0") {
      // Verification request - return workspace-specific secret in header
      if (!workspace.vercelWebhookSecret) {
        console.error(`[Vercel Logs] No webhook secret configured for workspace ${workspace.slug}`);
        return NextResponse.json({ error: "Webhook secret not configured for this workspace" }, { status: 500 });
      }

      // Decrypt the webhook secret
      const decryptedSecret = encryptionService.decryptField("vercelWebhookSecret", workspace.vercelWebhookSecret);

      return new NextResponse(null, {
        status: 200,
        headers: {
          "x-vercel-verify": decryptedSecret,
        },
      });
    }

    // Verify webhook signature
    if (!workspace.vercelWebhookSecret) {
      console.error(`[Vercel Logs] No webhook secret configured for workspace ${workspace.slug}`);
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 401 });
    }

    // Parse NDJSON payload (newline-delimited JSON)
    const body = await request.text();

    // Verify the x-vercel-signature header
    const signature = request.headers.get("x-vercel-signature");
    if (!signature) {
      console.error("[Vercel Logs] Missing x-vercel-signature header");
      return NextResponse.json({ code: "invalid_signature", error: "Missing signature" }, { status: 403 });
    }

    const decryptedSecret = encryptionService.decryptField("vercelWebhookSecret", workspace.vercelWebhookSecret);
    const expectedSignature = computeSignature(body, decryptedSecret);

    if (signature !== expectedSignature) {
      console.error("[Vercel Logs] Signature mismatch");
      return NextResponse.json({ code: "invalid_signature", error: "Signature didn't match" }, { status: 403 });
    }

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
      return NextResponse.json({ error: "No valid log entries found" }, { status: 400 });
    }

    // Fetch endpoint nodes once for all log entries
    if (!workspace.swarm) {
      console.warn(`[Vercel Logs] No swarm found for workspace ${workspace.slug}`);
      return NextResponse.json({ success: true, processed: logEntries.length, matched: 0, highlighted: 0 });
    }

    const endpointNodes = await fetchEndpointNodes(workspace.swarm);
    if (endpointNodes.length === 0) {
      return NextResponse.json({ success: true, processed: logEntries.length, matched: 0, highlighted: 0 });
    }

    console.log("logEntries:", JSON.stringify(logEntries, null, 2));
    // Process all log entries with the pre-fetched endpoint nodes
    const results = await Promise.all(logEntries.map((entry) => processLogEntry(entry, workspace.slug, endpointNodes)));

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
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }
}

/**
 * Process a single log entry: match path to endpoint and broadcast highlight
 */
async function processLogEntry(
  entry: VercelLogEntry,
  workspaceSlug: string,
  endpointNodes: EndpointNode[],
): Promise<{ success: boolean; highlighted: boolean }> {
  try {
    // Extract path from log entry
    const path = entry.path || entry.proxy?.path;
    if (!path) {
      // No path to match (e.g., build logs)
      return { success: true, highlighted: false };
    }

    // Match path to endpoint
    const matchedNode = matchPathToEndpoint(path, endpointNodes);
    if (!matchedNode) {
      return { success: true, highlighted: false };
    }

    console.log(`[Vercel Logs] Matched ${path} -> ${matchedNode.ref_id}`);

    // Broadcast highlight event via Pusher
    await broadcastHighlight(workspaceSlug, matchedNode.ref_id, path);

    return { success: true, highlighted: true };
  } catch (error) {
    console.error("[Vercel Logs] Error processing log entry:", error);
    return { success: false, highlighted: false };
  }
}

/**
 * Broadcast highlight event to workspace via Pusher
 */
async function broadcastHighlight(workspaceSlug: string, nodeRefId: string, endpoint: string): Promise<void> {
  try {
    const channelName = getWorkspaceChannelName(workspaceSlug);
    const eventPayload = {
      nodeIds: [nodeRefId],
      workspaceId: workspaceSlug,
      depth: 1,
      title: formatEndpointLabel(endpoint),
      timestamp: Date.now(),
      sourceNodeRefId: nodeRefId,
      expiresIn: 10, // seconds
    };

    await pusherServer.trigger(channelName, PUSHER_EVENTS.HIGHLIGHT_NODES, eventPayload);
  } catch (error) {
    console.error("[Vercel Logs] Error broadcasting highlight:", error);
    // Don't throw - highlight failures shouldn't fail the webhook
  }
}
