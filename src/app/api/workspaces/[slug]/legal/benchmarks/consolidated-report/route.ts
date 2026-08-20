import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * Allowed characters for a Harvey LAB task slug.
 * Same regex used in sibling routes to close path-traversal / URL-injection.
 */
const TASK_SLUG_RE = /^[a-z0-9_\-/]+$/i;

/** Run types that can be referenced in the runIds array. */
const LEGAL_BENCHMARK_RUN_TYPES: StakworkRunType[] = [
  StakworkRunType.LEGAL_BENCHMARK_RUNNER,
  StakworkRunType.LEGAL_BENCHMARK_EVAL,
  StakworkRunType.LEGAL_BENCHMARK_RECURSION,
];

const HARVEY_BASE = "https://raw.githubusercontent.com/stakwork/harvey-labs/main";

interface TaskJson {
  title: string;
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
  const errorInfo = errorMap[error.type] ?? { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/**
 * POST /api/workspaces/[slug]/legal/benchmarks/consolidated-report
 *
 * Trigger a LEGAL_BENCHMARK_CONSOLIDATED run for cross-run performance comparison.
 * Creates a StakworkRun row and dispatches workflow 58345 (STAKWORK_HARVEY_CONSOLIDATED_REPORT_WORKFLOW_ID).
 * Gated to the `openlaw` workspace only.
 *
 * Body: { taskSlug: string, runIds: string[] }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId } = swarmResult.data;

    // ── Rate limiting ─────────────────────────────────────────────────────────
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`consolidated-report:post:${ip}`, 5, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests — please wait before triggering another consolidated report" },
        { status: 429 },
      );
    }

    // ── Parse + validate body ─────────────────────────────────────────────────
    let body: { taskSlug?: unknown; runIds?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { taskSlug, runIds } = body;

    // Validate taskSlug format — closes path-traversal / URL-injection hole
    if (typeof taskSlug !== "string" || !TASK_SLUG_RE.test(taskSlug)) {
      return NextResponse.json({ error: "Invalid taskSlug" }, { status: 400 });
    }

    // Validate runIds: non-empty string array, max 50 elements
    if (!Array.isArray(runIds) || runIds.length === 0) {
      return NextResponse.json({ error: "runIds must be a non-empty array" }, { status: 400 });
    }
    if (runIds.length > 50) {
      return NextResponse.json(
        { error: "runIds exceeds maximum of 50 entries" },
        { status: 400 },
      );
    }
    // Reject anything that looks like a path segment or isn't a plain string
    const validIdRe = /^[a-z0-9]{20,30}$/i; // cuid/nanoid shape guard (not a path)
    for (const id of runIds) {
      if (typeof id !== "string" || !validIdRe.test(id)) {
        return NextResponse.json(
          { error: `Invalid runId format: "${typeof id === "string" ? id.slice(0, 40) : typeof id}"` },
          { status: 400 },
        );
      }
    }
    const typedRunIds = runIds as string[];

    // ── IDOR: verify all runIds belong to this workspace, are of an allowed type,
    // and have a completed report bundle (reportUrl is not null). A PENDING or
    // IN_PROGRESS run has no bundle; allowing it would dispatch the workflow with
    // an empty bundle for that runId, corrupting the consolidated output.
    const resolvedRuns = await db.stakworkRun.findMany({
      where: {
        id: { in: typedRunIds },
        workspaceId,
        type: { in: LEGAL_BENCHMARK_RUN_TYPES },
        reportUrl: { not: null },
      },
      select: { id: true, result: true },
    });

    if (resolvedRuns.length !== typedRunIds.length) {
      // At least one runId was absent, belonged to a different workspace, or had
      // no completed report bundle. Return 403 rather than 400 so the response
      // does not confirm whether a foreign runId exists.
      logger.warn("[consolidated-report] runIds IDOR/precondition mismatch", "consolidated-report", {
        requested: typedRunIds.length,
        resolved: resolvedRuns.length,
        workspaceId,
      });
      return NextResponse.json(
        { error: "One or more runIds are invalid, do not belong to this workspace, or have no completed report" },
        { status: 403 },
      );
    }

    // Verify every resolved run's taskSlug matches the request taskSlug
    for (const row of resolvedRuns) {
      let rowTaskSlug: string | undefined;
      try {
        const resultJson = row.result ? (JSON.parse(row.result) as Record<string, unknown>) : {};
        rowTaskSlug = resultJson.taskSlug as string | undefined;
      } catch {
        rowTaskSlug = undefined;
      }
      if (rowTaskSlug !== taskSlug) {
        logger.warn("[consolidated-report] taskSlug mismatch on runId", "consolidated-report", {
          runId: row.id,
          expected: taskSlug,
          found: rowTaskSlug,
          workspaceId,
        });
        return NextResponse.json(
          { error: "One or more runIds do not match the provided taskSlug" },
          { status: 400 },
        );
      }
    }

    // ── Validate required env vars ────────────────────────────────────────────
    const consolidatedWorkflowId = process.env.STAKWORK_HARVEY_CONSOLIDATED_REPORT_WORKFLOW_ID;
    if (!consolidatedWorkflowId) {
      return NextResponse.json(
        { error: "STAKWORK_HARVEY_CONSOLIDATED_REPORT_WORKFLOW_ID is not configured" },
        { status: 500 },
      );
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Swarm not configured for workspace" }, { status: 500 });
    }
    const graphBaseUrl = jarvisConfig.jarvisUrl;

    // ── Resolve task title from task.json (best-effort) ───────────────────────
    let resolvedTaskTitle = taskSlug;
    try {
      const taskJsonRes = await fetch(`${HARVEY_BASE}/tasks/${taskSlug}/task.json`);
      if (taskJsonRes.ok) {
        const taskJson = (await taskJsonRes.json()) as TaskJson;
        if (typeof taskJson.title === "string" && taskJson.title.trim()) {
          resolvedTaskTitle = taskJson.title.trim();
        }
      }
    } catch {
      // Non-fatal: fall back to taskSlug as task_title
    }

    // ── Create the consolidated run row ───────────────────────────────────────
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

    let consolidatedRun: { id: string };
    try {
      consolidatedRun = await db.stakworkRun.create({
        data: {
          workspaceId,
          type: StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED,
          status: WorkflowStatus.PENDING,
          webhookUrl: `${baseUrl}/api/webhook/stakwork/response`, // placeholder, updated below
          userId: userOrResponse.id,
          result: JSON.stringify({ taskSlug }),
        },
        select: { id: true },
      });
    } catch (err) {
      logger.error("[consolidated-report] Failed to create run row", "consolidated-report", {
        error: String(err),
        workspaceId,
        taskSlug,
      });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // ── Build HMAC run_token (NEXTAUTH_SECRET over run.id) ────────────────────
    const webhookSecret = process.env.NEXTAUTH_SECRET ?? "";
    const runToken = createHmac("sha256", webhookSecret)
      .update(consolidatedRun.id)
      .digest("hex");

    // ── Build HMAC bundle_token (INTERNAL_BUNDLE_API_SECRET over sorted runIds + workspaceId) ──
    // This is sent to the workflow so it can call back to /api/internal/runs/report-bundles
    // to pull individual run report content. The token is bound to the exact runId set and
    // workspaceId, so any modification invalidates it.
    const bundleSecret = process.env.INTERNAL_BUNDLE_API_SECRET ?? "";
    const sortedRunIds = [...typedRunIds].sort();
    const bundleToken = createHmac("sha256", bundleSecret)
      .update(sortedRunIds.join(",") + ":" + workspaceId)
      .digest("hex");

    // ── Build webhook URL ─────────────────────────────────────────────────────
    const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED}&run_id=${consolidatedRun.id}&workspace_id=${workspaceId}&run_token=${runToken}`;

    // Update the row's webhookUrl with the real URL now that we have the id
    await db.stakworkRun.update({
      where: { id: consolidatedRun.id },
      data: { webhookUrl },
    });

    // ── Dispatch to Stakwork ──────────────────────────────────────────────────
    const payload = {
      name: `harvey-consolidated-${consolidatedRun.id}`,
      workflow_id: parseInt(consolidatedWorkflowId, 10),
      webhook_url: `${baseUrl}/api/stakwork/webhook?run_id=${consolidatedRun.id}`,
      webhook_full_output: false,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              task_slug: taskSlug,
              task_title: resolvedTaskTitle,
              workspace_id: workspaceId,
              run_ids_json: JSON.stringify(sortedRunIds),
              webhook_url: webhookUrl,
              run_token: runToken,
              hive_base_url: baseUrl,
              graph_base_url: graphBaseUrl,
              documents_base_url: HARVEY_BASE,
              bundle_token: bundleToken,
              tokenReference: getStakworkTokenReference(),
            },
          },
        },
      },
    };

    const stakworkResponse = await fetch(`${optionalEnvVars.STAKWORK_BASE_URL}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token="${optionalEnvVars.STAKWORK_API_KEY}"`,
      },
      body: JSON.stringify(payload),
    });

    if (!stakworkResponse.ok) {
      // Clean up the row so retries are not blocked
      await db.stakworkRun.deleteMany({ where: { id: consolidatedRun.id } });
      logger.error("[consolidated-report] Stakwork dispatch failed", "consolidated-report", {
        status: stakworkResponse.status,
        runId: consolidatedRun.id,
        workspaceId,
      });
      return NextResponse.json(
        { error: "Failed to dispatch consolidated report job to Stakwork" },
        { status: 502 },
      );
    }

    const stakworkData = (await stakworkResponse.json()) as { data?: { project_id?: number }; project_id?: number };
    const projectId = stakworkData?.data?.project_id ?? stakworkData?.project_id;

    await db.stakworkRun.update({
      where: { id: consolidatedRun.id },
      data: {
        projectId: projectId ?? null,
        status: WorkflowStatus.IN_PROGRESS,
      },
    });

    logger.info("[consolidated-report] Dispatched consolidated report run", "consolidated-report", {
      runId: consolidatedRun.id,
      taskSlug,
      runIdCount: typedRunIds.length,
      projectId,
      workspaceId,
    });

    return NextResponse.json({ run_id: consolidatedRun.id }, { status: 201 });
  } catch (error) {
    logger.error("[consolidated-report POST] Unexpected error", "consolidated-report", {
      error: String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
