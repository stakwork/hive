import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import {
  readFluentbitStats,
  type FluentbitStatsReadResult,
} from "@/services/swarm/fluentbit-stats-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/swarms/[instanceId]/fluentbit — live FluentBit stats read.
 *
 * Super-admin gated BEFORE any database read, credential decryption, or
 * outbound swarm call. No connection parameter is ever accepted from the
 * request body or query string; the swarm URL always comes from the DB row.
 *
 * Outcome → HTTP mapping matches `/storage`:
 * - fresh / cached               → 200 with the reading
 * - no_swarm_record              → 200
 * - unreachable / failed         → 200 with the outcome + reason code
 * - ambiguous                    → 409
 * - malformed instanceId         → 400
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const { instanceId } = await params;

  let result: FluentbitStatsReadResult;
  try {
    result = await readFluentbitStats(instanceId);
  } catch {
    return NextResponse.json(
      { outcome: "failed", reasonCode: "UNREACHABLE", cached: false },
      { status: 500 },
    );
  }

  if (result.outcome === "failed" && result.reasonCode === "INVALID_INSTANCE_ID") {
    return NextResponse.json(result, { status: 400 });
  }
  if (result.outcome === "ambiguous") {
    return NextResponse.json(result, { status: 409 });
  }

  return NextResponse.json(result);
}
