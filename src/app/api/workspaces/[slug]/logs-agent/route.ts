import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { runLogsAgent } from "@/services/logs-agent";

/**
 * POST /api/workspaces/[slug]/logs-agent
 *
 * Thin wrapper around runLogsAgent(). Full implementation docs live in
 * src/services/logs-agent.ts.
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
    const { prompt, sessionId, scope } = body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 },
      );
    }

    const result = await runLogsAgent({
      slug,
      userId: userOrResponse.id,
      prompt,
      scope,
      sessionId,
    });

    if (result.success) {
      return NextResponse.json(result.data);
    }

    const { error } = result;
    const statusMap: Record<string, { msg: string; status: number }> = {
      WORKSPACE_NOT_FOUND: { msg: "Workspace not found", status: 404 },
      ACCESS_DENIED: { msg: "Access denied", status: 403 },
      SWARM_NOT_ACTIVE: { msg: "Swarm not configured or not active", status: 400 },
      SWARM_NOT_CONFIGURED: { msg: "Swarm not configured or not active", status: 400 },
      SWARM_NAME_MISSING: { msg: "Swarm name not found", status: 400 },
      SCOPE_WRONG_WORKSPACE: {
        msg:
          error.type === "SCOPE_WRONG_WORKSPACE"
            ? error.message
            : "Scoped task/feature belongs to another workspace",
        status: 400,
      },
      AGENT_REQUEST_FAILED: {
        msg: "Failed to send request to logs agent",
        status:
          error.type === "AGENT_REQUEST_FAILED" ? (error.statusCode >= 500 ? 502 : 502) : 502,
      },
      NO_REQUEST_ID: { msg: "No request_id returned from logs agent", status: 502 },
      AGENT_FAILED: {
        msg:
          error.type === "AGENT_FAILED" ? error.message : "Logs agent request failed",
        status: 502,
      },
      TIMEOUT: {
        msg: "Request timed out waiting for logs agent response",
        status: 504,
      },
      UNEXPECTED: { msg: "Internal server error", status: 500 },
    };

    const mapped = statusMap[error.type] ?? { msg: "Internal server error", status: 500 };
    return NextResponse.json({ error: mapped.msg }, { status: mapped.status });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
