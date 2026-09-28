import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { resolveOpenHealthStrut, fetchOwnedRun, OPENHEALTH_WORKFLOWS } from "@/lib/openhealth-benchmarks/strut-client";
import { strutFetch } from "@/lib/strut/fetch";
import { STRUT_ACTOR_HEADER } from "@/services/bifrost/strut-delegation";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

const LOG_TAG = "openhealth-benchmarks";

type RouteParams = { params: Promise<{ slug: string; runId: string }> };

/**
 * POST /api/workspaces/[slug]/openhealth/benchmarks/runs/[runId]/cancel
 *
 * Writers only. `fetchOwnedRun` first (IDOR gate), then
 * `POST {lab}/workflows/openhealth-run/runs/:runId/cancel` with the
 * caller's resolved actor.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug, runId } = await params;
    const resolved = await resolveOpenHealthStrut(request, slug, { write: true });
    if (!resolved.ok) return resolved.response;
    const { target, userId } = resolved;

    const owned = await fetchOwnedRun(target, runId);
    if (!owned.ok) return owned.response;

    let cancelRes: Response;
    try {
      cancelRes = await strutFetch(
        target,
        `/workflows/${encodeURIComponent(OPENHEALTH_WORKFLOWS.run)}/runs/${encodeURIComponent(runId)}/cancel`,
        { method: "POST", body: {} },
      );
    } catch {
      return NextResponse.json({ error: "Strut unavailable" }, { status: 503 });
    }
    if (!cancelRes.ok) {
      return NextResponse.json({ error: "Failed to cancel run" }, { status: 502 });
    }

    logger.info("[openhealth/benchmarks/runs/cancel] cancelled", LOG_TAG, { userId, runId });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("[openhealth/benchmarks/runs/[runId]/cancel POST] Unexpected error", LOG_TAG, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Referenced for the header name only — the actor itself is already baked
// into `strutFetch` via `target.actor`; this import documents the contract.
void STRUT_ACTOR_HEADER;
