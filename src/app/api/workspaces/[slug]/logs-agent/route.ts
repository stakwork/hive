import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import {
  getWorkspaceSwarmAccess,
  getSwarmAccessByWorkspaceId,
} from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 120; // 2 minutes max

/**
 * POST /api/workspaces/[slug]/logs-agent
 *
 * Proxies a prompt to the swarm's /logs/agent endpoint, polls for the result,
 * and returns the final answer. Used by the Logs Chat UI.
 *
 * Request body:
 *   - prompt: string (required)
 *   - sessionId: string (optional, for multi-turn)
 *
 * Response:
 *   - { answer: string, sessionId: string } on success
 *   - { error: string } on failure
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { prompt, sessionId } = body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 },
      );
    }

    // Verify workspace access (auth + membership)
    const accessResult = await getWorkspaceSwarmAccess(
      slug,
      userOrResponse.id,
    );

    // If the only issue is a missing API key, fall back to the internal
    // helper which treats the key as optional (needed for local dev).
    let swarmUrl: string;
    let swarmApiKey: string;
    let swarmName: string;

    if (accessResult.success) {
      ({ swarmUrl, swarmApiKey, swarmName } = accessResult.data);
    } else if (accessResult.error.type === "SWARM_API_KEY_MISSING") {
      // Auth passed but no API key — look up workspace ID and use the
      // internal helper that allows an empty key.
      const ws = await db.workspace.findFirst({
        where: { slug, deleted: false },
        select: { id: true },
      });
      if (!ws) {
        return NextResponse.json(
          { error: "Workspace not found" },
          { status: 404 },
        );
      }
      const fallback = await getSwarmAccessByWorkspaceId(ws.id);
      if (!fallback.success) {
        return NextResponse.json(
          { error: "Swarm not configured or not active" },
          { status: 400 },
        );
      }
      ({ swarmUrl, swarmApiKey, swarmName } = fallback.data);
    } else {
      const { error } = accessResult;
      const statusMap: Record<string, { msg: string; status: number }> = {
        WORKSPACE_NOT_FOUND: { msg: "Workspace not found", status: 404 },
        ACCESS_DENIED: { msg: "Access denied", status: 403 },
        SWARM_NOT_ACTIVE: {
          msg: "Swarm not configured or not active",
          status: 400,
        },
        SWARM_NOT_CONFIGURED: {
          msg: "Swarm not configured or not active",
          status: 400,
        },
        SWARM_NAME_MISSING: { msg: "Swarm name not found", status: 400 },
      };
      const mapped = statusMap[error.type] || {
        msg: "Swarm access error",
        status: 500,
      };
      return NextResponse.json(
        { error: mapped.msg },
        { status: mapped.status },
      );
    }

    // getSwarmAccessByWorkspaceId already returns the :3355 URL;
    // getWorkspaceSwarmAccess returns the raw URL, so normalize it.
    const baseUrl = swarmUrl.includes(":3355")
      ? swarmUrl
      : (() => {
          const urlObj = new URL(swarmUrl);
          return swarmUrl.includes("localhost")
            ? `http://localhost:3355`
            : `https://${urlObj.hostname}:3355`;
        })();

    // Send prompt to logs agent
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (swarmApiKey) {
      headers["x-api-token"] = swarmApiKey;
    }

    const agentResponse = await fetch(`${baseUrl}/logs/agent`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: prompt.trim(),
        swarmName,
        sessionId: sessionId || undefined,
        model: "haiku",
        sessionConfig: {
          truncateToolResults: false,
          maxToolResultLines: 200,
          maxToolResultChars: 2000,
        },
      }),
    });

    if (!agentResponse.ok) {
      const errorText = await agentResponse.text();
      logger.error(
        "[LogsAgent] Agent request failed",
        `status=${agentResponse.status}`,
        errorText,
      );
      return NextResponse.json(
        { error: "Failed to send request to logs agent" },
        { status: 502 },
      );
    }

    const agentData = await agentResponse.json();
    const requestId = agentData.request_id;

    if (!requestId) {
      return NextResponse.json(
        { error: "No request_id returned from logs agent" },
        { status: 502 },
      );
    }

    // Poll for result
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollHeaders: Record<string, string> = {};
      if (swarmApiKey) {
        pollHeaders["x-api-token"] = swarmApiKey;
      }

      const progressResponse = await fetch(
        `${baseUrl}/progress?request_id=${requestId}`,
        { headers: pollHeaders },
      );

      if (!progressResponse.ok) {
        logger.error(
          "[LogsAgent] Progress poll failed",
          `status=${progressResponse.status}`,
        );
        continue;
      }

      const progressData = await progressResponse.json();

      if (progressData.status === "completed") {
        const result = progressData.result;
        return NextResponse.json({
          answer: result.final_answer || result.content || "",
          sessionId: result.sessionId || sessionId || "",
        });
      }

      if (progressData.status === "failed") {
        const errorMsg =
          progressData.error?.message || "Logs agent request failed";
        logger.error("[LogsAgent] Request failed", errorMsg);
        return NextResponse.json({ error: errorMsg }, { status: 502 });
      }

      // status === "pending" — keep polling
    }

    // Timed out
    return NextResponse.json(
      { error: "Request timed out waiting for logs agent response" },
      { status: 504 },
    );
  } catch (error) {
    logger.error("[LogsAgent] Unexpected error", String(error));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
