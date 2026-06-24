import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  pusherServer,
  getFeatureChannelName,
  getTaskChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";
import { logger } from "@/lib/logger";

export const fetchCache = "force-no-store";

/**
 * POST /api/webhook/agent-trace
 *
 * Callback from Stakwork after agent trace visualization is complete.
 * Updates the AgentLog record and broadcasts a Pusher event so the
 * AgentLogsTable can flip the row from "pending" to "ready" / "error"
 * without a page refresh.
 *
 * Auth: x-api-token header checked against API_TOKEN
 *
 * Body (JSON):
 *   agentLogId:      string — the AgentLog id
 *   traceId:         string — Arize Phoenix trace ID
 *   phoenixTraceUrl: string — full URL to the trace in Phoenix
 *   status:          "ready" | "error"
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check — same pattern as webhook/agent-logs
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken || apiToken !== process.env.API_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { agentLogId, traceId, phoenixTraceUrl, status } = body;

    // Validate required fields
    if (!agentLogId || !traceId || !phoenixTraceUrl || !status) {
      return NextResponse.json(
        { error: "Missing required fields: agentLogId, traceId, phoenixTraceUrl, status" },
        { status: 400 }
      );
    }

    // Update AgentLog and retrieve channel IDs
    const updated = await db.agentLog.update({
      where: { id: agentLogId },
      data: { traceId, phoenixTraceUrl, traceStatus: status },
      select: { featureId: true, taskId: true },
    });

    const pusherPayload = { agentLogId, traceStatus: status, phoenixTraceUrl };

    // Broadcast on feature channel
    if (updated.featureId) {
      try {
        await pusherServer.trigger(
          getFeatureChannelName(updated.featureId),
          PUSHER_EVENTS.AGENT_TRACE_READY,
          pusherPayload
        );
      } catch (err) {
        logger.error("[agent-trace webhook] Pusher trigger on feature channel failed", undefined, err);
      }
    }

    // Broadcast on task channel
    if (updated.taskId) {
      try {
        await pusherServer.trigger(
          getTaskChannelName(updated.taskId),
          PUSHER_EVENTS.AGENT_TRACE_READY,
          pusherPayload
        );
      } catch (err) {
        logger.error("[agent-trace webhook] Pusher trigger on task channel failed", undefined, err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("[agent-trace webhook] Unexpected error", undefined, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
