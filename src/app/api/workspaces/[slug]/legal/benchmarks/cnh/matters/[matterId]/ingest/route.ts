import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { LEGAL_SLUGS } from "@/lib/eval-capture-slugs";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";

type RouteParams = {
  params: Promise<{ slug: string; matterId: string }>;
};

const MATTER_ID_RE = /^\d{4}-\d{5}$/;

/**
 * POST /api/workspaces/[slug]/legal/benchmarks/cnh/matters/[matterId]/ingest
 *
 * Creates a LEGAL_BENCHMARK_CNH_INGEST StakworkRun and dispatches the
 * C&H ingest workflow to Stakwork.
 * Gated to LEGAL_SLUGS workspaces. Validates matterId to prevent path injection.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, matterId } = await params;

    if (!LEGAL_SLUGS.includes(slug)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!MATTER_ID_RE.test(matterId)) {
      return NextResponse.json(
        { error: "Invalid matterId format" },
        { status: 400 },
      );
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { workspaceId } = swarmResult.data;

    const workflowId = optionalEnvVars.STAKWORK_CNH_INGEST_WORKFLOW_ID ?? "57982";
    if (!optionalEnvVars.STAKWORK_CNH_INGEST_WORKFLOW_ID) {
      console.warn(
        "[cnh/ingest] STAKWORK_CNH_INGEST_WORKFLOW_ID is not set — using default 57982",
      );
    }

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const placeholder = `${baseUrl}/api/webhook/stakwork/response`;

    // Create the run row with a placeholder webhook URL
    const run = await db.stakworkRun.create({
      data: {
        workspaceId,
        type: StakworkRunType.LEGAL_BENCHMARK_CNH_INGEST,
        status: WorkflowStatus.PENDING,
        webhookUrl: placeholder,
        userId: userOrResponse.id,
      },
      select: { id: true },
    });

    const runId = run.id;

    // Build HMAC run token
    const webhookSecret = process.env.NEXTAUTH_SECRET ?? "";
    const runToken = createHmac("sha256", webhookSecret)
      .update(runId)
      .digest("hex");

    // Signed result URL (carries typed response back to Hive)
    const signedResultUrl =
      `${baseUrl}/api/webhook/stakwork/response` +
      `?type=LEGAL_BENCHMARK_CNH_INGEST` +
      `&run_id=${runId}` +
      `&workspace_id=${workspaceId}` +
      `&run_token=${runToken}`;

    // Status-sync URL (receives Stakwork lifecycle callbacks)
    const statusSyncUrl = `${baseUrl}/api/stakwork/webhook?run_id=${runId}`;

    // Update the run row with the real signed result URL
    await db.stakworkRun.update({
      where: { id: runId },
      data: { webhookUrl: signedResultUrl },
    });

    console.log(
      `[cnh/ingest] dispatching matter_id=${matterId} run_id=${runId}`,
    );

    const payload = {
      name: `cnh-ingest-${matterId}-${runId}`,
      workflow_id: parseInt(workflowId, 10),
      webhook_url: statusSyncUrl,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              matter_id: matterId,
              webhook_url: signedResultUrl,
            },
          },
        },
      },
    };

    const stakworkResponse = await fetch(
      `${optionalEnvVars.STAKWORK_BASE_URL}/projects`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token token="${optionalEnvVars.STAKWORK_API_KEY}"`,
        },
        body: JSON.stringify(payload),
      },
    );

    if (!stakworkResponse.ok) {
      // Roll back the run row so retries are not blocked
      await db.stakworkRun.deleteMany({ where: { id: runId } });
      return NextResponse.json(
        { error: "Failed to dispatch job to Stakwork" },
        { status: 500 },
      );
    }

    const stakworkData = await stakworkResponse.json();
    const projectId: number | undefined =
      stakworkData?.data?.project_id ?? stakworkData?.project_id;

    await db.stakworkRun.update({
      where: { id: runId },
      data: {
        status: WorkflowStatus.IN_PROGRESS,
        projectId: projectId ?? null,
      },
    });

    console.log(
      `[cnh/ingest] dispatched project_id=${projectId} run_id=${runId}`,
    );

    return NextResponse.json({ run_id: runId, project_id: projectId });
  } catch (error) {
    console.error("[cnh/ingest POST] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
