import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { verifySignedUrl } from "@/lib/signed-urls";
import { logger } from "@/lib/logger";

export const fetchCache = "force-no-store";

/**
 * GET /api/agent-logs/[logId]
 *
 * Returns log metadata for a given agent log ID.
 * Supports two auth modes (identical to /stats and /content routes):
 *
 * 1. Session auth — for the browser UI.
 *    Requires a valid user session with workspace membership.
 *
 * 2. Signed URL — for external agents/swarms.
 *    Requires valid `expires` and `sig` query params.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ logId: string }> },
) {
  try {
    const { logId } = await params;

    if (!logId) {
      return NextResponse.json({ error: "Log ID is required" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const expires = searchParams.get("expires");
    const sig = searchParams.get("sig");
    const isSignedRequest = expires && sig;

    if (isSignedRequest) {
      const path = `/api/agent-logs/${logId}`;
      const result = verifySignedUrl(path, expires, sig);
      if (!result.valid) {
        logger.error("[AgentLogDetail] Signed URL verification failed", result.error);
        return NextResponse.json(
          { error: result.error || "Invalid signed URL" },
          { status: 403 },
        );
      }
    } else {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const log = await db.agentLog.findUnique({
        where: { id: logId },
        select: {
          workspaceId: true,
          workspace: {
            select: {
              members: {
                where: { userId: session.user.id },
                select: { id: true },
              },
            },
          },
        },
      });

      if (!log) {
        return NextResponse.json({ error: "Agent log not found" }, { status: 404 });
      }

      if (!log.workspace.members.length) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const agentLog = await db.agentLog.findUnique({
      where: { id: logId },
      select: {
        id: true,
        agent: true,
        blobUrl: true,
        stakworkRunId: true,
        featureId: true,
        createdAt: true,
        stakworkRun: { select: { projectId: true } },
      },
    });

    if (!agentLog) {
      return NextResponse.json({ error: "Agent log not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        id: agentLog.id,
        agent: agentLog.agent,
        blobUrl: agentLog.blobUrl,
        stakworkRunId: agentLog.stakworkRunId,
        featureId: agentLog.featureId,
        workflow_id: agentLog.stakworkRun?.projectId ?? null,
        createdAt: agentLog.createdAt,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    logger.error("[AgentLogDetail] Unexpected error", String(error));
    return NextResponse.json({ error: "Failed to fetch agent log" }, { status: 500 });
  }
}
