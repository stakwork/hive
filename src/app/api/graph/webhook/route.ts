import { db } from "@/lib/db";
import { timingSafeEqual } from "@/lib/encryption";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { NextRequest, NextResponse } from "next/server";

export const fetchCache = "force-no-store";

interface GraphWebhookPayload {
  node_ids: string[];
  workspace_id?: string;
  depth?: number;
  title?: string;
}

export async function POST(request: NextRequest) {
  try {

    console.log("Graph webhook received");
    // API Key authentication
    const apiKey = request.headers.get('x-api-key');
    console.log("apiKey:", apiKey);
    console.log("process.env.GRAPH_WEBHOOK_API_KEY:", process.env.GRAPH_WEBHOOK_API_KEY);
    if (!apiKey || !timingSafeEqual(apiKey, process.env.GRAPH_WEBHOOK_API_KEY || '')) {
      console.error("Invalid or missing API key for graph webhook");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = (await request.json()) as GraphWebhookPayload;
    const { node_ids, workspace_id, depth, title } = body;

    console.log(body)

    console.log("node_ids:", node_ids);
    console.log("workspace_id:", workspace_id);

    if (!node_ids || !Array.isArray(node_ids) || node_ids.length === 0) {
      console.error("No node_ids provided in webhook or invalid format");
      return NextResponse.json(
        { error: "node_ids array is required" },
        { status: 400 },
      );
    }

    const workspace = await db.workspace.findUnique({
      where: {
        id: workspace_id,
      },
    });

    console.log("workspace:", workspace);

    // Broadcast highlight event to workspace if workspace_id is provided
    if (workspace) {
      try {
        const channelName = getWorkspaceChannelName(workspace.slug);
        const eventPayload = {
          nodeIds: node_ids,
          workspaceId: workspace.slug,
          depth: depth || 0,
          title: title || "",
          timestamp: Date.now(),
        };

        await pusherServer.trigger(
          channelName,
          PUSHER_EVENTS.HIGHLIGHT_NODES,
          eventPayload,
        );

        console.log(`Broadcasted highlight event to workspace: ${workspace_id}`);
      } catch (error) {
        console.error("Error broadcasting highlight event:", error);
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          received: {
            nodeIds: node_ids,
            workspaceId: workspace_id,
          },
          broadcasted: !!workspace_id,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error processing Graph webhook:", error);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 },
    );
  }
}