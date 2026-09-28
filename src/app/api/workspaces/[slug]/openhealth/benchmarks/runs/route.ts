import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { OPENHEALTH_READ_RATE_LIMIT } from "@/lib/openhealth-benchmarks/constants";
import {
  resolveOpenHealthStrut,
  listWorkflowRuns,
  fetchRunDetailForWorkflow,
  OPENHEALTH_WORKFLOWS,
} from "@/lib/openhealth-benchmarks/strut-client";
import { projectRunSummary, summarizeRuns } from "@/lib/openhealth-benchmarks/run-summary";
import { batchedAll } from "@/lib/openhealth-benchmarks/concurrency";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

const LOG_TAG = "openhealth-benchmarks";
/** Bound on how many in-flight/undetailed rows we probe per call. */
const DETAIL_FETCH_CONCURRENCY = 5;

type RouteParams = { params: Promise<{ slug: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericRunId(id: string): number {
  const n = Number(id);
  return Number.isFinite(n) ? n : 0;
}

/**
 * GET /api/workspaces/[slug]/openhealth/benchmarks/runs
 *
 * Every `openhealth-run` run, newest first, projected through
 * `projectRunSummary`, plus `summarizeRuns` (success rate, mean F1).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const resolved = await resolveOpenHealthStrut(request, slug, { write: false });
    if (!resolved.ok) return resolved.response;
    const { target, userId } = resolved;

    let rl: { allowed: boolean; retryAfter?: number };
    try {
      rl = await checkRateLimit(
        `openhealth-benchmark-runs:${userId}`,
        OPENHEALTH_READ_RATE_LIMIT.limit,
        OPENHEALTH_READ_RATE_LIMIT.windowSecs,
      );
    } catch {
      return NextResponse.json({ error: "Rate limit service unavailable" }, { status: 503 });
    }
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests", retryAfter: rl.retryAfter }, { status: 429 });
    }

    const workflow = OPENHEALTH_WORKFLOWS.run;
    const listed = await listWorkflowRuns(target, workflow);
    if (!listed.ok) return listed.response;

    // Backfill detail for entries the list endpoint shaped minimally
    // (in-flight / stale rows missing `input` or `startedAt`). Completed
    // runs already carry their full summary from the list call.
    const needDetail = listed.runs.filter((r) => !isRecord(r.input) || typeof r.startedAt !== "string");
    const detailByRunId = new Map<string, Record<string, unknown> | null>();
    await batchedAll(
      needDetail.map((r) => async () => {
        detailByRunId.set(r.runId, await fetchRunDetailForWorkflow(target, workflow, r.runId));
      }),
      DETAIL_FETCH_CONCURRENCY,
    );

    const summaries = listed.runs
      .map((r) => detailByRunId.get(r.runId) ?? r)
      .sort((a, b) => numericRunId(String(b.runId ?? "")) - numericRunId(String(a.runId ?? "")));

    const projected = summaries.map((s) => projectRunSummary(s));
    const summary = summarizeRuns(
      summaries.map((s) => ({
        status: typeof s.status === "string" ? s.status : undefined,
        input: isRecord(s.input) ? s.input : {},
        output: isRecord(s.output) ? s.output : {},
      })),
    );

    return NextResponse.json({ runs: projected, summary });
  } catch (error) {
    logger.error("[openhealth/benchmarks/runs GET] Unexpected error", LOG_TAG, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
