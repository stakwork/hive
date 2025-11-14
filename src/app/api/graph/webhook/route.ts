import { NextRequest, NextResponse } from "next/server";

export const fetchCache = "force-no-store";

interface GraphWebhookPayload {
  node_ids: string[];
  workspace_id?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GraphWebhookPayload;
    const { node_ids, workspace_id } = body;

    console.log("node_ids:", node_ids);
    console.log("workspace_id:", workspace_id);

    if (!node_ids || !Array.isArray(node_ids) || node_ids.length === 0) {
      console.error("No node_ids provided in webhook or invalid format");
      return NextResponse.json(
        { error: "node_ids array is required" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          received: {
            nodeIds: node_ids,
            workspaceId: workspace_id,
          },
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