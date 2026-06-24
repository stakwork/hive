import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { config } from "@/config/env";
import { generateSignedUrl } from "@/lib/signed-urls";
import { getBaseUrl } from "@/lib/utils";
import { logger } from "@/lib/logger";

type RouteParams = { params: Promise<{ slug: string; logId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, logId } = await params;

    // Validate workspace access
    const access = await validateWorkspaceAccess(slug, userOrResponse.id);
    if (!access.hasAccess || !access.canRead) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
    }

    // Fetch AgentLog scoped to workspace
    const workspace = await db.workspace.findUnique({ where: { slug }, select: { id: true } });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const agentLog = await db.agentLog.findFirst({
      where: { id: logId, workspaceId: workspace.id },
      select: { id: true },
    });

    if (!agentLog) {
      return NextResponse.json({ error: "Agent log not found" }, { status: 404 });
    }

    // Guard: workflow must be configured
    if (!config.STAKWORK_AGENT_TRACE_WORKFLOW_ID) {
      return NextResponse.json(
        { error: "Agent trace workflow not configured" },
        { status: 501 }
      );
    }

    const baseUrl = getBaseUrl(request.headers.get("host"));
    const signedUrl = generateSignedUrl(baseUrl, `/api/agent-logs/${logId}/content`, 3600);
    const webhookUrl = `${baseUrl}/api/webhook/agent-trace`;

    const payload = {
      name: `agent-trace-${logId}`,
      workflow_id: parseInt(config.STAKWORK_AGENT_TRACE_WORKFLOW_ID, 10),
      webhook_url: webhookUrl,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              agentLogId: logId,
              blobUrl: signedUrl,
              webhookUrl,
            },
          },
        },
      },
    };

    const stakworkRes = await fetch(`${config.STAKWORK_BASE_URL}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!stakworkRes.ok) {
      const text = await stakworkRes.text().catch(() => "");
      logger.error("[generate-trace] Stakwork trigger failed", undefined, { status: stakworkRes.status, text });
      return NextResponse.json({ error: "Failed to trigger trace workflow" }, { status: 502 });
    }

    await db.agentLog.update({
      where: { id: logId },
      data: { traceStatus: "pending" },
    });

    return NextResponse.json({ status: "pending" });
  } catch (error) {
    logger.error("[generate-trace] Unexpected error", undefined, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
