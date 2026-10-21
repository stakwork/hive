/**
 * POST /api/workspaces/:slug/legal/benchmarks/strut/run
 *      { taskSlug, standardModel?, reasoningModel?, judgeModel? }
 *
 * Start a Harvey LAB task on the workspace's strut (`harvey-lab-run`) — the
 * Legal Benchmarks page in a `LEGAL_STRUT_SLUGS` workspace. The task must be
 * in hive's catalogue; its input is built server-side from GitHub, never
 * from the request. Models, when picked, ride as strut `params`; absent, the
 * workflow's own defaults apply. DEVELOPER and up. 202 `{ run_id }`.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark, checkRateLimitSafe } from "@/lib/benchmarks/access";
import { isValidModel } from "@/lib/ai/models";
import { fetchHarveyTaskInput, findHarveyTask } from "@/lib/harvey-lab/task-input";
import { logger } from "@/lib/logger";
import { getBaseUrl } from "@/lib/utils";
import { StrutDispatchError } from "@/services/strut-runs";
import {
  HARVEY_LAB_BENCHMARK_SLUG,
  LegalRunInProgressError,
  launchLegalStrutRun,
  type LegalRunModels,
} from "@/services/strut-runs/legal-benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A run is ~1.5 h and ~$30: a handful per hour per workspace. */
const RUN_RATE_LIMIT = 20;
const RUN_WINDOW_SECS = 60 * 60;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { slug } = await params;
    const auth = await authorizeBenchmark(request, slug, HARVEY_LAB_BENCHMARK_SLUG, { launch: true });
    if (auth instanceof NextResponse) return auth;
    const { member } = auth;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const task = typeof body?.taskSlug === "string" ? findHarveyTask(body.taskSlug) : null;
    if (!task) return NextResponse.json({ error: "Unknown taskSlug" }, { status: 400 });

    const models: LegalRunModels = {};
    for (const key of ["standardModel", "reasoningModel", "judgeModel"] as const) {
      const value = body?.[key];
      if (value === undefined) continue;
      if (!isValidModel(value)) return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
      models[key] = value;
    }
    // The judge is called on Anthropic's SDK directly.
    if (models.judgeModel && !models.judgeModel.startsWith("anthropic/")) {
      return NextResponse.json({ error: "judgeModel must be an Anthropic model" }, { status: 400 });
    }

    const rate = await checkRateLimitSafe(`legal-strut:run:${member.workspaceId}`, RUN_RATE_LIMIT, RUN_WINDOW_SECS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many benchmark runs. Try again later." },
        { status: 429, headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined },
      );
    }

    const built = await fetchHarveyTaskInput(task);
    if (!built.ok) {
      logger.warn("[legal/benchmarks/strut/run] task unavailable", "legal-benchmarks", {
        taskSlug: task.slug,
        error: built.error,
      });
      return NextResponse.json({ error: `Could not load the task from GitHub: ${built.error}` }, { status: 502 });
    }

    const dispatched = await launchLegalStrutRun({
      workspaceId: member.workspaceId,
      userId: member.userId,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
      input: built.input,
      models,
    });
    return NextResponse.json({ success: true, run_id: dispatched.runId }, { status: 202 });
  } catch (error) {
    if (error instanceof LegalRunInProgressError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof StrutDispatchError) {
      const status = error.code === "no_target" || error.code === "unreachable" ? 503 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[legal/benchmarks/strut/run] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
