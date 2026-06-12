import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ slug: string; workflowId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Auth — x-api-token
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken || apiToken !== process.env.API_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug, workflowId } = await params;

    const summaryId = request.nextUrl.searchParams.get("summary_id");
    if (!summaryId) {
      return NextResponse.json({ error: "Missing summary_id" }, { status: 400 });
    }

    let body: { content?: string; status?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { content, status: bodyStatus } = body;

    // Look up the summary and verify it belongs to this workspace (IDOR guard)
    const workspace = await db.workspace.findFirst({
      where: { slug, deleted: false },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const summary = await db.workflowSummary.findUnique({
      where: { id: summaryId },
    });

    if (!summary || summary.workspaceId !== workspace.id) {
      return NextResponse.json({ error: "Summary not found" }, { status: 404 });
    }

    const isFailed = bodyStatus === "failed";
    const newStatus = isFailed ? "FAILED" : "COMPLETE";

    await db.workflowSummary.update({
      where: { id: summaryId },
      data: { status: newStatus, content: content ?? null },
    });

    // Broadcast Pusher event
    await pusherServer.trigger(
      getWorkspaceChannelName(slug),
      PUSHER_EVENTS.WORKFLOW_SUMMARY_READY,
      { summaryId, workflowId: Number(workflowId), content },
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("[Workflow Summarise Callback] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
