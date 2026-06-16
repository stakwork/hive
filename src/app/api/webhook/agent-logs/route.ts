import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { pusherServer, getFeatureChannelName, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { extractAgentRoleName } from "@/lib/utils/agent-role";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";

export const fetchCache = "force-no-store";

/**
 * POST /api/webhook/agent-logs
 *
 * Receives agent log traces from Stakwork workflows, uploads them to
 * Vercel Blob storage, and creates an AgentLog record linked to the
 * relevant StakworkRun and/or Task and/or Feature.
 *
 * Auth: x-api-token header checked against API_TOKEN (same as /api/chat/response)
 *
 * Body (JSON):
 *   agent:          string   — agent name/identifier (e.g. "researcher", "architect")
 *   workspace_id:   string   — workspace this log belongs to
 *   stakwork_run_id?: string — optional StakworkRun to associate with
 *   task_id?:       string   — optional Task to associate with
 *   feature_id?:    string   — optional Feature to associate with
 *   logs:           unknown  — the actual log data (JSON array, JSONL string, etc.)
 *
 * At least one of 'stakwork_run_id', 'task_id', or 'feature_id' is required.
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check — same pattern as /api/chat/response
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken || apiToken !== process.env.API_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { agent, workspace_id } = body;
    // Support both new shape (messages) and legacy shape (logs)
    const messages: unknown = body.messages ?? body.logs;
    const sessionId: string | undefined = body.sessionId ? String(body.sessionId) : undefined;
    const config: Record<string, unknown> | undefined =
      body.config && typeof body.config === "object" && !Array.isArray(body.config)
        ? (body.config as Record<string, unknown>)
        : undefined;
    // Model: prefer config.model, fall back to legacy body.model
    const model: string | undefined = config?.model
      ? String(config.model)
      : body.model
        ? String(body.model)
        : undefined;
    // Stakwork sends project IDs as integers
    const stakwork_run_id = body.stakwork_run_id
      ? Number(body.stakwork_run_id)
      : undefined;
    const task_id = body.task_id ? String(body.task_id) : undefined;
    const feature_id = body.feature_id ? String(body.feature_id) : undefined;

    console.info("[agent-logs] payload shape", {
      isLegacy: !body.messages,
      hasConfig: !!body.config,
    });

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

    if (!messages) {
      return NextResponse.json(
        { error: "Missing 'messages' (or legacy 'logs') field" },
        { status: 400 }
      );
    }

    // At least one association must be provided
    if (!stakwork_run_id && !task_id && !feature_id) {
      return NextResponse.json(
        { error: "At least one of 'stakwork_run_id', 'task_id', or 'feature_id' is required" },
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

    // If stakwork_run_id provided, resolve it to our internal cuid
    let resolvedStakworkRunId: string | null = null;
    if (stakwork_run_id) {
      const run = await db.stakworkRun.findFirst({
        where: { projectId: stakwork_run_id, workspaceId: workspace_id },
        select: { id: true },
      });
      if (!run) {
        return NextResponse.json(
          { error: "StakworkRun not found or does not belong to workspace" },
          { status: 404 }
        );
      }
      resolvedStakworkRunId = run.id;
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

    // If feature_id provided, verify it exists and belongs to this workspace
    if (feature_id) {
      const feature = await db.feature.findFirst({
        where: { id: feature_id, workspaceId: workspace_id, deleted: false },
        select: { id: true },
      });
      if (!feature) {
        return NextResponse.json(
          { error: "Feature not found or does not belong to workspace" },
          { status: 404 }
        );
      }
    }

    // Store full payload as blob: new shape { sessionId, messages, config } or legacy { messages }
    const blobPayload = {
      ...(sessionId ? { sessionId } : {}),
      messages,
      ...(config ? { config } : {}),
    };
    const logContent = JSON.stringify(blobPayload);

    // Upload to Vercel Blob
    const blobPath = `agent-logs/${workspace_id}/${resolvedStakworkRunId || task_id || feature_id}/${agent}.json`;

    const blob = await put(blobPath, logContent, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    // Upsert the AgentLog record (overwrite if same agent + run/task/feature)
    const existing = await db.agentLog.findFirst({
      where: {
        agent,
        workspaceId: workspace_id,
        stakworkRunId: resolvedStakworkRunId,
        taskId: task_id || null,
        featureId: feature_id || null,
      },
      select: { id: true },
    });

    const agentLog = existing
      ? await db.agentLog.update({
          where: { id: existing.id },
          data: {
            blobUrl: blob.url,
            sessionId: sessionId ?? null,
            config: config as Prisma.InputJsonValue | undefined,
          },
        })
      : await db.agentLog.create({
          data: {
            blobUrl: blob.url,
            agent,
            stakworkRunId: resolvedStakworkRunId,
            taskId: task_id || null,
            featureId: feature_id || null,
            workspaceId: workspace_id,
            sessionId: sessionId ?? null,
            config: config as Prisma.InputJsonValue | undefined,
          },
        });

    // Broadcast real-time update to feature plan viewers
    if (feature_id) {
      try {
        await pusherServer.trigger(
          getFeatureChannelName(feature_id),
          PUSHER_EVENTS.AGENT_LOG_UPDATED,
          { id: agentLog.id, agent: agentLog.agent, createdAt: agentLog.createdAt, isNew: !existing }
        );
        console.info("[agent-logs] pusher broadcast", { agent: agentLog.agent, featureId: feature_id, isNew: !existing });
      } catch (err) {
        console.error("[agent-logs] pusher broadcast failed", err);
      }
    }

    // Broadcast real-time update to task viewers
    if (task_id) {
      try {
        await pusherServer.trigger(
          getTaskChannelName(task_id),
          PUSHER_EVENTS.AGENT_LOG_UPDATED,
          { id: agentLog.id, agent: agentLog.agent, createdAt: agentLog.createdAt, isNew: !existing }
        );
        console.info("[agent-logs] pusher broadcast", { agent: agentLog.agent, taskId: task_id, isNew: !existing });
      } catch (err) {
        console.error("[agent-logs] pusher task broadcast failed", err);
      }
    }

    // ── Best-effort Jarvis graph write ─────────────────────────────────────────
    try {
      const jarvisConfig = await getJarvisConfigForWorkspace(workspace_id);
      if (!jarvisConfig) {
        console.info("[agent-logs] Jarvis write skipped: no swarm config", { workspace_id });
      } else {
        const roleName = extractAgentRoleName(agent);

        // (1) Upsert AgentRole — Warning+data.ref_id shape handled by the addNode fix
        const roleResult = await addNode(jarvisConfig, {
          node_type: "AgentRole",
          node_data: { name: roleName },
        });
        console.info("[agent-logs] AgentRole upsert", {
          roleName,
          success: roleResult.success,
          ref_id: roleResult.ref_id,
        });

        // (2) Create AgentSession
        const sessionResult = await addNode(jarvisConfig, {
          node_type: "AgentSession",
          node_data: {
            agent_name: agent,
            feature_id: feature_id ?? null,
            task_id: task_id ?? null,
            log_url: blob.url,
            ...(model ? { model } : {}),
            workspace_id,
            created_at: new Date().toISOString(),
          },
        });
        console.info("[agent-logs] AgentSession create", {
          agent,
          success: sessionResult.success,
          ref_id: sessionResult.ref_id,
        });

        // (3) HAS_SESSION edge — only if both ref_ids resolved
        if (roleResult.ref_id && sessionResult.ref_id) {
          const edgeResult = await addEdge(jarvisConfig, {
            edge: { edge_type: "HAS_SESSION" },
            source: { ref_id: roleResult.ref_id },
            target: { ref_id: sessionResult.ref_id },
          });
          console.info("[agent-logs] HAS_SESSION edge", {
            success: edgeResult.success,
            error: edgeResult.error,
          });
        } else {
          console.warn("[agent-logs] HAS_SESSION edge skipped: missing ref_id(s)", {
            roleRefId: roleResult.ref_id,
            sessionRefId: sessionResult.ref_id,
          });
        }
      }
    } catch (err) {
      console.error("[agent-logs] Jarvis write failed (non-fatal)", err);
    }

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
