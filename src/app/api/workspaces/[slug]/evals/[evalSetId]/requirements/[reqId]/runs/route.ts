import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { db } from "@/lib/db";

type RouteParams = {
  params: Promise<{ slug: string; evalSetId: string; reqId: string }>;
};

const VALID_TARGET_TYPES = ["TASK", "FEATURE", "AGENT_LOG"] as const;
type TargetType = (typeof VALID_TARGET_TYPES)[number];

interface JarvisNode {
  ref_id?: string;
  node_data?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] || { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, reqId } = await params;

    const body = await request.json();
    const { target_type, task_id, feature_id, agent_log_id } = body ?? {};

    // Input validation
    if (!VALID_TARGET_TYPES.includes(target_type)) {
      return NextResponse.json(
        { error: "target_type must be TASK, FEATURE, or AGENT_LOG" },
        { status: 400 },
      );
    }
    if (target_type === "TASK" && !task_id) {
      return NextResponse.json({ error: "task_id required for TASK target" }, { status: 400 });
    }
    if (target_type === "FEATURE" && !feature_id) {
      return NextResponse.json(
        { error: "feature_id required for FEATURE target" },
        { status: 400 },
      );
    }
    if (target_type === "AGENT_LOG" && !agent_log_id) {
      return NextResponse.json(
        { error: "agent_log_id required for AGENT_LOG target" },
        { status: 400 },
      );
    }

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    const { workspaceId, swarmName, swarmApiKey } = swarmAccessResult.data;

    // IDOR guard — verify target belongs to this workspace before any Jarvis write
    let resolvedTaskId: string | null = null;

    if (target_type === "TASK") {
      const task = await db.task.findFirst({
        where: { id: task_id, workspaceId, deleted: false },
        select: { id: true },
      });
      if (!task) {
        return NextResponse.json({ error: "Task not found or access denied" }, { status: 404 });
      }
      resolvedTaskId = task_id;
    }

    if (target_type === "FEATURE") {
      const feature = await db.feature.findFirst({
        where: { id: feature_id, workspaceId, deleted: false },
        select: { id: true },
      });
      if (!feature) {
        return NextResponse.json({ error: "Feature not found or access denied" }, { status: 404 });
      }
    }

    if (target_type === "AGENT_LOG") {
      const log = await db.agentLog.findFirst({
        where: { id: agent_log_id, workspaceId },
        select: { id: true, taskId: true },
      });
      if (!log) {
        return NextResponse.json(
          { error: "AgentLog not found or access denied" },
          { status: 404 },
        );
      }
      if (log.taskId) resolvedTaskId = log.taskId;
    }

    const jarvisUrl = getJarvisUrl(swarmName);
    const config = { jarvisUrl, apiKey: swarmApiKey };

    // Resolve latest AgentSession from Jarvis (best-effort, never fatal)
    let resolvedSessionId: string | null = null;
    try {
      const sessionsResp = await fetch(`${jarvisUrl}/v2/nodes?type=AgentSession&limit=200`, {
        headers: { "x-api-token": swarmApiKey },
      });
      if (sessionsResp.ok) {
        const sessionsData = await sessionsResp.json();
        const allSessions: JarvisNode[] = sessionsData?.nodes ?? [];
        const matched = allSessions
          .filter((n) => {
            const nd = (n.node_data ?? n.properties ?? {}) as Record<string, unknown>;
            if (resolvedTaskId) return nd.task_id === resolvedTaskId;
            if (feature_id) return nd.feature_id === feature_id;
            return false;
          })
          .sort((a, b) => {
            const ta = String(
              ((a.node_data ?? a.properties ?? {}) as Record<string, unknown>).created_at ?? "",
            );
            const tb = String(
              ((b.node_data ?? b.properties ?? {}) as Record<string, unknown>).created_at ?? "",
            );
            return tb.localeCompare(ta);
          });
        resolvedSessionId = matched[0]?.ref_id ?? null;
      }
    } catch {
      // best-effort — continue without session
    }

    // Create EvalRun node
    const evalRunResult = await addNode(config, {
      node_type: "EvalRun",
      node_data: {
        target_type: target_type as TargetType,
        task_id: resolvedTaskId ?? task_id ?? null,
        feature_id: feature_id ?? null,
        agent_log_id: agent_log_id ?? null,
        session_id: resolvedSessionId,
        created_at: new Date().toISOString(),
      },
    });

    if (!evalRunResult.success || !evalRunResult.ref_id) {
      return NextResponse.json({ error: "Failed to create EvalRun node" }, { status: 502 });
    }

    const evalRunRefId = evalRunResult.ref_id;

    // HAS_RUN edge: requirement → evalRun
    await addEdge(config, {
      edge: { edge_type: "HAS_RUN" },
      source: { ref_id: reqId },
      target: { ref_id: evalRunRefId },
    });

    // EVALUATED edge: evalRun → agentSession (only if resolved)
    if (resolvedSessionId) {
      await addEdge(config, {
        edge: { edge_type: "EVALUATED" },
        source: { ref_id: evalRunRefId },
        target: { ref_id: resolvedSessionId },
      });
    }

    return NextResponse.json({ success: true, ref_id: evalRunRefId, linked: 1 });
  } catch (error) {
    console.error("[Evals/Runs] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
