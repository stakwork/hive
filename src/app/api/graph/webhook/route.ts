import { db } from "@/lib/db";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const fetchCache = "force-no-store";

const GraphWebhookSchema = z.object({
  node_ids: z.array(z.string().uuid()).min(1).max(1000),
  workspace_id: z.string().cuid().optional(),
  depth: z.number().int().min(0).max(10).optional(),
  title: z.string().max(500).optional(),
});

type GraphWebhookPayload = z.infer<typeof GraphWebhookSchema>;

const MAX_CONTENT_LENGTH = 1024 * 1024; // 1 MB

interface GraphWebhookPayloadLegacy {
  node_ids: string[];
  workspace_id?: string;
  depth?: number;
  title?: string;
  source_node_ref_id?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Check Content-Length header before parsing
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: "Request body exceeds 1MB limit" },
        { status: 413 }
      );
    }

    console.log("Graph webhook received");
    // API Key authentication
    const apiKey = request.headers.get('x-api-key');
    console.log("apiKey:", apiKey);
    console.log("process.env.GRAPH_WEBHOOK_API_KEY:", process.env.GRAPH_WEBHOOK_API_KEY);
    if (!apiKey || apiKey !== process.env.GRAPH_WEBHOOK_API_KEY) {
      console.error("Invalid or missing API key for graph webhook");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    // Parse and validate request body
    const bodyParseResult = GraphWebhookSchema.safeParse(
      await request.json()
    );

    if (!bodyParseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid payload",
          details: bodyParseResult.error.format(),
        },
        { status: 400 }
      );
    }

    const body: GraphWebhookPayload = bodyParseResult.data;
    const { node_ids, workspace_id, depth, title } = body;

    console.log(body)

    console.log("node_ids:", node_ids);
    console.log("workspace_id:", workspace_id);

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
          sourceNodeRefId: "",
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
