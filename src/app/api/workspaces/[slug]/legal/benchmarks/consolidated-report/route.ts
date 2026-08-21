import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * Allowed characters for a Harvey LAB task slug.
 * Mirrors the constant in run/route.ts and legal-benchmark-eval.ts.
 */
const TASK_SLUG_RE = /^[a-z0-9_\-/]+$/i;

/** Hard cap on runIds accepted per request. */
const RUN_IDS_MAX = 50;

/**
 * Legal benchmark run types eligible for inclusion in a consolidated report.
 * Callers must only reference runs they own, scoped to these types.
 */
const LEGAL_BENCHMARK_RUN_TYPES: StakworkRunType[] = [
  StakworkRunType.LEGAL_BENCHMARK_RUNNER,
  StakworkRunType.LEGAL_BENCHMARK_EVAL,
  StakworkRunType.LEGAL_BENCHMARK_RECURSION,
];

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
 * Triggers a LEGAL_BENCHMARK_CONSOLIDATED Stakwork run (workflow 58345) that
 * compares rubric pass/fail outcomes across multiple completed runs for the
 * same task. The workflow delivers its result via the existing
 * /api/webhook/stakwork/response webhook.
 *
 * Body: { taskSlug: string, runIds: string[] }
 *
 * Returns: { run_id: string }
 *
 * Gated to the `openlaw` workspace only.
 * Rate-limited: 5 requests / 60 seconds per IP.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    // ── Openlaw-only guard ────────────────────────────────────────────────────
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ── Workspace access ──────────────────────────────────────────────────────
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }
    const { workspaceId } = swarmResult.data;

    // ── Rate limit ────────────────────────────────────────────────────────────
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`consolidated-report:post:${ip}`, 5, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
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

    // Validate taskSlug format — closes path-traversal / URL-injection hole.
    if (typeof body.taskSlug !== "string" || !TASK_SLUG_RE.test(body.taskSlug)) {
      return NextResponse.json({ error: "Invalid taskSlug" }, { status: 400 });
    }
    const taskSlug = body.taskSlug;

    // Validate runIds — non-empty string array, capped at RUN_IDS_MAX.
    if (!Array.isArray(body.runIds) || body.runIds.length === 0) {
      return NextResponse.json({ error: "runIds must be a non-empty array" }, { status: 400 });
    }
    if (body.runIds.length > RUN_IDS_MAX) {
      return NextResponse.json(
        { error: `runIds may contain at most ${RUN_IDS_MAX} entries` },
        { status: 400 },
      );
    }
    if (!body.runIds.every((id) => typeof id === "string" && id.length > 0)) {
      return NextResponse.json({ error: "All runIds must be non-empty strings" }, { status: 400 });
    }
    const runIds = body.runIds as string[];

    // ── IDOR guard: verify all runIds belong to this workspace + correct task ──
    // Each run's result JSON must carry taskSlug matching the request's taskSlug.
    // This closes the cross-task rubric mixing vector.
    const existingRuns = await db.stakworkRun.findMany({
      where: {
        id: { in: runIds },
        workspaceId,
        type: { in: LEGAL_BENCHMARK_RUN_TYPES },
      },
      select: { id: true, result: true },
    });

    if (existingRuns.length !== runIds.length) {
      // At least one runId was not found, belongs to a different workspace, or
      // is not a valid benchmark run type.
      return NextResponse.json(
        { error: "One or more runIds are invalid or do not belong to this workspace" },
        { status: 400 },
      );
    }

    for (const run of existingRuns) {
      let runTaskSlug: string | undefined;
      try {
        const resultJson = run.result
          ? (JSON.parse(run.result) as Record<string, unknown>)
          : {};
        runTaskSlug = typeof resultJson.taskSlug === "string" ? resultJson.taskSlug : undefined;
      } catch {
        // Malformed result JSON — treat as mismatch.
      }
      if (runTaskSlug !== taskSlug) {
        return NextResponse.json(
          { error: "One or more runIds belong to a different task" },
          { status: 400 },
        );
      }
    }

    // ── Env validation ────────────────────────────────────────────────────────
    const consolidatedWorkflowId = process.env.STAKWORK_HARVEY_CONSOLIDATED_REPORT_WORKFLOW_ID;
    if (!consolidatedWorkflowId) {
      logger.error(
        "[consolidated-report] STAKWORK_HARVEY_CONSOLIDATED_REPORT_WORKFLOW_ID not configured",
        "consolidated-report",
      );
      return NextResponse.json(
        { error: "STAKWORK_HARVEY_CONSOLIDATED_REPORT_WORKFLOW_ID is not configured" },
        { status: 500 },
      );
    }

    const internalBundleSecret = process.env.INTERNAL_BUNDLE_API_SECRET;
    if (!internalBundleSecret) {
      logger.error(
        "[consolidated-report] INTERNAL_BUNDLE_API_SECRET not configured",
        "consolidated-report",
      );
      return NextResponse.json(
        { error: "INTERNAL_BUNDLE_API_SECRET is not configured" },
        { status: 500 },
      );
    }

    // ── Jarvis config ─────────────────────────────────────────────────────────
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json(
        { error: "Swarm not configured for workspace" },
        { status: 500 },
      );
    }
    const graphBaseUrl = jarvisConfig.jarvisUrl;

    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const HARVEY_BASE = "https://raw.githubusercontent.com/stakwork/harvey-labs/main";

    // ── bundle_token — HMAC over canonical sorted runIds + workspaceId ────────
    // This token is passed to workflow 58345 so it can authenticate against
    // the /api/internal/runs/report-bundles endpoint (if that pull-bundle
    // pattern is used). Uses INTERNAL_BUNDLE_API_SECRET, never NEXTAUTH_SECRET.
    const sortedRunIds = [...runIds].sort();
    const bundleToken = createHmac("sha256", internalBundleSecret)
      .update(sortedRunIds.join(",") + ":" + workspaceId)
      .digest("hex");

    // ── Placeholder URL for the DB row (overwritten after we have the run id) ──
    const placeholder = `${baseUrl}/api/webhook/stakwork/response`;

    // ── Atomic concurrent-dispatch guard + row creation ───────────────────────
    let consolidatedRun: { id: string };
    try {
      consolidatedRun = await db.$transaction<{ id: string }>(async (tx) => {
        // Reject if a CONSOLIDATED run is already in-flight for this taskSlug
        // in this workspace to prevent accidental double-dispatch.
        //
        // We fetch all in-flight CONSOLIDATED rows and parse their stored
        // taskSlug in application code rather than using a `contains` filter.
        // A `contains` substring match on `"taskSlug":"<slug>"` would produce
        // false positives: slug `task` matches stored slug `task-extended`
        // because the quoted prefix is a substring.
        const inflightRows = await tx.stakworkRun.findMany({
          where: {
            workspaceId,
            type: StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED,
            status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
          },
          select: { id: true, result: true },
        });
        const inflightForTask = inflightRows.some((row) => {
          try {
            const parsed = row.result ? (JSON.parse(row.result) as Record<string, unknown>) : {};
            return typeof parsed.taskSlug === "string" && parsed.taskSlug === taskSlug;
          } catch {
            return false;
          }
        });
        if (inflightForTask) {
          throw Object.assign(
            new Error("A consolidated report is already in progress for this task"),
            { code: "ACTIVE_CONSOLIDATED_EXISTS" },
          );
        }

        const row = await tx.stakworkRun.create({
          data: {
            workspaceId,
            type: StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED,
            status: WorkflowStatus.PENDING,
            webhookUrl: placeholder,
            userId,
            result: JSON.stringify({ taskSlug, runIds }),
          },
          select: { id: true },
        });

        return row;
      });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err as Error & { code?: string }).code === "ACTIVE_CONSOLIDATED_EXISTS"
      ) {
        return NextResponse.json(
          { error: "A consolidated report is already in progress for this task" },
          { status: 409 },
        );
      }
      throw err;
    }

    // ── run_token HMAC (same pattern as RUNNER/EVAL/RECURSION routes) ─────────
    const webhookSecret = process.env.NEXTAUTH_SECRET ?? "";
    const runToken = createHmac("sha256", webhookSecret)
      .update(consolidatedRun.id)
      .digest("hex");

    const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED}&run_id=${consolidatedRun.id}&workspace_id=${workspaceId}&run_token=${runToken}`;

    // Update the row with the real webhook URL now that we have the run id.
    await db.stakworkRun.update({
      where: { id: consolidatedRun.id },
      data: { webhookUrl },
    });

    // ── Workflow dispatch ─────────────────────────────────────────────────────
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
      // Clean up the created row so retries are not blocked by the in-flight guard.
      await db.stakworkRun.deleteMany({ where: { id: consolidatedRun.id } });
      logger.error(
        "[consolidated-report] Stakwork dispatch failed",
        "consolidated-report",
        { runId: consolidatedRun.id, status: stakworkResponse.status },
      );
      return NextResponse.json(
        { error: "Failed to dispatch job to Stakwork" },
        { status: 502 },
      );
    }

    const stakworkData = await stakworkResponse.json() as Record<string, unknown>;
    const projectId: number | undefined =
      (stakworkData?.data as Record<string, unknown>)?.project_id as number | undefined ??
      (stakworkData?.project_id as number | undefined);

    await db.stakworkRun.update({
      where: { id: consolidatedRun.id },
      data: {
        projectId: projectId ?? null,
        status: WorkflowStatus.IN_PROGRESS,
      },
    });

    logger.info(
      "[consolidated-report] Dispatched consolidated report run",
      "consolidated-report",
      { runId: consolidatedRun.id, taskSlug, runIdCount: runIds.length },
    );

    return NextResponse.json({ run_id: consolidatedRun.id }, { status: 201 });
  } catch (error) {
    logger.error(
      "[consolidated-report] Unexpected error",
      "consolidated-report",
      { error: String(error) },
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
