/**
 * GET  /api/workspaces/:slug/openhealth/benchmarks/runs/:runId/improve
 *      — the improve runs of one benchmark run, newest first.
 * POST /api/workspaces/:slug/openhealth/benchmarks/runs/:runId/improve
 *      — launch `openhealth-improve` over that run with `apply` on: the run's
 *      scoring errors become Concepts, written to the graph. Scored runs
 *      only; one in flight per run; DEVELOPER and up.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { outcomeOf } from "@/lib/openhealth-benchmarks/runs";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/utils";
import { StrutDispatchError } from "@/services/strut-runs";
import {
  findOpenHealthRunRow,
  hasPendingOpenHealthImprove,
  launchOpenHealthImprove,
  listOpenHealthImprovements,
} from "@/services/strut-runs/openhealth";
import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";
import type { OpenHealthImproveResponse } from "@/types/openhealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An improve run is minutes of the largest model. */
const IMPROVE_RATE_LIMIT = 20;
const IMPROVE_WINDOW_SECS = 60 * 60;

type Params = { params: Promise<{ slug: string; runId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { slug, runId } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    const row = await findOpenHealthRunRow(member.workspaceId, runId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body: OpenHealthImproveResponse = {
      improvements: row.strutRunId ? await listOpenHealthImprovements(member.workspaceId, row.strutRunId) : [],
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[OpenHealth] improve GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { slug, runId } = await params;
    const member = await authorizeOpenHealth(request, slug, { launch: true });
    if (member instanceof NextResponse) return member;

    const row = await findOpenHealthRunRow(member.workspaceId, runId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // The workflow reads the run's score and its errors: there is nothing to learn from a run without them.
    if (!row.strutRunId || outcomeOf(row.status, row.output) !== "succeeded") {
      return NextResponse.json({ error: "Only a scored run can be improved" }, { status: 409 });
    }
    if (await hasPendingOpenHealthImprove(member.workspaceId, row.strutRunId)) {
      return NextResponse.json({ error: "An improve run of this run is already in progress" }, { status: 409 });
    }

    const rate = await checkRateLimit(
      `openhealth:improve:${member.workspaceId}`,
      IMPROVE_RATE_LIMIT,
      IMPROVE_WINDOW_SECS,
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many improve runs. Try again later." },
        { status: 429, headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined },
      );
    }

    // The workflow finds the run in its own strut's run store, so it has to
    // be launched where the benchmark ran.
    const resolved = await resolveStrutTarget({
      purpose: "benchmark",
      userId: member.userId,
      workspaceId: member.workspaceId,
    });
    if (!resolved.ok) {
      return NextResponse.json({ error: describeStrutTargetError(resolved.error) }, { status: 503 });
    }
    if (resolved.target.swarmId !== row.swarmId) {
      return NextResponse.json(
        { error: "This run was made on another swarm, which the workspace no longer uses" },
        { status: 409 },
      );
    }

    const dispatched = await launchOpenHealthImprove({
      workspaceId: member.workspaceId,
      userId: member.userId,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
      strutRunId: row.strutRunId,
    });
    return NextResponse.json(
      { success: true, improveId: dispatched.runId, strutRunId: dispatched.strutRunId },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof StrutDispatchError) {
      const status = error.code === "no_target" || error.code === "unreachable" ? 503 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[OpenHealth] improve POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
