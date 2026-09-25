import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { pusherServer, getFeatureChannelName, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { extractAgentRoleName } from "@/lib/utils/agent-role";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { parseAgentLogStats } from "@/lib/utils/agent-log-stats";
import {
  authenticateCallbackRequest,
  authorizeCallbackTargets,
  parseCallbackIds,
} from "@/lib/auth/callback-access";

export const fetchCache = "force-no-store";

// Org callers only: agent must be a safe path segment — no `/`, no `..` — so
// a caller can't write outside its `agent-logs/<workspace>/<run>/` prefix.
const ORG_AGENT_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

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
 *   reflection?:    object   — optional SessionReflection sidecar from stakgraph
 *                              ({ session_id, updated_at, concepts[], gap?, raw? });
 *                              stored on the AgentLog row (canonical column, like config)
 *   _metadata?:     object   — optional free-form metadata, stored as-is on the AgentLog record
 *
 * At least one of 'stakwork_run_id', 'task_id', or 'feature_id' is required.
 */
export async function POST(request: NextRequest) {
  // Authenticate (and rate-limit org callers) before the body is parsed.
  const caller = await authenticateCallbackRequest(request);
  if (caller instanceof NextResponse) return caller;
  const isOrgCaller = caller.kind === "org";

  try {
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
    const provider: string | undefined = config?.provider ? String(config.provider) : undefined;
    const source: string | undefined = config?.source ? String(config.source) : undefined;
    // Concept reflection sidecar (stakgraph SessionReflection) — stored on the
    // row, not interpreted here
    const reflection: Record<string, unknown> | undefined =
      body.reflection && typeof body.reflection === "object" && !Array.isArray(body.reflection)
        ? (body.reflection as Record<string, unknown>)
        : undefined;
    // Free-form metadata — stored as-is, not interpreted
    const metadata: Record<string, unknown> | undefined =
      body._metadata && typeof body._metadata === "object" && !Array.isArray(body._metadata)
        ? (body._metadata as Record<string, unknown>)
        : undefined;
    const repos: string[] = Array.isArray(config?.repos)
      ? (config.repos as unknown[]).filter((r): r is string => typeof r === "string")
      : [];

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

    // Validate id shapes before any Prisma call — a non-numeric
    // stakwork_run_id now gets a clean 400 instead of a Prisma 500.
    const parsedIds = parseCallbackIds({
      taskId: body.task_id,
      featureId: body.feature_id,
      stakworkRunId: body.stakwork_run_id,
    });
    if (parsedIds instanceof NextResponse) return parsedIds;

    const task_id = parsedIds.taskId;
    const feature_id = parsedIds.featureId;
    const stakwork_run_id = parsedIds.stakworkProjectId;

    // At least one association must be provided
    if (!stakwork_run_id && !task_id && !feature_id) {
      return NextResponse.json(
        { error: "At least one of 'stakwork_run_id', 'task_id', or 'feature_id' is required" },
        { status: 400 }
      );
    }

    // Authorize the target(s) before any workspace lookup or blob put. System
    // callers pass straight through (no DB reads); org callers are scoped to
    // their org's workspace, resolved from the task/feature/run records.
    const authorized = await authorizeCallbackTargets(caller, {
      taskId: task_id,
      featureId: feature_id,
      stakworkProjectId: stakwork_run_id,
    });
    if (authorized instanceof NextResponse) return authorized;

    // Org callers: the body's workspace_id is a consistency check only — it
    // is never used to authorize. A mismatch means the caller's own payload
    // disagrees with the workspace resolved from its ids.
    if (isOrgCaller && authorized.workspaceId && authorized.workspaceId !== workspace_id) {
      console.warn("[agent-logs] rejected", {
        reason: "workspace_id_mismatch",
        orgId: caller.orgId,
        apiKeyId: caller.apiKeyId,
        workspaceId: authorized.workspaceId,
        bodyWorkspaceId: workspace_id,
      });
      return NextResponse.json({ error: "workspace_id does not match resolved workspace" }, { status: 403 });
    }

    // Org callers: agent must be a safe path segment so a caller can't write
    // outside its agent-logs/<workspace>/<run>/ prefix.
    if (isOrgCaller && (!ORG_AGENT_NAME_PATTERN.test(agent) || agent.includes(".."))) {
      console.warn("[agent-logs] rejected", {
        reason: "invalid_agent",
        orgId: caller.orgId,
        apiKeyId: caller.apiKeyId,
        agent,
      });
      return NextResponse.json({ error: "Invalid 'agent' field" }, { status: 400 });
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

    // Find any existing AgentLog for this agent + run/task/feature. Moved
    // before the blob `put` for org callers so a Stakwork-written row can be
    // detected and rejected before anything is overwritten.
    const existing = await db.agentLog.findFirst({
      where: {
        agent,
        workspaceId: workspace_id,
        stakworkRunId: resolvedStakworkRunId,
        taskId: task_id || null,
        featureId: feature_id || null,
      },
      select: { id: true, metadata: true },
    });

    // Org callers may never overwrite a row Stakwork (or a legacy/unmarked
    // row) wrote — only rows previously written by an org caller.
    if (isOrgCaller && existing) {
      const existingMetadata = existing.metadata as { hiveCaller?: { kind?: string } } | null;
      if (existingMetadata?.hiveCaller?.kind !== "org") {
        console.warn("[agent-logs] rejected", {
          reason: "system_log_overwrite",
          orgId: caller.orgId,
          apiKeyId: caller.apiKeyId,
          agentLogId: existing.id,
        });
        return NextResponse.json({ error: "Cannot overwrite this log" }, { status: 403 });
      }
    }

    // Store transcript as blob: { sessionId?, messages } — config and
    // reflection are canonical DB columns
    const blobPayload = {
      ...(sessionId ? { sessionId } : {}),
      messages,
    };
    const logContent = JSON.stringify(blobPayload);

    // Derive lightweight stats from the transcript for the Jarvis graph write
    // below — estimatedTokens is a text-length heuristic, NOT provider-reported
    // usage, so it's kept under its own field name (never total_tokens/cost).
    const { stats: logStats } = parseAgentLogStats(logContent);

    // Upload to Vercel Blob
    const blobPath = `agent-logs/${workspace_id}/${resolvedStakworkRunId || task_id || feature_id}/${agent}.json`;

    const blob = await put(blobPath, logContent, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    // System callers write exactly what they write today: metadata is
    // replaced with `_metadata` (or left alone if missing), never tagged.
    // Org callers always get a `hiveCaller` marker, applied last so it wins
    // over anything the caller sent under that key — this is the caller-kind
    // record for AgentLog rows (chat messages/tasks rely on logging only).
    const metadataToWrite: Prisma.InputJsonValue | undefined = isOrgCaller
      ? ({
          ...(metadata ?? (existing?.metadata as Record<string, unknown> | null) ?? {}),
          hiveCaller: { kind: "org", apiKeyId: caller.apiKeyId },
        } as Prisma.InputJsonValue)
      : (metadata as Prisma.InputJsonValue | undefined);

    const agentLog = existing
      ? await db.agentLog.update({
          where: { id: existing.id },
          data: {
            blobUrl: blob.url,
            sessionId: sessionId ?? null,
            config: config as Prisma.InputJsonValue | undefined,
            // undefined skips the field on update, so a re-post without a
            // reflection doesn't clobber one stored by an earlier turn
            reflection: reflection as Prisma.InputJsonValue | undefined,
            provider: provider ?? null,
            source: source ?? null,
            repos,
            metadata: metadataToWrite,
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
            reflection: reflection as Prisma.InputJsonValue | undefined,
            provider: provider ?? null,
            source: source ?? null,
            repos,
            metadata: metadataToWrite,
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
            ...(provider ? { provider } : {}),
            source: source ?? roleName,
            workspace_id,
            start_time: Date.now(),
            estimated_tokens: logStats.estimatedTokens,
            tool_call_count: logStats.totalToolCalls,
            message_count: logStats.totalMessages,
            // Marks this as a complete session record for stakgraph's dashboard
            // (mirrors the sentinel its own upsert_agent_session sets on creation).
            file: "session://generated",
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

    console.info("[agent-logs] success", {
      callerKind: caller.kind,
      orgId: isOrgCaller ? caller.orgId : undefined,
      apiKeyId: isOrgCaller ? caller.apiKeyId : undefined,
      workspaceId: workspace_id,
      taskId: task_id,
      featureId: feature_id,
      stakworkProjectId: stakwork_run_id,
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
