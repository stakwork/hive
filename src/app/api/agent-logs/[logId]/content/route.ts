import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { verifySignedUrl } from "@/lib/signed-urls";
import { fetchBlobContent } from "@/lib/utils/blob-fetch";
import { logger } from "@/lib/logger";

export const fetchCache = "force-no-store";

/**
 * GET /api/agent-logs/[logId]/content
 *
 * Serves agent log blob content securely. Supports two auth modes:
 *
 * 1. Session auth — for the browser UI (LogDetailDialog).
 *    Requires a valid user session with workspace membership.
 *
 * 2. Signed URL — for the Logs Agent on the swarm.
 *    Requires valid `expires` and `sig` query params.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ logId: string }> }
) {
  try {
    const { logId } = await params;

    if (!logId) {
      return NextResponse.json(
        { error: "Log ID is required" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const expires = searchParams.get("expires");
    const sig = searchParams.get("sig");
    const isSignedRequest = expires && sig;

    if (isSignedRequest) {
      // Signed URL auth — verify signature and expiration
      const path = `/api/agent-logs/${logId}/content`;
      const result = verifySignedUrl(path, expires, sig);
      if (!result.valid) {
        logger.error("[AgentLogContent] Signed URL verification failed", result.error);
        return NextResponse.json(
          { error: result.error || "Invalid signed URL" },
          { status: 403 }
        );
      }
    } else {
      // Session auth — require logged-in user
      const context = getMiddlewareContext(request);
      const userOrResponse = requireAuth(context);
      if (userOrResponse instanceof NextResponse) return userOrResponse;

      // Look up the log to verify workspace membership
      const log = await db.agentLog.findUnique({
        where: { id: logId },
        select: {
          workspaceId: true,
          workspace: {
            select: {
              members: {
                where: { userId: userOrResponse.id },
                select: { id: true },
              },
            },
          },
        },
      });

      if (!log) {
        return NextResponse.json(
          { error: "Agent log not found" },
          { status: 404 }
        );
      }

      if (!log.workspace.members.length) {
        return NextResponse.json(
          { error: "Access denied" },
          { status: 403 }
        );
      }
    }

    // Fetch the blob content
    const agentLog = await db.agentLog.findUnique({
      where: { id: logId },
      select: { blobUrl: true },
    });

    if (!agentLog) {
      return NextResponse.json(
        { error: "Agent log not found" },
        { status: 404 }
      );
    }

    const content = await fetchBlobContent(agentLog.blobUrl);

    return new NextResponse(content, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    logger.error("[AgentLogContent] Unexpected error", String(error));
    return NextResponse.json(
      { error: "Failed to fetch agent log content" },
      { status: 500 }
    );
  }
}
