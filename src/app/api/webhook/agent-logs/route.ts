import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";

export const fetchCache = "force-no-store";

/**
 * POST /api/webhook/agent-logs
 *
 * Receives agent log traces from Stakwork workflows, uploads them to
 * Vercel Blob storage, and creates an AgentLog record linked to the
 * relevant StakworkRun and/or Task.
 *
 * Auth: x-api-token header checked against API_TOKEN (same as /api/chat/response)
 *
 * Body (JSON):
 *   agent:          string   — agent name/identifier (e.g. "researcher", "architect")
 *   workspace_id:   string   — workspace this log belongs to
 *   stakwork_run_id?: string — optional StakworkRun to associate with
 *   task_id?:       string   — optional Task to associate with
 *   logs:           unknown  — the actual log data (JSON array, JSONL string, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check — same pattern as /api/chat/response
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken || apiToken !== process.env.API_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      agent,
      workspace_id,
      stakwork_run_id,
      task_id,
      logs,
    } = body;

    // Validate required fields
    if (!agent || typeof agent !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'agent' field" },
        { status: 400 }
      );
    }

    if (!workspace_id || typeof workspace_id !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'workspace_id' field" },
        { status: 400 }
      );
    }

    if (!logs) {
      return NextResponse.json(
        { error: "Missing 'logs' field" },
        { status: 400 }
      );
    }

    // At least one association must be provided
    if (!stakwork_run_id && !task_id) {
      return NextResponse.json(
        { error: "At least one of 'stakwork_run_id' or 'task_id' is required" },
        { status: 400 }
      );
    }

    // Verify the workspace exists
    const workspace = await db.workspace.findFirst({
      where: { id: workspace_id, deleted: false },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // If stakwork_run_id provided, verify it exists and belongs to this workspace
    if (stakwork_run_id) {
      const run = await db.stakworkRun.findFirst({
        where: { id: stakwork_run_id, workspaceId: workspace_id },
        select: { id: true },
      });
      if (!run) {
        return NextResponse.json(
          { error: "StakworkRun not found or does not belong to workspace" },
          { status: 404 }
        );
      }
    }

    // If task_id provided, verify it exists and belongs to this workspace
    if (task_id) {
      const task = await db.task.findFirst({
        where: { id: task_id, workspaceId: workspace_id, deleted: false },
        select: { id: true },
      });
      if (!task) {
        return NextResponse.json(
          { error: "Task not found or does not belong to workspace" },
          { status: 404 }
        );
      }
    }

    // Serialize logs to JSONL if array, otherwise store as-is
    let logContent: string;
    if (Array.isArray(logs)) {
      logContent = logs.map((entry) => JSON.stringify(entry)).join("\n");
    } else if (typeof logs === "string") {
      logContent = logs;
    } else {
      logContent = JSON.stringify(logs);
    }

    // Upload to Vercel Blob
    const timestamp = Date.now();
    const blobPath = `agent-logs/${workspace_id}/${stakwork_run_id || task_id}/${agent}_${timestamp}.jsonl`;

    const blob = await put(blobPath, logContent, {
      access: "public",
      contentType: "application/x-ndjson",
    });

    // Create the AgentLog record
    const agentLog = await db.agentLog.create({
      data: {
        blobUrl: blob.url,
        agent,
        stakworkRunId: stakwork_run_id || null,
        taskId: task_id || null,
        workspaceId: workspace_id,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: agentLog.id,
          blobUrl: agentLog.blobUrl,
          agent: agentLog.agent,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error processing agent-logs webhook:", error);
    return NextResponse.json(
      { error: "Failed to process agent log" },
      { status: 500 }
    );
  }
}
